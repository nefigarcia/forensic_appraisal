'use server'

/**
 * Portal-side server actions.
 *
 * Every action begins with `resolvePortalAccess(rawToken)`, which is
 * the ONLY authentication surface. There is no firm session, no org
 * role, no RBAC permission check — the token itself is the entire
 * capability. Scope is limited to a single `RequestList` (and the
 * `RequestItem`s that belong to it).
 *
 * Portal actions NEVER:
 *   - call `requireCaseAccess` or `requireSession` (firm-side helpers)
 *   - read or write `AuditLog` chained rows via a firm user (writes
 *     are attributed to `userId=null` with a portal-explicit note)
 *   - expose firm-internal fields on items (notes, aiCompleteness,
 *     assignedToUserId, reviewerUserId are stripped in
 *     `sanitizeItemForPortal`)
 *   - reveal any other case or list the contact might have access to;
 *     the caller may only see the list keyed by the token they passed.
 *
 * If a portal-side test can ever call a firm-side helper, that's a bug.
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { s3Client, BUCKET_NAME } from '@/lib/s3-client'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { resolvePortalAccess, recordPortalUse } from '@/lib/portal/session'
import {
  validateUpload,
  UploadValidationError,
} from '@/lib/documents/validation'
import {
  buildS3Key,
  sha256HexOf,
  nextVersionNumberFor,
} from '@/lib/documents/versioning'
import { scanner } from '@/lib/documents/scanner'
import {
  REQUEST_ITEM_STATUS_LABEL,
  type RequestItemStatus,
} from '@/lib/requests/statuses'
import { REQUEST_ITEM_CATEGORY_LABEL, type RequestItemCategory } from '@/lib/requests/categories'
import { NotFoundError } from '@/lib/authz'

// ─────────────────────────────────────────────────
// Portal-safe DTOs
// ─────────────────────────────────────────────────

/**
 * The subset of RequestItem safe to send to the portal. Firm-internal
 * fields (notes, assignedToUserId, reviewerUserId, aiCompleteness,
 * aiCompletenessNote) are intentionally stripped.
 */
export interface PortalRequestItem {
  id:                 string
  title:              string
  description:        string | null
  category:           string | null
  categoryLabel:      string | null
  requestedFrom:      string | null
  dueDate:            Date | null
  priority:           string
  status:             RequestItemStatus
  statusLabel:        string
  clarificationNote:  string | null   // shown when NEEDS_CLARIFICATION
  documents:          PortalDocumentSummary[]
}

export interface PortalDocumentSummary {
  id:           string
  name:         string
  uploadedAt:   Date
  uploadedByPortal: boolean
}

export interface PortalRequestListView {
  requestListId:  string
  title:          string
  description:    string | null
  contactName:    string
  contactEmail:   string
  expiresAt:      Date
  items:          PortalRequestItem[]
  // Aggregate counters, using the same dashboard classification as the
  // firm side but restricted to this contact's list.
  outstandingCount:   number
  clarificationCount: number
  receivedCount:      number
}

function sanitizeItemForPortal(row: any, docs: PortalDocumentSummary[]): PortalRequestItem {
  return {
    id:            row.id,
    title:         row.title,
    description:   row.description,
    category:      row.category ?? null,
    categoryLabel: row.category
      ? (REQUEST_ITEM_CATEGORY_LABEL[row.category as RequestItemCategory] ?? row.category)
      : null,
    requestedFrom: row.requestedFrom,
    dueDate:       row.dueDate,
    priority:      row.priority,
    status:        row.status,
    statusLabel:   REQUEST_ITEM_STATUS_LABEL[row.status as RequestItemStatus] ?? row.status,
    clarificationNote: row.status === 'NEEDS_CLARIFICATION' ? row.clarificationNote : null,
    documents:     docs,
  }
}

// ─────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────

export async function getPortalRequestList(rawToken: string): Promise<PortalRequestListView> {
  const scope = await resolvePortalAccess(rawToken)
  await recordPortalUse(scope.tokenHash)

  const list = await prisma.requestList.findUnique({
    where: { id: scope.requestListId },
    include: {
      items: {
        // Hidden from the portal: NOT_REQUESTED items on a draft list
        // that has been sent already were already migrated to REQUESTED
        // in markRequestListSent / invitePortalAccess. Any still-in-
        // NOT_REQUESTED items belong to a still-DRAFT list; the token
        // wouldn't have been issued yet.
        where: { status: { not: 'NOT_REQUESTED' } },
        orderBy: { displayOrder: 'asc' },
        include: {
          documents: {
            include: {
              document: { select: { id: true, name: true } },
            },
            orderBy: { uploadedAt: 'desc' },
          },
        },
      },
    },
  })
  if (!list) throw new NotFoundError()

  let outstanding = 0, clarification = 0, received = 0
  const items: PortalRequestItem[] = list.items.map(row => {
    const docs: PortalDocumentSummary[] = row.documents.map(rd => ({
      id:           rd.document.id,
      name:         rd.document.name,
      uploadedAt:   rd.uploadedAt,
      uploadedByPortal: rd.uploadedByPortal,
    }))
    if (row.status === 'REQUESTED')            outstanding++
    else if (row.status === 'NEEDS_CLARIFICATION') clarification++
    else if (row.status === 'RECEIVED' || row.status === 'ACCEPTED') received++
    return sanitizeItemForPortal(row, docs)
  })

  return {
    requestListId:  list.id,
    title:          list.title,
    description:    list.description,
    contactName:    scope.contactName,
    contactEmail:   scope.contactEmail,
    expiresAt:      scope.expiresAt,
    items,
    outstandingCount:   outstanding,
    clarificationCount: clarification,
    receivedCount:      received,
  }
}

// ─────────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────────

/**
 * Portal upload. Attaches an uploaded file to a specific RequestItem
 * within the token's scope. Reuses Slice-5 versioning: each upload
 * lands as an immutable DocumentVersion; a re-upload with the same
 * filename becomes v2 of the same Document.
 *
 * The item transitions to RECEIVED after a successful upload (unless
 * already ACCEPTED, in which case a re-upload flips it back to RECEIVED
 * for the reviewer to look at again).
 */
export async function uploadToRequestItem(input: {
  rawToken:      string
  requestItemId: string
  file:          File
}): Promise<{ documentId: string; versionNumber: number }> {
  const scope = await resolvePortalAccess(input.rawToken)

  // Scope check: the item must live in the token's list.
  const item = await prisma.requestItem.findUnique({
    where: { id: input.requestItemId },
    select: { id: true, requestListId: true, caseId: true, status: true },
  })
  if (!item || item.requestListId !== scope.requestListId) throw new NotFoundError()
  if (item.status === 'NOT_APPLICABLE') throw new Error('Item marked not applicable')
  if (item.status === 'NOT_REQUESTED')  throw new Error('Item not yet requested')

  const file = input.file
  if (!file) throw new Error('No file provided')

  const arrayBuffer = await file.arrayBuffer()
  const buffer      = Buffer.from(arrayBuffer)

  // ── Same validation stack as firm uploads (Slice 5) ────────────────
  let validation
  try {
    validation = validateUpload(file.name, new Uint8Array(buffer))
  } catch (e) {
    if (e instanceof UploadValidationError) throw new Error(`Upload rejected: ${e.message}`)
    throw e
  }
  const sha256Hash = sha256HexOf(buffer)

  // ── Find-or-create the Document row scoped to the case ────────────
  // Do NOT reuse firm-side findDocumentByFilenameInCase — a portal
  // uploader must not silently overwrite a firm-uploaded document with
  // the same filename. Portal-uploaded documents live under a
  // deterministic prefix and each fresh portal upload is a new Document.
  const displayName = file.name
  const documentId = await prisma.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        caseId: scope.caseId,
        name:   displayName,
        type:   validation.detectedMime,
        size:   '0',
        status: 'PENDING',
      },
    })
    return created.id
  })
  const versionNumber = await nextVersionNumberFor(documentId)

  const s3Key = buildS3Key({
    organizationId: scope.organizationId,
    caseId:         scope.caseId,
    documentId,
    versionNumber,
    originalName:   displayName,
  })
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key:    s3Key,
    Body:   buffer,
    ContentType: validation.detectedMime,
  }))
  const version = await prisma.documentVersion.create({
    data: {
      documentId,
      versionNumber,
      s3Key,
      sha256Hash,
      sizeBytes:    BigInt(buffer.byteLength),
      mimeType:     validation.detectedMime,
      originalName: displayName,
      // Attribute to a synthetic portal user string so the version row
      // isn't tied to a firm userId. Downstream readers should treat
      // `portal:<contactId>` as "uploaded by client contact".
      uploadedBy:   `portal:${scope.clientContactId}`,
      scanStatus:   'PENDING',
    },
  })

  const humanSize = (buffer.byteLength / (1024 * 1024)).toFixed(2) + ' MB'
  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: {
        currentVersionId: version.id,
        s3Key, sha256Hash, size: humanSize,
        type: validation.detectedMime,
        status: 'VERIFIED',
      },
    })
    await tx.requestItemDocument.create({
      data: {
        requestItemId:      item.id,
        documentId,
        uploadedByPortal:   true,
        uploadedByContactId: scope.clientContactId,
      },
    })
    // Transition to RECEIVED (or back to RECEIVED from ACCEPTED /
    // NEEDS_CLARIFICATION so the reviewer sees it in the queue).
    if (item.status !== 'RECEIVED') {
      await tx.requestItem.update({
        where: { id: item.id },
        data:  { status: 'RECEIVED', statusChangedAt: new Date(), clarificationNote: null },
      })
    }
  })

  // Audit as a "portal" event (userId null — portal callers are not
  // firm users). The chain still forms per-org.
  await logAction({
    userId:         null,
    action:         'UPLOAD_DOCUMENT_VERSION',
    caseId:         scope.caseId,
    organizationId: scope.organizationId,
    targetModel:    'RequestItemDocument',
    targetId:       version.id,
    note:           `portal upload by ${scope.contactEmail}`,
    newValue: {
      requestItemId: item.id,
      documentId,
      versionNumber,
      sha256Hash,
      sizeBytes:     buffer.byteLength,
      mimeType:      validation.detectedMime,
    },
  })

  await recordPortalUse(scope.tokenHash)

  void scanner().scanAsync(version.id, new Uint8Array(buffer)).catch(
    err => console.error('[portal-upload] scanner error:', (err as Error).message),
  )

  // Firm-side reload
  revalidatePath(`/projects/${scope.caseId}`)
  return { documentId, versionNumber }
}
