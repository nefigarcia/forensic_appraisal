/**
 * Ownership-level discounts (DLOC, DLOM, key-person, other).
 *
 *   Ownership discounts NEVER auto-apply.
 *
 * The invariants:
 *   1. `applyOwnershipDiscounts` requires the caller to pass rows
 *      pre-filtered by `status = APPROVED`. Passing a non-APPROVED
 *      row throws — a defense-in-depth guard against future callers
 *      that forget to filter.
 *   2. Every APPROVED row must carry a non-empty `rationale`. A row
 *      that reached APPROVED without one is a schema-invariant
 *      violation; we throw with a message that names the row id so
 *      the operator can find it.
 *   3. Multiple APPROVED rows compose *multiplicatively*, not
 *      additively — the finance convention. Applying a 30 % DLOC then
 *      a 20 % DLOM yields `equity * (1 - 0.30) * (1 - 0.20)` =
 *      `equity * 0.56`, not `equity * (1 - 0.50)`.
 *   4. Any single percent must be in [0, 1). ≥ 1 would drive the
 *      value to ≤ 0; that is (a) never what a real analyst wants and
 *      (b) usually a data-entry bug.
 */

import { money, moneyMul, moneySub, moneyDiv, type Money, type MoneyInput } from '@/lib/money'
import { isEffectiveAssumption, type AssumptionStatus } from './statuses'

export interface OwnershipDiscountRow {
  id?:        string             // for error messages
  kind:       string
  percent:    MoneyInput          // 0..1 fractional
  status:     AssumptionStatus
  rationale?: string | null
  source?:    string | null
}

export interface OwnershipDiscountResult {
  cumulativeDiscount: Money       // 1 - Π(1 - pi) — a single "effective" fraction
  effectiveMultiplier: Money      // Π(1 - pi) — the number equity is multiplied by
  discountedValue:     Money      // equityValue * effectiveMultiplier
}

/**
 * Apply APPROVED ownership discounts to an equity value.
 *
 * Every row must satisfy `isEffectiveAssumption(status) === true`
 * (i.e. APPROVED). Anything else throws. A caller that wants to
 * *preview* the effect of a DRAFT row must call `previewOwnershipDiscounts`
 * explicitly — that's a separate, explicitly-named function so the
 * intent is obvious in the diff.
 */
export function applyOwnershipDiscounts(
  equityValue: MoneyInput,
  rows: OwnershipDiscountRow[],
): OwnershipDiscountResult {
  for (const r of rows) {
    if (!isEffectiveAssumption(r.status)) {
      throw new Error(
        `applyOwnershipDiscounts: row ${r.id ?? '(no id)'} has status=${r.status} — ` +
        `only APPROVED rows may be applied. Use previewOwnershipDiscounts() to preview.`,
      )
    }
    if (!r.rationale || r.rationale.trim().length === 0) {
      throw new Error(
        `applyOwnershipDiscounts: APPROVED row ${r.id ?? '(no id)'} missing rationale`,
      )
    }
    const p = money(r.percent)
    if (p.lt(0) || p.gte(1)) {
      throw new RangeError(
        `applyOwnershipDiscounts: percent for ${r.kind} row ${r.id ?? '(no id)'} ` +
        `must be in [0, 1) (got ${p.toString()})`,
      )
    }
  }
  return finalizeOwnershipMath(equityValue, rows)
}

/**
 * Preview-only variant — takes ANY status. Used to power the "what
 * would this look like?" pane the analyst uses while iterating on a
 * DRAFT ownership adjustment. The result is deliberately not the same
 * type name as `applyOwnershipDiscounts` so the two paths cannot be
 * silently swapped at a call site.
 */
export interface OwnershipPreviewResult {
  cumulativeDiscount: Money
  effectiveMultiplier: Money
  previewValue:        Money
  includedCount:       number
}

export function previewOwnershipDiscounts(
  equityValue: MoneyInput,
  rows: OwnershipDiscountRow[],
): OwnershipPreviewResult {
  const r = finalizeOwnershipMath(equityValue, rows)
  return {
    cumulativeDiscount:  r.cumulativeDiscount,
    effectiveMultiplier: r.effectiveMultiplier,
    previewValue:        r.discountedValue,
    includedCount:       rows.length,
  }
}

function finalizeOwnershipMath(equityValue: MoneyInput, rows: OwnershipDiscountRow[]): OwnershipDiscountResult {
  let multiplier = money(1)
  for (const row of rows) {
    const p = money(row.percent)
    multiplier = moneyMul(multiplier, moneySub(1, p))
  }
  const discounted = moneyMul(equityValue, multiplier)
  const cumulative = moneySub(1, multiplier)
  return {
    cumulativeDiscount:  cumulative,
    effectiveMultiplier: multiplier,
    discountedValue:     discounted,
  }
}

// Keep the moneyDiv reference for potential future weighting variants.
void moneyDiv
