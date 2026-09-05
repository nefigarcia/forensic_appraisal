/**
 * Tie-out status computation.
 *
 * Deterministic. Given N item values and an effective tolerance, we
 * classify a tie-out into one of:
 *
 *   TIED               all values numerically equal
 *   WITHIN_TOLERANCE   max pairwise difference <= tolerance
 *   DISCREPANCY        max pairwise difference > tolerance
 *   UNRESOLVED         < 2 items (can't reconcile a single source)
 *
 * The RESOLVED status is human-only: reviewer explicitly marked a
 * DISCREPANCY as resolved with an explanation. The engine never
 * transitions to RESOLVED on its own — Rule: "never automatically hide
 * material discrepancies".
 */

import { money, moneyMul, moneySub, type Money, type MoneyInput } from '@/lib/money'
import type { Tolerance } from './concepts'

export type ComputedStatus =
  | 'TIED'
  | 'WITHIN_TOLERANCE'
  | 'DISCREPANCY'
  | 'UNRESOLVED'

export interface ComputeResult {
  status:        ComputedStatus
  maxDifference: Money   // max pairwise |a - b|; 0 for 0-1 item tie-outs
  median:        Money
}

/**
 * Median of a Decimal list. Sort in ascending order and take the middle
 * (or the average of the two middles for even N). We keep this in pure
 * Decimal so we never fall through to JS Number for tolerance math.
 */
export function median(values: Money[]): Money {
  if (values.length === 0) return money(0)
  const sorted = [...values].sort((a, b) => (a.cmp(b)))
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]!
  return sorted[mid - 1]!.plus(sorted[mid]!).div(2)
}

/**
 * Max pairwise absolute difference. For sorted values this is just
 * max - min, which is faster and equivalent to iterating all pairs.
 */
export function maxPairwiseDifference(values: Money[]): Money {
  if (values.length < 2) return money(0)
  let min = values[0]!
  let max = values[0]!
  for (const v of values) {
    if (v.lt(min)) min = v
    if (v.gt(max)) max = v
  }
  return max.minus(min)
}

/**
 * Effective tolerance = max(absolute, percent * |median|). A single
 * threshold that satisfies EITHER the absolute or the percent rule.
 */
export function effectiveTolerance(medianValue: Money, tolerance: Tolerance): Money {
  const absAbsolute = tolerance.absolute.abs()
  const absPercent  = moneyMul(medianValue.abs(), tolerance.percent).abs()
  return absAbsolute.gt(absPercent) ? absAbsolute : absPercent
}

/**
 * Main API. Returns the deterministic status a tie-out should carry
 * based on its item values and effective tolerance. Callers layer the
 * `RESOLVED` state on top when a human has explicitly resolved the
 * DISCREPANCY.
 */
export function computeTieOutStatus(values: MoneyInput[], tolerance: Tolerance): ComputeResult {
  const items = values.map(money)
  if (items.length < 2) {
    return {
      status:        'UNRESOLVED',
      maxDifference: money(0),
      median:        items[0] ?? money(0),
    }
  }

  const med = median(items)
  const maxDiff = maxPairwiseDifference(items)
  if (maxDiff.isZero()) {
    return { status: 'TIED', maxDifference: maxDiff, median: med }
  }
  const eff = effectiveTolerance(med, tolerance)
  const status: ComputedStatus = maxDiff.lte(eff) ? 'WITHIN_TOLERANCE' : 'DISCREPANCY'
  return { status, maxDifference: maxDiff, median: med }
}

/** Sort order for the dashboard: discrepancies come first, never hidden. */
export const DASHBOARD_SORT_ORDER: Record<'DISCREPANCY' | 'UNRESOLVED' | 'RESOLVED' | 'WITHIN_TOLERANCE' | 'TIED', number> = {
  DISCREPANCY:      0,
  UNRESOLVED:       1,
  RESOLVED:         2,
  WITHIN_TOLERANCE: 3,
  TIED:             4,
}

// Keep the money helpers imported so the module surface is stable for
// callers importing from '@/lib/tie-out/status'.
export { moneySub }
