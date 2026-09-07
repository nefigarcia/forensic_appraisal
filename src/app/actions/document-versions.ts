'use server'

import { prisma } from '@/lib/prisma'
import { logAction } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { s3Client, BUCKET_NAME } from '@/lib/s3-client'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireDocumentAccess, requireDocumentVersionAccess, NotFoundError } from '@/lib/authz'

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60 // 5 minutes

/**
 * List every version of a document, newest first, tenant-scoped.
 *
 * Returns the shape the version-history UI needs. `sizeBytes` is converted
 * to a Number for JSON serialization; DocumentVersion holds it as BigInt
 * (max ~9 EB — the Number bounce is safe up to 8 PB, well past the 100 MB
 * upload ceiling).
 */
export async function getDocumentVersions(documentId: string) {
  const { document } = await requireDocumentAccess(documentId, 'case:read')

  const rows = await prisma.documentVersion.findMany({
    where: { documentId: document.id },
    orderBy: { versionNumber: 'desc' },
  })

  return rows.map(r => ({
    id:            r.id,
    versionNumber: r.versionNumber,
    sha256Hash:    r.sha256Hash,
    sizeBytes:     Number(r.sizeBytes),
    mimeType:      r.mimeType,
    originalName:  r.originalName,
    uploadedBy:    r.uploadedBy,
    uploadedAt:    r.uploadedAt,
    scanStatus:    r.scanStatus,
    isArchived:    r.isArchived,
    archivedAt:    r.archivedAt,
    archiveReason: r.archiveReason,
  }))
}

/**
 * Return a pre-signed S3 URL for a specific version. Tenant-scoped via
 * requireDocumentVersionAccess. Refuses to sign if:
 *   - the version is archived
 *   - its scanStatus is not CLEAN
 *
 * The URL is short-lived (5 minutes) and the download is audited.
 */
export async function getVersionDownloadUrl(versionId: string): Promise<{ url: string; expiresInSeconds: number }> {
  const { session, version } = await requireDocumentVersionAccess(versionId, 'case:read')

  if (version.isArchived) throw new NotFoundError()
  if (version.scanStatus !== 'CLEAN') {
    throw new Error(`Download blocked: scan status is ${version.scanStatus}`)
  }

  // Types diverge slightly between s3-request-presigner and client-s3 across
  // SDK minor versions; runtime is compatible. Cast to work around the
  // structural-type mismatch until both deps are on the same minor.
  const url = await getSignedUrl(
    s3Client as any,
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: version.s3Key }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
  )

  await logAction({
    userId: session.userId, action: 'DOWNLOAD_DOCUMENT_VERSION',
    caseId: version.document.caseId,
    targetModel: 'DocumentVersion', targetId: versionId,
    newValue: { versionNumber: version.versionNumber, sha256Hash: version.sha256Hash },
  })

  return { url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS }
}

/**
 * Soft-archive a specific version. If it was the document's current
 * version, `currentVersionId` is repointed at the newest non-archived
 * version (or nulled if none remain).
 */
export async function archiveDocumentVersion(versionId: string, reason?: string) {
  const { session, version } = await requireDocumentVersionAccess(versionId, 'document:delete')

  await prisma.$transaction(async (tx) => {
    await tx.documentVersion.update({
      where: { id: versionId },
      data: {
        isArchived:    true,
        archivedAt:    new Date(),
        archivedBy:    session.userId,
        archiveReason: reason ?? 'no reason provided',
      },
    })

    // If we just archived the current version, repoint the document.
    const doc = await tx.document.findUnique({ where: { id: version.documentId } })
    if (doc?.currentVersionId === versionId) {
      const nextCurrent = await tx.documentVersion.findFirst({
        where: { documentId: version.documentId, isArchived: false },
        orderBy: { versionNumber: 'desc' },
      })
      await tx.document.update({
        where: { id: version.documentId },
        data:  {
          currentVersionId: nextCurrent?.id ?? null,
          s3Key:            nextCurrent?.s3Key ?? null,
          sha256Hash:       nextCurrent?.sha256Hash ?? null,
        },
      })
    }
  })

  await logAction({
    userId: session.userId, action: 'ARCHIVE_DOCUMENT_VERSION',
    caseId: version.document.caseId,
    targetModel: 'DocumentVersion', targetId: versionId,
    note: reason,
  })

  revalidatePath(`/projects/${version.document.caseId}`)
}

/**
 * Restore a previously-archived version. Repoints the document's current
 * version if the restored version has a higher version number than the
 * present current.
 */
export async function restoreDocumentVersion(versionId: string) {
  const { session, version } = await requireDocumentVersionAccess(versionId, 'document:upload')

  await prisma.$transaction(async (tx) => {
    await tx.documentVersion.update({
      where: { id: versionId },
      data: {
        isArchived:    false,
        archivedAt:    null,
        archivedBy:    null,
        archiveReason: null,
      },
    })
    const doc = await tx.document.findUnique({ where: { id: version.documentId } })
    const current = doc?.currentVersionId
      ? await tx.documentVersion.findUnique({ where: { id: doc.currentVersionId } })
      : null
    if (!current || version.versionNumber > current.versionNumber) {
      await tx.document.update({
        where: { id: version.documentId },
        data: {
          currentVersionId: versionId,
          s3Key:            version.s3Key,
          sha256Hash:       version.sha256Hash,
        },
      })
    }
  })

  await logAction({
    userId: session.userId, action: 'RESTORE_DOCUMENT_VERSION',
    caseId: version.document.caseId,
    targetModel: 'DocumentVersion', targetId: versionId,
  })

  revalidatePath(`/projects/${version.document.caseId}`)
}
