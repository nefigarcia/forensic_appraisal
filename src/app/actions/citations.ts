'use server'

/**
 * Server actions for evidence citations.
 *
 * Tenant safety: every access goes through the Slice-1 authz helpers on
 * the *parent* entity. A citation whose FinancialValue is in another org
 * cannot be read, and a citation whose DocumentVersion is in another org
 * cannot yield a download URL.
 */

import { prisma } from '@/lib/prisma'
import { s3Client, BUCKET_NAME } from '@/lib/s3-client'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  requireFinancialValueAccess,
  requireAddBackAccess,
  requireValuationModelAccess,
  requireDocumentVersionAccess,
  NotFoundError,
} from '@/lib/authz'
import { logAction } from '@/lib/audit'

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60

interface CitationRowForClient {
  id:               string
  documentVersionId: string
  documentName:     string
  versionNumber:    number
  pageNumber:       number | null
  sourceLabel:      string | null
  tableName:        string | null
  rowLabel:         string | null
  columnLabel:      string | null
  boundingBox:      unknown | null
  rawText:          string | null
  extractor:        string | null
  extractorVersion: string | null
  confidence:       number | null
  isConfident:      boolean
  createdAt:        Date
}

/**
 * Prisma projection for read paths — no wide relation includes, only what
 * the UI needs. Includes just enough of the DocumentVersion + Document to
 * display "which file, which version" without exposing S3 keys.
 */
const CITATION_SELECT = {
  id: true,
  documentVersionId: true,
  pageNumber: true,
  sourceLabel: true,
  tableName: true,
  rowLabel: true,
  columnLabel: true,
  boundingBox: true,
  rawText: true,
  extractor: true,
  extractorVersion: true,
  confidence: true,
  isConfident: true,
  createdAt: true,
  documentVersion: {
    select: {
      versionNumber: true,
      document: { select: { name: true } },
    },
  },
} as const

function toClientShape(row: any): CitationRowForClient {
  return {
    id:                row.id,
    documentVersionId: row.documentVersionId,
    documentName:      row.documentVersion.document.name,
    versionNumber:     row.documentVersion.versionNumber,
    pageNumber:        row.pageNumber,
    sourceLabel:       row.sourceLabel,
    tableName:         row.tableName,
    rowLabel:          row.rowLabel,
    columnLabel:       row.columnLabel,
    boundingBox:       row.boundingBox,
    rawText:           row.rawText,
    extractor:         row.extractor,
    extractorVersion:  row.extractorVersion,
    confidence:        row.confidence,
    isConfident:       row.isConfident,
    createdAt:         row.createdAt,
  }
}

/** List every citation for a FinancialValue, oldest-first. Tenant-scoped. */
export async function getCitationsForFinancialValue(id: string): Promise<CitationRowForClient[]> {
  await requireFinancialValueAccess(id, 'case:read')
  const rows = await prisma.evidenceCitation.findMany({
    where:   { financialValueId: id },
    orderBy: { createdAt: 'asc' },
    select:  CITATION_SELECT,
  })
  return rows.map(toClientShape)
}

/** List every citation for an AddBack, oldest-first. Tenant-scoped. */
export async function getCitationsForAddBack(id: string): Promise<CitationRowForClient[]> {
  await requireAddBackAccess(id, 'case:read')
  const rows = await prisma.evidenceCitation.findMany({
    where:   { addBackId: id },
    orderBy: { createdAt: 'asc' },
    select:  CITATION_SELECT,
  })
  return rows.map(toClientShape)
}

/** List every citation for a ValuationModel, oldest-first. Tenant-scoped. */
export async function getCitationsForValuationModel(id: string): Promise<CitationRowForClient[]> {
  await requireValuationModelAccess(id, 'case:read')
  const rows = await prisma.evidenceCitation.findMany({
    where:   { valuationModelId: id },
    orderBy: { createdAt: 'asc' },
    select:  CITATION_SELECT,
  })
  return rows.map(toClientShape)
}

/**
 * Produce a pre-signed S3 URL for the DocumentVersion a citation points
 * at, appended with `#page=N` when the citation carries a confident page
 * number. Most PDF viewers (Chrome, Firefox, Safari, Adobe Reader) honor
 * that fragment for auto-scrolling.
 *
 * Refuses to sign if the DocumentVersion is archived or its scanStatus
 * isn't CLEAN — matches Slice 5's download-gate rules.
 */
export async function getCitationSourceUrl(citationId: string): Promise<{ url: string; expiresInSeconds: number }> {
  // Load the citation with just enough context to run the version-level
  // tenant check.
  const c = await prisma.evidenceCitation.findUnique({
    where: { id: citationId },
    select: {
      documentVersionId: true,
      pageNumber: true,
      isConfident: true,
    },
  })
  if (!c) throw new NotFoundError()

  const { session, version } = await requireDocumentVersionAccess(c.documentVersionId, 'case:read')
  if (version.isArchived) throw new NotFoundError()
  if (version.scanStatus !== 'CLEAN') {
    throw new Error(`Source unavailable: scan status is ${version.scanStatus}`)
  }

  const signed = await getSignedUrl(
    s3Client as any,
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: version.s3Key }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
  )

  // Only append the page fragment when the AI or analyst was confident
  // about it. We refuse to fabricate navigation targets.
  const url = c.isConfident && c.pageNumber
    ? `${signed}#page=${c.pageNumber}`
    : signed

  await logAction({
    userId: session.userId, action: 'DOWNLOAD_DOCUMENT_VERSION',
    caseId: version.document.caseId,
    targetModel: 'EvidenceCitation', targetId: citationId,
    note: `via citation`,
    newValue: { versionNumber: version.versionNumber, pageNumber: c.pageNumber },
  })

  return { url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS }
}

/**
 * Attach a manually-authored citation to a FinancialValue. Used by future
 * "analyst adds source" UI. Not called from Slice 7 UI; exposed so tests
 * and follow-up slices can build on top of it without re-inventing the
 * auth path.
 */
export async function attachManualCitationToFinancialValue(input: {
  financialValueId:  string
  documentVersionId: string
  pageNumber?:  number | null
  sourceLabel?: string | null
  rowLabel?:    string | null
  columnLabel?: string | null
  rawText?:     string | null
}): Promise<{ id: string }> {
  const { session, value } = await requireFinancialValueAccess(input.financialValueId, 'value:accept')
  // Ensure the referenced DocumentVersion is in the same org.
  await requireDocumentVersionAccess(input.documentVersionId, 'case:read')

  const created = await prisma.evidenceCitation.create({
    data: {
      documentVersionId: input.documentVersionId,
      financialValueId:  input.financialValueId,
      pageNumber:  input.pageNumber  ?? null,
      sourceLabel: input.sourceLabel ?? null,
      rowLabel:    input.rowLabel    ?? null,
      columnLabel: input.columnLabel ?? null,
      rawText:     input.rawText     ?? null,
      extractor:        'analyst',
      extractorVersion: session.userId,
      isConfident: true, // a human just told us, so this is confident by definition
    },
  })
  await logAction({
    userId: session.userId,
    action: 'ACCEPT_VALUE',
    caseId: value.caseId,
    targetModel: 'EvidenceCitation', targetId: created.id,
    note: 'manual citation attached',
  })
  return { id: created.id }
}
