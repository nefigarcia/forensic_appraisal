/* eslint-disable no-console */

/**
 * Slice 4 — one-time backfill of the Decimal shadow columns from the
 * legacy Float columns on `FinancialValue`, `AddBack`, and
 * `ValuationModel`.
 *
 * Usage:
 *     npx tsx scripts/migrate-money-to-decimal.ts        # dry run
 *     npx tsx scripts/migrate-money-to-decimal.ts --apply
 *
 * The script is idempotent — rows where every Decimal shadow is already
 * populated are skipped. Rows are batched in updates of 500. Failures on
 * a single row are logged with the row id and do not abort the run.
 */

import { prisma } from '../src/lib/prisma'
import { money } from '../src/lib/money'

const BATCH = 500

async function migrateFinancialValues(apply: boolean) {
  let migrated = 0
  let cursor: string | undefined
  for (;;) {
    const rows = await prisma.financialValue.findMany({
      where: {
        OR: [
          { valueDecimal:            null, value:            { not: 0 } },
          { aiSuggestedValueDecimal: null, aiSuggestedValue: { not: null } },
        ],
      },
      select: {
        id: true, value: true, aiSuggestedValue: true,
        valueDecimal: true, aiSuggestedValueDecimal: true,
      },
      take:   BATCH,
      cursor: cursor ? { id: cursor } : undefined,
      skip:   cursor ? 1 : 0,
      orderBy: { id: 'asc' },
    })
    if (rows.length === 0) break
    for (const r of rows) {
      try {
        if (apply) {
          await prisma.financialValue.update({
            where: { id: r.id },
            data: {
              valueDecimal:            r.valueDecimal            ?? money(r.value),
              aiSuggestedValueDecimal: r.aiSuggestedValueDecimal ?? (r.aiSuggestedValue != null ? money(r.aiSuggestedValue) : null),
            },
          })
        }
        migrated++
      } catch (e) {
        console.error(`[FinancialValue ${r.id}]`, (e as Error).message)
      }
    }
    cursor = rows[rows.length - 1]!.id
    if (rows.length < BATCH) break
  }
  return migrated
}

async function migrateAddBacks(apply: boolean) {
  let migrated = 0
  const rows = await prisma.addBack.findMany({
    where: {
      OR: [
        { year2Decimal: null, year2: { not: null } },
        { year1Decimal: null, year1: { not: null } },
        { ttmDecimal:   null, ttm:   { not: null } },
      ],
    },
    select: {
      id: true, year2: true, year1: true, ttm: true,
      year2Decimal: true, year1Decimal: true, ttmDecimal: true,
    },
  })
  for (const r of rows) {
    try {
      if (apply) {
        await prisma.addBack.update({
          where: { id: r.id },
          data: {
            year2Decimal: r.year2Decimal ?? (r.year2 != null ? money(r.year2) : null),
            year1Decimal: r.year1Decimal ?? (r.year1 != null ? money(r.year1) : null),
            ttmDecimal:   r.ttmDecimal   ?? (r.ttm   != null ? money(r.ttm)   : null),
          },
        })
      }
      migrated++
    } catch (e) {
      console.error(`[AddBack ${r.id}]`, (e as Error).message)
    }
  }
  return migrated
}

async function migrateValuationModels(apply: boolean) {
  let migrated = 0
  const rows = await prisma.valuationModel.findMany({
    where: { indicatedValueDecimal: null }, // one column serves as the presence flag
  })
  for (const r of rows) {
    try {
      const copy = <T,>(f: T | null | undefined) => (f == null ? null : money(f as any))
      if (apply) {
        await prisma.valuationModel.update({
          where: { id: r.id },
          data: {
            ebitdaDecimal:            copy(r.ebitda),
            multiplierDecimal:        copy(r.multiplier),
            growthRateDecimal:        copy(r.growthRate),
            dcfYear1Decimal:          copy(r.dcfYear1),
            dcfYear2Decimal:          copy(r.dcfYear2),
            dcfYear3Decimal:          copy(r.dcfYear3),
            dcfYear4Decimal:          copy(r.dcfYear4),
            dcfYear5Decimal:          copy(r.dcfYear5),
            terminalGrowthDecimal:    copy(r.terminalGrowth),
            discountRateDecimal:      copy(r.discountRate),
            riskFreeRateDecimal:      copy(r.riskFreeRate),
            equityRiskPremiumDecimal: copy(r.equityRiskPremium),
            sizePremiumDecimal:       copy(r.sizePremium),
            specificRiskDecimal:      copy(r.specificRisk),
            indicatedValueDecimal:    copy(r.indicatedValue),
            weightDecimal:            copy(r.weight),
          },
        })
      }
      migrated++
    } catch (e) {
      console.error(`[ValuationModel ${r.id}]`, (e as Error).message)
    }
  }
  return migrated
}

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`[migrate-money-to-decimal] mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
  const fv = await migrateFinancialValues(apply)
  const ab = await migrateAddBacks(apply)
  const vm = await migrateValuationModels(apply)
  console.log(`[migrate-money-to-decimal] FinancialValue: ${fv}, AddBack: ${ab}, ValuationModel: ${vm}`)
  if (!apply) console.log('[migrate-money-to-decimal] dry run — pass --apply to persist')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
