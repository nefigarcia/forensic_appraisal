/**
 * Reported → Normalized EBITDA bridge.
 *
 * Bridge math (per year):
 *
 *     reported EBITDA
 *   ± adjustment_1 (ADD or SUBTRACT, per direction)
 *   ± adjustment_2
 *   ...
 *   = normalized EBITDA
 *
 * Every value is Prisma.Decimal end-to-end. Only APPROVED adjustments
 * flow into the normalized value — DRAFT / PROPOSED / NEEDS_SUPPORT /
 * REJECTED are shown in the workbench for context but never modify the
 * bridge total. Rule "do not silently include unapproved work".
 *
 * Periods supported: currently 'year2', 'year1', 'ttm' — matches the
 * three columns on `AddBack`. Extension to N years is a follow-up
 * (see docs/architecture/NORMALIZATION_WORKBENCH.md).
 */

import { money, moneyAdd, moneySub, moneySum, type Money, type MoneyInput } from '@/lib/money'

export type Period = 'year2' | 'year1' | 'ttm'

export const PERIODS: readonly Period[] = ['year2', 'year1', 'ttm'] as const

export interface AdjustmentBridgeInput {
  id:          string
  direction:   'ADD' | 'SUBTRACT'
  status:      string
  amounts:     Partial<Record<Period, MoneyInput | null>>
}

export interface BridgeYearResult {
  period:      Period
  reported:    Money
  netAdjustment: Money   // signed: positive means normalized > reported
  normalized:  Money
  appliedAdjustments: number  // count of APPROVED adjustments touching this period
}

export interface BridgeResult {
  perPeriod: Record<Period, BridgeYearResult>
  totalReported:      Money
  totalNormalized:    Money
  approvedCount:      number
  ignoredCount:       number  // non-APPROVED adjustments that are shown in the UI but not bridged
}

/**
 * Compute the bridge for one period. Only counts APPROVED adjustments.
 * `direction === 'SUBTRACT'` reduces normalized (adjustment amount is
 * treated as a positive value; the sign comes from `direction`).
 */
export function bridgeForPeriod(
  period:   Period,
  reported: MoneyInput,
  adjustments: AdjustmentBridgeInput[],
): BridgeYearResult {
  const reportedD = money(reported)
  let net = money(0)
  let count = 0
  for (const a of adjustments) {
    if (a.status !== 'APPROVED') continue
    const raw = a.amounts[period]
    if (raw == null) continue
    const amt = money(raw)
    net = a.direction === 'SUBTRACT' ? moneySub(net, amt) : moneyAdd(net, amt)
    count++
  }
  return {
    period,
    reported: reportedD,
    netAdjustment: net,
    normalized: moneyAdd(reportedD, net),
    appliedAdjustments: count,
  }
}

/** Compute the full bridge across all supported periods. */
export function computeBridge(
  reportedByPeriod: Partial<Record<Period, MoneyInput | null | undefined>>,
  adjustments:      AdjustmentBridgeInput[],
): BridgeResult {
  const per: Partial<Record<Period, BridgeYearResult>> = {}
  for (const p of PERIODS) {
    per[p] = bridgeForPeriod(p, reportedByPeriod[p] ?? 0, adjustments)
  }
  const totalReported   = moneySum(PERIODS.map(p => per[p]!.reported))
  const totalNormalized = moneySum(PERIODS.map(p => per[p]!.normalized))
  const approvedCount   = adjustments.filter(a => a.status === 'APPROVED').length
  const ignoredCount    = adjustments.length - approvedCount
  return {
    perPeriod: {
      year2: per.year2!, year1: per.year1!, ttm: per.ttm!,
    },
    totalReported,
    totalNormalized,
    approvedCount,
    ignoredCount,
  }
}
