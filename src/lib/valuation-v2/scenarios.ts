/**
 * Scenario helpers.
 *
 * Scenarios (Base / Low / High / custom) each produce their own
 * enterprise value + equity value + ownership-discounted value.
 * This module aggregates them for the workbench dashboard.
 *
 * A scenario's `probability` (0..1) is OPTIONAL. When provided across
 * every scenario and the sum is > 0, `probabilityWeightedValue`
 * returns Σ (prob × value) normalized by Σ prob. Missing probabilities
 * do NOT default to equal weights — silent default weights are the
 * wrong choice for a legal work-product. The caller must explicitly
 * request the weighted view.
 */

import { money, moneyAdd, moneyMul, moneyDiv, moneySum, type Money, type MoneyInput } from '@/lib/money'

export interface ScenarioResult {
  scenarioKey:      string
  scenarioName:     string
  probability?:     MoneyInput | null
  enterpriseValue?: MoneyInput | null
  equityValue?:     MoneyInput | null
  ownershipValue?:  MoneyInput | null
}

export interface ScenarioAggregate {
  min:    Money | null
  max:    Money | null
  mean:   Money | null   // simple arithmetic mean across included scenarios
}

export function aggregateEnterpriseValues(rows: ScenarioResult[]): ScenarioAggregate {
  return aggregateField(rows, r => r.enterpriseValue)
}

export function aggregateEquityValues(rows: ScenarioResult[]): ScenarioAggregate {
  return aggregateField(rows, r => r.equityValue)
}

export function aggregateOwnershipValues(rows: ScenarioResult[]): ScenarioAggregate {
  return aggregateField(rows, r => r.ownershipValue)
}

function aggregateField(
  rows: ScenarioResult[],
  pick: (r: ScenarioResult) => MoneyInput | null | undefined,
): ScenarioAggregate {
  const values: Money[] = []
  for (const r of rows) {
    const v = pick(r)
    if (v === null || v === undefined) continue
    values.push(money(v))
  }
  if (values.length === 0) return { min: null, max: null, mean: null }
  let min = values[0]!, max = values[0]!
  for (const v of values) {
    if (v.lt(min)) min = v
    if (v.gt(max)) max = v
  }
  const mean = moneyDiv(moneySum(values), values.length)
  return { min, max, mean }
}

/**
 * Probability-weighted equity value across scenarios. Returns `null`
 * when no scenario has a probability, or when the sum of provided
 * probabilities is zero. The caller must render the null state
 * explicitly — do NOT silently fall back to a simple mean.
 */
export function probabilityWeightedEquityValue(rows: ScenarioResult[]): Money | null {
  const eligible = rows.filter(r => r.probability != null && r.equityValue != null)
  if (eligible.length === 0) return null
  const totalProb = moneySum(eligible.map(r => r.probability!))
  if (totalProb.isZero()) return null
  let acc = money(0)
  for (const r of eligible) {
    acc = moneyAdd(acc, moneyMul(r.equityValue!, moneyDiv(r.probability!, totalProb)))
  }
  return acc
}

// Reserved: probabilityWeightedOwnershipValue — same logic, ownership
// column. Keeping the shape parallel so a future caller can copy this
// function verbatim.
export function probabilityWeightedOwnershipValue(rows: ScenarioResult[]): Money | null {
  const eligible = rows.filter(r => r.probability != null && r.ownershipValue != null)
  if (eligible.length === 0) return null
  const totalProb = moneySum(eligible.map(r => r.probability!))
  if (totalProb.isZero()) return null
  let acc = money(0)
  for (const r of eligible) {
    acc = moneyAdd(acc, moneyMul(r.ownershipValue!, moneyDiv(r.probability!, totalProb)))
  }
  return acc
}
