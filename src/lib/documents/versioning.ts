/**
 * DocumentVersion helpers — S3 key generation, per-version hashing, and
 * version-number selection.
 *
 * The immutability rule is enforced by convention: this module never
 * updates a DocumentVersion. It only reads existing rows and inserts new
 * ones. The only mutation any caller should ever apply to a DocumentVersion
 * is flipping `isArchived` — every other change means a new version.
 */

import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sanitizeFilename } from './validation'

/**
 * Build a self-describing S3 key. Includes org, case, document, and
 * version so a stray prefix-delete on `orgs/<orgA>/` cannot touch
 * another organization's evidence.
 */
export function buildS3Key(args: {
  organizationId: string
  caseId:         string
  documentId:     string
  versionNumber:  number
  originalName:   string
}): string {
  return [
    'orgs',
    args.organizationId,
    'cases',
    args.caseId,
    'documents',
    args.documentId,
    'versions',
    String(args.versionNumber),
    sanitizeFilename(args.originalName),
  ].join('/')
}

export function sha256HexOf(buffer: Uint8Array | Buffer): string {
  return createHash('sha256').update(buffer as Buffer).digest('hex')
}

/**
 * Find the next version number for a given document. Uses a single query
 * against the `(documentId, versionNumber)` unique index. Assumes callers
 * hold no external lock; the DB unique constraint will reject a duplicate
 * insert if two uploads race, and callers can retry.
 */
export async function nextVersionNumberFor(documentId: string): Promise<number> {
  const last = await prisma.documentVersion.findFirst({
    where: { documentId },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  })
  return (last?.versionNumber ?? 0) + 1
}

/**
 * Find an existing Document in a case with a matching (case-insensitive)
 * original filename. Analysts "reload the same file" all the time — that
 * should become a new *version* rather than a whole new document.
 */
export async function findDocumentByFilenameInCase(
  caseId: string,
  originalName: string,
): Promise<{ id: string } | null> {
  const normalized = originalName.trim().toLowerCase()
  const matches = await prisma.document.findMany({
    where: { caseId, isArchived: false },
    select: { id: true, name: true },
  })
  const hit = matches.find(d => d.name.trim().toLowerCase() === normalized)
  return hit ? { id: hit.id } : null
}
