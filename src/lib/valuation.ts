/**
 * Pure valuation math — all Decimal, no JS floats.
 *
 * The UI valuation page keeps a fast local preview using JS numbers; this
 * module is the *authoritative* recomputation that runs inside
 * `saveValuation` before any value is persisted. Storage always reflects
 * these calculations, not the client's advisory numbers.
 *
 * Every function takes and returns Decimals (or accepts `MoneyInput` as
 * a courtesy). No side effects; safe to import from any server-side
 * caller.
 */

import { money, moneyAdd, moneyMul, moneySub, moneySum, moneyDivSafe, type Money, type MoneyInput } from './money'

// ─────────────────────────────────────────────────
// Market approach — EBITDA × multiple
// ─────────────────────────────────────────────────

export function marketApproachValue(ebitda: MoneyInput, multiple: MoneyInput): Money {
  return moneyMul(ebitda, multiple)
}

/**
 * Weighted average multiple across a set of comparable companies. Weights
 * are expressed as percentages (they are converted to fractions
 * internally so callers can pass "35" for 35 %).
 */
export function weightedMultiple(rows: Array<{ multiple: MoneyInput; weightPercent: MoneyInput }>): Money {
  if (rows.length === 0) return money(0)
  let acc = money(0)
  for (const r of rows) {
    // r.multiple * r.weightPercent / 100
    acc = moneyAdd(acc, moneyDivSafe(moneyMul(r.multiple, r.weightPercent), 100))
  }
  return acc
}

// ─────────────────────────────────────────────────
// Discounted Cash Flow
// ─────────────────────────────────────────────────

/** Present value of a single cash flow: `cf / (1 + r)^t`. */
export function presentValue(cashflow: MoneyInput, rate: MoneyInput, year: number): Money {
  const r = money(rate)
  const onePlusR = moneyAdd(1, r)
  // Repeated multiplication — decimal.js has no `.pow()` for integer
  // exponents that respects the current precision (there is a `pow`
  // method, but for small integers this is cheaper and exact).
  let denom = money(1)
  for (let i = 0; i < year; i++) denom = moneyMul(denom, onePlusR)
  return moneyDivSafe(cashflow, denom)
}

export interface DcfInput {
  /** Cash flows for years 1..N (usually 5). Missing / null becomes 0. */
  cashflows:      Array<MoneyInput>
  /** Discount rate as a decimal fraction (0.20 for 20 %). */
  discountRate:   MoneyInput
  /** Terminal growth as a decimal fraction (0.03 for 3 %). */
  terminalGrowth: MoneyInput
}

export interface DcfResult {
  presentValues: Money[]     // per-year PV
  pvSum:         Money       // sum of per-year PVs
  terminalValue: Money       // Gordon-growth terminal value at year N
  pvTerminal:    Money       // present value of that terminal value
  indicatedValue: Money      // pvSum + pvTerminal
}

/**
 * Gordon-growth DCF. Throws if `discountRate <= terminalGrowth` — the
 * terminal-value formula diverges (or goes negative) in that regime and
 * a silent numeric answer would be dangerous in a forensic report.
 */
export function computeDcf(input: DcfInput): DcfResult {
  const r  = money(input.discountRate)
  const g  = money(input.terminalGrowth)
  if (r.lte(g)) {
    throw new RangeError(
      `computeDcf: discountRate (${r.toString()}) must be greater than terminalGrowth (${g.toString()})`,
    )
  }
  const cfs = input.cashflows.map(money)
  const presentValues = cfs.map((cf, i) => presentValue(cf, r, i + 1))
  const pvSum = moneySum(presentValues)

  const lastCf = cfs[cfs.length - 1] ?? money(0)
  // TV = lastCf * (1 + g) / (r - g)
  const terminalValue = moneyDivSafe(moneyMul(lastCf, moneyAdd(1, g)), moneySub(r, g))
  const pvTerminal    = presentValue(terminalValue, r, cfs.length)

  return {
    presentValues,
    pvSum,
    terminalValue,
    pvTerminal,
    indicatedValue: moneyAdd(pvSum, pvTerminal),
  }
}

// ─────────────────────────────────────────────────
// WACC — sum of components
// ─────────────────────────────────────────────────

export interface WaccComponents {
  riskFreeRate?:     MoneyInput
  equityRiskPremium?:MoneyInput
  sizePremium?:      MoneyInput
  specificRisk?:     MoneyInput
}

export function computeWacc(c: WaccComponents): Money {
  return moneySum([
    c.riskFreeRate,
    c.equityRiskPremium,
    c.sizePremium,
    c.specificRisk,
  ])
}

// ─────────────────────────────────────────────────
// Reconciliation across approaches
// ─────────────────────────────────────────────────

export interface WeightedApproach {
  value:  MoneyInput
  weight: MoneyInput   // any positive scale — normalized inside
}

/**
 * Weighted average of approach values. Weights are normalized so callers
 * don't need to pass fractions that sum to 1.
 *
 *   reconcile([{value: 1_000, weight: 60}, {value: 2_000, weight: 40}])
 *   // → 1_400  (0.6 * 1000 + 0.4 * 2000)
 *
 * If all weights are zero, returns 0 (defensive).
 */
export function reconcileValues(rows: WeightedApproach[]): Money {
  if (rows.length === 0) return money(0)
  const totalWeight = moneySum(rows.map(r => r.weight))
  if (totalWeight.isZero()) return money(0)
  let acc = money(0)
  for (const r of rows) {
    acc = moneyAdd(acc, moneyDivSafe(moneyMul(r.value, r.weight), totalWeight))
  }
  return acc
}

// ─────────────────────────────────────────────────
// TTM add-back total
// ─────────────────────────────────────────────────

/** Sum the TTM column of a list of add-backs. Nullish entries become 0. */
export function sumAddBackTtm(addBacks: Array<{ ttm?: MoneyInput | null }>): Money {
  return moneySum(addBacks.map(a => a.ttm ?? 0))
}
