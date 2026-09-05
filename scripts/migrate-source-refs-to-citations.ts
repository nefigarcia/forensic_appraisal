/* eslint-disable no-console */

/**
 * Slice 7 — one-time backfill: promote the legacy free-text
 * `FinancialValue.sourceRef` field into a structured EvidenceCitation
 * row pointing at the (current) DocumentVersion of the parent document.
 *
 * Anti-hallucination discipline (Rule 9): we DO NOT parse "page 4, table
 * 2, row 'Revenue'" out of the free text. That's the exact fabrication
 * the rule forbids. Instead:
 *
 *   - We create one citation per FinancialValue that has a sourceRef.
 *   - We set sourceLabel = the original sourceRef (unchanged).
 *   - pageNumber / tableName / rowLabel / columnLabel / boundingBox all
 *     stay NULL.
 *   - extractor = 'legacy-backfill', isConfident = false.
 *
 * The UI can then show "AI unsure — legacy backfill" with the original
 * text label instead of pretending to know a page number that nobody
 * verified.
 *
 * Usage:
 *   npx tsx scripts/migrate-source-refs-to-citations.ts          # dry-run
 *   npx tsx scripts/migrate-source-refs-to-citations.ts --apply
 *
 * Idempotent: rows that already have any citation are skipped.
 */

import { prisma } from '../src/lib/prisma'

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`[migrate-source-refs-to-citations] mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)

  const values = await prisma.financialValue.findMany({
    where: {
      sourceRef:  { not: null },
      documentId: { not: null },
      citations:  { none: {} },
    },
    select: {
      id: true, sourceRef: true, documentId: true, confidence: true,
      document: { select: { currentVersionId: true, name: true } },
    },
  })
  console.log(`[migrate-source-refs-to-citations] ${values.length} value(s) with legacy sourceRef and no citations yet`)

  let ok = 0
  let skippedNoVersion = 0
  let failed = 0

  for (const v of values) {
    if (!v.document?.currentVersionId) {
      skippedNoVersion++
      continue
    }
    try {
      if (apply) {
        await prisma.evidenceCitation.create({
          data: {
            documentVersionId: v.document.currentVersionId,
            financialValueId:  v.id,
            pageNumber:  null,       // never guessed — Rule 9
            sourceLabel: v.sourceRef, // preserve the original free text as-is
            tableName:   null,
            rowLabel:    null,
            columnLabel: null,
            boundingBox: undefined,   // JSON stays NULL
            rawText:     null,
            extractor:        'legacy-backfill',
            extractorVersion: 'sourceRef-preserve-v1',
            confidence:  v.confidence,
            isConfident: false,
          },
        })
      }
      ok++
    } catch (e) {
      failed++
      console.error(`  ✗ ${v.id}: ${(e as Error).message}`)
    }
  }

  console.log(`[migrate-source-refs-to-citations] migrated=${ok} skipped-no-version=${skippedNoVersion} failed=${failed}`)
  if (!apply) console.log('[migrate-source-refs-to-citations] dry-run — pass --apply to persist')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
