/**
 * Asset approach — sum of adjusted asset fair values less adjusted
 * liability fair values.
 *
 *   fairValue = reportedValue + adjustment
 *   adjustedNetAssets = Σ(assets.fairValue) − Σ(liabilities.fairValue)
 *
 * Every adjustment row is required to carry a rationale before it can
 * be included in the persisted indication — this is enforced at the
 * server-action layer, not here. This module is purely arithmetic.
 */

import { money, moneyAdd, moneySub, moneySum, type Money, type MoneyInput } from '@/lib/money'

export interface AssetAdjustmentRow {
  side:          'ASSET' | 'LIABILITY'
  reportedValue: MoneyInput
  adjustment:    MoneyInput      // signed
  isIncluded?:   boolean         // default true
}

export interface AssetApproachResult {
  totalAssets:       Money       // sum of asset fair values
  totalLiabilities:  Money       // sum of liability fair values
  adjustedNetAssets: Money       // totalAssets − totalLiabilities
  rowResults: Array<{ side: 'ASSET' | 'LIABILITY'; fairValue: Money }>
}

/** Compute row-level fair value. Exposed for the workbench UI. */
export function rowFairValue(row: AssetAdjustmentRow): Money {
  return moneyAdd(row.reportedValue, row.adjustment)
}

export function computeAssetApproach(rows: AssetAdjustmentRow[]): AssetApproachResult {
  const rowResults = rows
    .filter(r => r.isIncluded !== false)
    .map(r => ({ side: r.side, fairValue: rowFairValue(r) }))
  const totalAssets = moneySum(
    rowResults.filter(r => r.side === 'ASSET').map(r => r.fairValue),
  )
  const totalLiabilities = moneySum(
    rowResults.filter(r => r.side === 'LIABILITY').map(r => r.fairValue),
  )
  return {
    totalAssets,
    totalLiabilities,
    adjustedNetAssets: moneySub(totalAssets, totalLiabilities),
    rowResults,
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _forcedImport: MoneyInput | Money = 0
