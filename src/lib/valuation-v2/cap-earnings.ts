/**
 * Capitalization of Earnings.
 *
 *   IndicatedValue = NormalizedEarnings / CapitalizationRate
 *
 * The workbench lets the analyst enter either:
 *   - a direct `capitalizationRate` (a.k.a. cap rate), OR
 *   - the pair (`discountRate`, `growthRate`); cap rate is r - g.
 */

import { money, moneyDiv, moneySub, type Money, type MoneyInput } from '@/lib/money'

export interface CapEarningsInput {
  normalizedEarnings: MoneyInput
  capitalizationRate?: MoneyInput
  discountRate?:       MoneyInput
  growthRate?:         MoneyInput
}

export interface CapEarningsResult {
  effectiveCapRate: Money
  indicatedValue:   Money
}

/**
 * Resolve the effective cap rate from the input, preferring an
 * explicit `capitalizationRate`. Throws when neither route yields a
 * strictly positive cap rate (a zero or negative cap rate would make
 * the perpetuity diverge or reverse — dangerous to persist).
 */
export function computeCapEarnings(input: CapEarningsInput): CapEarningsResult {
  let capRate: Money
  if (input.capitalizationRate != null) {
    capRate = money(input.capitalizationRate)
  } else if (input.discountRate != null && input.growthRate != null) {
    capRate = moneySub(input.discountRate, input.growthRate)
  } else {
    throw new RangeError('computeCapEarnings: need capitalizationRate or (discountRate + growthRate)')
  }
  if (capRate.lte(0)) {
    throw new RangeError(`computeCapEarnings: cap rate must be > 0 (got ${capRate.toString()})`)
  }
  const value = moneyDiv(input.normalizedEarnings, capRate)
  return { effectiveCapRate: capRate, indicatedValue: value }
}
