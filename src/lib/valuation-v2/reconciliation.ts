/**
 * Reconciliation across approaches.
 *
 * `ReconciliationApproach.weight` is any positive scale; the caller
 * doesn't need to normalize. `computeReconciliation` returns the
 * weighted enterprise value and — if a `bridge` + `ownership` are
 * supplied — folds them into the equity value.
 *
 * The persisted reconciliation refuses to compute unless the caller
 * has verified every material assumption is APPROVED
 * (`hasBlockingAssumptions === false`). The math library takes a
 * `strict` flag: when true, an included approach with a null
 * indicated value throws instead of being treated as zero.
 */

import { money, moneyAdd, moneyMul, moneyDiv, moneySum, type Money, type MoneyInput } from '@/lib/money'
import { computeBridge, type BridgeItemInput } from './bridge'
import { applyOwnershipDiscounts, type OwnershipDiscountRow } from './ownership'

export interface ReconciliationApproach {
  id?:             string
  kind:            string
  isIncluded:      boolean
  weight:          MoneyInput
  indicatedValue?: MoneyInput | null
}

export interface ReconciliationInput {
  approaches: ReconciliationApproach[]
  bridge?:    BridgeItemInput[]
  ownership?: OwnershipDiscountRow[]  // MUST all be APPROVED — applyOwnershipDiscounts enforces
  strict?:    boolean                 // throw on missing indicatedValue in an included approach
}

export interface ReconciliationResult {
  totalWeight:      Money
  enterpriseValue:  Money
  bridgeNet:        Money
  equityValue:      Money
  ownershipDiscount: Money
  ownershipValue:    Money
}

export function computeReconciliation(input: ReconciliationInput): ReconciliationResult {
  const included = input.approaches.filter(a => a.isIncluded)
  if (input.strict) {
    for (const a of included) {
      if (a.indicatedValue == null) {
        throw new RangeError(
          `computeReconciliation: strict mode — included approach ${a.kind} has no indicatedValue`,
        )
      }
    }
  }

  const totalWeight = moneySum(included.map(a => a.weight))
  let enterpriseValue: Money
  if (totalWeight.isZero()) {
    enterpriseValue = money(0)
  } else {
    let acc = money(0)
    for (const a of included) {
      const v = a.indicatedValue ?? 0
      acc = moneyAdd(acc, moneyDiv(moneyMul(v, a.weight), totalWeight))
    }
    enterpriseValue = acc
  }

  const bridgeResult = computeBridge(enterpriseValue, input.bridge ?? [])
  let ownershipDiscount = money(0)
  let ownershipValue    = bridgeResult.equityValue

  if (input.ownership && input.ownership.length > 0) {
    const applied = applyOwnershipDiscounts(bridgeResult.equityValue, input.ownership)
    ownershipDiscount = applied.cumulativeDiscount
    ownershipValue    = applied.discountedValue
  }

  return {
    totalWeight,
    enterpriseValue,
    bridgeNet:   bridgeResult.bridgeNet,
    equityValue: bridgeResult.equityValue,
    ownershipDiscount,
    ownershipValue,
  }
}
