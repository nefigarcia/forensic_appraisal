/**
 * Market approach math — guideline public companies and transactions.
 *
 * The functions here compute descriptive statistics (min, max, median,
 * mean) over an included set of guideline rows, then multiply the
 * subject-company metric by the chosen central-tendency multiple.
 *
 * Central tendency is a PROFESSIONAL choice — the analyst picks the
 * statistic they intend to use (median is common). This module never
 * decides "which multiple to apply"; it computes each central-tendency
 * value so the caller can pin one via a `ValuationAssumption` row.
 */

import { money, moneyMul, moneyDiv, moneyAdd, type Money, type MoneyInput } from '@/lib/money'

// ─────────────────────────────────────────────────
// Descriptive statistics on a set of Decimal multiples
// ─────────────────────────────────────────────────

export interface MultipleStats {
  count:  number
  min:    Money
  max:    Money
  mean:   Money
  median: Money
}

/**
 * Compute descriptive stats. Non-numeric / null entries are excluded.
 * Returns count=0 statistics filled with zeroes when the set is empty
 * — the caller should not display those.
 */
export function multipleStats(values: Array<MoneyInput | null | undefined>): MultipleStats {
  const nums: Money[] = []
  for (const v of values) {
    if (v === null || v === undefined) continue
    try {
      const m = money(v)
      // Skip NaN (can leak through if a caller stringifies a JS NaN).
      if (m.isNaN()) continue
      nums.push(m)
    } catch { /* ignore */ }
  }
  if (nums.length === 0) {
    const zero = money(0)
    return { count: 0, min: zero, max: zero, mean: zero, median: zero }
  }
  nums.sort((a, b) => a.comparedTo(b))
  const min = nums[0]!
  const max = nums[nums.length - 1]!
  let acc = money(0)
  for (const n of nums) acc = moneyAdd(acc, n)
  const mean = moneyDiv(acc, nums.length)
  const median = nums.length % 2 === 1
    ? nums[(nums.length - 1) / 2]!
    : moneyDiv(moneyAdd(nums[nums.length / 2 - 1]!, nums[nums.length / 2]!), 2)
  return { count: nums.length, min, max, mean, median }
}

// ─────────────────────────────────────────────────
// Apply a multiple to a subject metric
// ─────────────────────────────────────────────────

export interface MarketIndicationInput {
  subjectMetric: MoneyInput   // e.g. subject-company EBITDA
  multiple:      MoneyInput   // e.g. median EV/EBITDA
}

export function marketIndication(input: MarketIndicationInput): Money {
  return moneyMul(input.subjectMetric, input.multiple)
}

// ─────────────────────────────────────────────────
// Guideline aggregations
// ─────────────────────────────────────────────────

export interface GuidelineCompanyRow {
  evRevenue?: MoneyInput | null
  evEbitda?:  MoneyInput | null
  peRatio?:   MoneyInput | null
  isIncluded?: boolean
}

export interface GuidelineCompanyStats {
  evRevenue: MultipleStats
  evEbitda:  MultipleStats
  peRatio:   MultipleStats
}

export function guidelineCompanyStats(rows: GuidelineCompanyRow[]): GuidelineCompanyStats {
  const included = rows.filter(r => r.isIncluded !== false)
  return {
    evRevenue: multipleStats(included.map(r => r.evRevenue)),
    evEbitda:  multipleStats(included.map(r => r.evEbitda)),
    peRatio:   multipleStats(included.map(r => r.peRatio)),
  }
}

export interface GuidelineTransactionRow {
  evRevenue?: MoneyInput | null
  evEbitda?:  MoneyInput | null
  isIncluded?: boolean
}

export interface GuidelineTransactionStats {
  evRevenue: MultipleStats
  evEbitda:  MultipleStats
}

export function guidelineTransactionStats(rows: GuidelineTransactionRow[]): GuidelineTransactionStats {
  const included = rows.filter(r => r.isIncluded !== false)
  return {
    evRevenue: multipleStats(included.map(r => r.evRevenue)),
    evEbitda:  multipleStats(included.map(r => r.evEbitda)),
  }
}
