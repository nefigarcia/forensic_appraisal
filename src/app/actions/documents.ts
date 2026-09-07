'use server'

import { prisma } from '@/lib/prisma'
import { logAction } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { s3Client, BUCKET_NAME } from '@/lib/s3-client'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { requireCaseAccess, requireDocumentAccess } from '@/lib/authz'
import { decryptConnectorSecret } from '@/lib/crypto/connector-secrets'
import {
  validateUpload,
  UploadValidationError,
} from '@/lib/documents/validation'
import {
  buildS3Key,
  sha256HexOf,
  nextVersionNumberFor,
  findDocumentByFilenameInCase,
} from '@/lib/documents/versioning'
import { scanner } from '@/lib/documents/scanner'

/**
 * Upload a document (or a new version of an existing one).
 *
 * Slice 5 semantics:
 *   - The file is validated (size, extension, magic-byte MIME) BEFORE we
 *     touch S3, so a rejected upload leaves no orphan object.
 *   - Each upload is stored under a self-describing key
 *     `orgs/<org>/cases/<case>/documents/<doc>/versions/<n>/<name>`.
 *   - If the case already contains a non-archived document with the same
 *     original filename, we create a new *version* on that document
 *     rather than a whole new document. Existing versions are never
 *     touched.
 *   - The `Document` row's `s3Key` / `sha256Hash` / `size` / `type`
 *     denormalized fields point at the newest version (keeps existing
 *     reads working through the migration window).
 *   - The malware scanner is invoked after the row is created; the
 *     version's `scanStatus` starts PENDING and is updated by the
 *     scanner. Downloads refuse to sign URLs unless status is CLEAN.
 */
export async function addDocument(caseId: string, formData: FormData) {
  const { session } = await requireCaseAccess(caseId, 'document:upload')

  const file            = formData.get('file') as File
  const displayName     = formData.get('name') as string | null
  const declaredType    = formData.get('type') as string | null
  const storageProvider = (formData.get('storageProvider') as string) || 's3'

  if (!file) throw new Error('No file provided')

  const arrayBuffer = await file.arrayBuffer()
  const buffer      = Buffer.from(arrayBuffer)

  // ── Validate before touching S3 ────────────────────────────────────
  let validation
  try {
    validation = validateUpload(file.name, new Uint8Array(buffer))
  } catch (e) {
    if (e instanceof UploadValidationError) {
      // Bubble a friendly message; do NOT include buffer contents in the log.
      throw new Error(`Upload rejected: ${e.message}`)
    }
    throw e
  }

  // ── Per-version SHA-256 (tamper-evident) ──────────────────────────
  const sha256Hash = sha256HexOf(buffer)

  // ── Find-or-create the Document row ──────────────────────────────
  const filename = file.name
  const existing = await findDocumentByFilenameInCase(caseId, filename)

  let documentId: string
  if (existing) {
    documentId = existing.id
  } else {
    const created = await prisma.document.create({
      data: {
        caseId,
        name: displayName || filename,
        type: declaredType || validation.detectedMime,
        size: '0',            // placeholder; overwritten below with the current-version's size
        status: 'PENDING',
      },
    })
    documentId = created.id
  }

  const versionNumber = await nextVersionNumberFor(documentId)

  // ── S3 write (idempotent — the key is unique per version) ─────────
  const s3Key = buildS3Key({
    organizationId: session.organizationId,
    caseId,
    documentId,
    versionNumber,
    originalName: filename,
  })
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key:    s3Key,
    Body:   buffer,
    ContentType: validation.detectedMime,
  }))

  // ── Create the immutable DocumentVersion row ──────────────────────
  const version = await prisma.documentVersion.create({
    data: {
      documentId,
      versionNumber,
      s3Key,
      sha256Hash,
      sizeBytes:    BigInt(buffer.byteLength),
      mimeType:     validation.detectedMime,
      originalName: filename,
      uploadedBy:   session.userId,
      scanStatus:   'PENDING',
    },
  })

  // ── Update Document's denormalized "current version" pointers ────
  const humanSize = (buffer.byteLength / (1024 * 1024)).toFixed(2) + ' MB'
  await prisma.document.update({
    where: { id: documentId },
    data: {
      currentVersionId: version.id,
      s3Key,                    // legacy — kept in sync for existing readers
      sha256Hash,               // legacy — kept in sync
      size: humanSize,
      type: declaredType || validation.detectedMime,
      status: 'VERIFIED',
    },
  })

  // ── Optional mirror to Microsoft (Slice 3 encryption in effect) ──
  if (storageProvider !== 's3') {
    const connector = await prisma.externalConnector.findUnique({
      where: { organizationId_provider: { organizationId: session.organizationId, provider: storageProvider } },
    })
    if (connector && storageProvider === 'microsoft') {
      const accessToken = await decryptConnectorSecret(connector, 'accessToken')
      if (accessToken) {
        try {
          await fetch(
            `https://graph.microsoft.com/v1.0/me/drive/root:/ValuVault_Archive/${caseId}/${encodeURIComponent(filename)}:/content`,
            { method: 'PUT', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': validation.detectedMime }, body: buffer },
          )
        } catch (e) {
          // Never log the token; capture only the message.
          console.error('[documents] Microsoft Graph mirror failed:', (e as Error).message)
        }
      }
    }
  }

  // ── Audit + async malware scan ────────────────────────────────────
  await logAction({
    userId: session.userId, action: 'UPLOAD_DOCUMENT_VERSION', caseId,
    targetModel: 'DocumentVersion', targetId: version.id,
    newValue: {
      documentId,
      versionNumber,
      sha256Hash,
      sizeBytes: buffer.byteLength,
      mimeType: validation.detectedMime,
    },
  })
  // Legacy audit shape kept for continuity with the old dashboards.
  if (!existing) {
    await logAction({
      userId: session.userId, action: 'UPLOAD_DOCUMENT', caseId,
      targetModel: 'Document', targetId: documentId,
      newValue: { name: displayName || filename, size: humanSize, sha256Hash },
    })
  }

  // Fire-and-forget. The scanner updates scanStatus on its own timeline.
  void scanner().scanAsync(version.id, new Uint8Array(buffer))
    .then((res) => {
      if (res && (res as { status?: string }).status === 'INFECTED') {
        return logAction({
          userId: null, action: 'MALWARE_SCAN_INFECTED', caseId,
          targetModel: 'DocumentVersion', targetId: version.id,
        })
      }
    })
    .catch((e) => console.error('[documents] scanner error:', (e as Error).message))

  revalidatePath(`/projects/${caseId}`)
  return { success: true, docId: documentId, versionId: version.id, versionNumber, sha256Hash }
}

/**
 * Archive a document. Never destroys the S3 object or the DB row — this
 * is a soft delete that preserves chain of custody. A future admin-only
 * "hard delete" slice can add real destruction with legal-hold checks.
 */
export async function deleteDocument(documentId: string, reason?: string) {
  const { session, document: doc } = await requireDocumentAccess(documentId, 'document:delete')

  await prisma.document.update({
    where: { id: documentId },
    data: {
      isArchived:    true,
      archivedAt:    new Date(),
      archivedBy:    session.userId,
      archiveReason: reason ?? 'no reason provided',
    },
  })

  await logAction({
    userId: session.userId, action: 'ARCHIVE_DOCUMENT', caseId: doc.caseId,
    targetModel: 'Document', targetId: documentId,
    oldValue: { name: doc.name },
    note: reason,
  })

  revalidatePath(`/projects/${doc.caseId}`)
}
