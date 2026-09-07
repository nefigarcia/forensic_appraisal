/* eslint-disable no-console */

/**
 * Slice 5 — one-time backfill.
 *
 * For every existing Document row that has no DocumentVersion, create a v1
 * DocumentVersion from the legacy `s3Key` / `sha256Hash` / `size` columns
 * and point Document.currentVersionId at it. Existing S3 objects are not
 * moved; the version row records the pre-migration key as-is.
 *
 * Usage:
 *     npx tsx scripts/migrate-documents-to-versions.ts          # dry run
 *     npx tsx scripts/migrate-documents-to-versions.ts --apply
 *
 * Idempotent — rows with an existing DocumentVersion are skipped.
 */

import { prisma } from '../src/lib/prisma'

const SYSTEM_UPLOADER = 'system-backfill'

function bytesFromLegacySize(size: string): bigint {
  // Legacy format is "12.34 MB". Fall back to 0 if we can't parse.
  const m = /^([\d.]+)\s*(KB|MB|GB)?/i.exec(size)
  if (!m) return BigInt(0)
  const n   = Number.parseFloat(m[1]!)
  const mul = (m[2] ?? 'MB').toUpperCase() === 'KB' ? 1024
            : (m[2] ?? 'MB').toUpperCase() === 'GB' ? 1024 ** 3
            : 1024 ** 2
  return BigInt(Math.floor(n * mul))
}

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`[migrate-documents-to-versions] mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)

  const docs = await prisma.document.findMany({
    where: { currentVersionId: null },
    select: {
      id: true, caseId: true, name: true, type: true, size: true,
      s3Key: true, sha256Hash: true,
      versions: { select: { id: true }, take: 1 },
    },
  })
  console.log(`[migrate-documents-to-versions] ${docs.length} document(s) without a current version`)

  let migrated = 0
  let skippedNoS3 = 0
  let failed = 0

  for (const d of docs) {
    if (d.versions.length > 0) continue // already has versions
    if (!d.s3Key || !d.sha256Hash) {
      skippedNoS3++
      continue
    }
    try {
      if (apply) {
        const created = await prisma.$transaction(async (tx) => {
          const v = await tx.documentVersion.create({
            data: {
              documentId:    d.id,
              versionNumber: 1,
              s3Key:         d.s3Key!,
              sha256Hash:    d.sha256Hash!,
              sizeBytes:     bytesFromLegacySize(d.size),
              mimeType:      d.type || 'application/octet-stream',
              originalName:  d.name,
              uploadedBy:    SYSTEM_UPLOADER,
              scanStatus:    'CLEAN', // pre-existing docs are grandfathered
              scanReport:    'backfilled from legacy Document row',
              scannedAt:     new Date(),
            },
          })
          await tx.document.update({
            where: { id: d.id },
            data:  { currentVersionId: v.id },
          })
          return v
        })
        console.log(`  ✓ ${d.id} → v${created.versionNumber}`)
      }
      migrated++
    } catch (e) {
      failed++
      console.error(`  ✗ ${d.id}: ${(e as Error).message}`)
    }
  }

  console.log(`[migrate-documents-to-versions] migrated=${migrated} skipped-no-s3=${skippedNoS3} failed=${failed}`)
  if (!apply) console.log('[migrate-documents-to-versions] dry run — pass --apply to persist')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
