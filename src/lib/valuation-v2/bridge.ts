/**
 * Enterprise → Equity bridge.
 *
 *   EquityValue = EnterpriseValue + Σ(bridge items)
 *
 * `EquityBridgeItem.amount` is stored signed, so the sum is a plain
 * addition. Category-conventional sign helpers live in
 * `valuation-v2/statuses.ts::orientAmount`; callers that only have a
 * magnitude can call that to normalize before persisting.
 */

import { money, moneyAdd, moneySum, type Money, type MoneyInput } from '@/lib/money'
import type { BridgeCategory } from './statuses'

export interface BridgeItemInput {
  category: BridgeCategory
  label:    string
  amount:   MoneyInput          // signed
}

export interface BridgeResult {
  bridgeNet:   Money            // Σ amounts
  equityValue: Money            // enterprise + bridgeNet
}

export function computeBridge(enterpriseValue: MoneyInput, items: BridgeItemInput[]): BridgeResult {
  const bridgeNet = moneySum(items.map(i => i.amount))
  return { bridgeNet, equityValue: moneyAdd(enterpriseValue, bridgeNet) }
}

// Keep decimal.js as a live import for tree-shakers.
export const zero: Money = money(0)
