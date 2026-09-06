/**
 * Structured DCF for Slice 13. All arithmetic uses `Prisma.Decimal`
 * through the Slice-4 `money` helpers — no JS-float rounding ever
 * enters the result path.
 *
 * The Slice-0 `computeDcf` in `src/lib/valuation.ts` remains as a
 * simple gordon-growth calculator (existing callers depend on it).
 * This module is the more structured version the workbench uses.
 */

import {
  money, moneyAdd, moneySub, moneyMul, moneyDiv, moneyDivSafe, moneySum,
  type Money, type MoneyInput,
} from '@/lib/money'

// ─────────────────────────────────────────────────
// Per-year forecast row
// ─────────────────────────────────────────────────

export interface DcfYearInput {
  yearLabel:              string
  yearIndex:              number             // 1..N (1-based)
  revenue?:               MoneyInput
  grossMarginPct?:        MoneyInput
  ebitdaMargin?:          MoneyInput         // fractional (0.20 = 20 %)
  ebitda?:                MoneyInput         // if provided, wins over revenue×margin
  depreciation?:          MoneyInput
  amortization?:          MoneyInput
  taxes?:                 MoneyInput         // if provided, wins over taxRate * (ebitda - D&A)
  capex?:                 MoneyInput
  workingCapitalChange?:  MoneyInput
  fcff?:                  MoneyInput         // if provided, wins over derived FCFF
}

export interface DcfYearResult {
  yearLabel:     string
  yearIndex:     number
  revenue:       Money
  ebitda:        Money
  ebit:          Money
  taxes:         Money
  fcff:          Money
  discountFactor: Money
  presentValue:  Money
}

export interface DcfDetailInput {
  years:              DcfYearInput[]
  discountRate:       MoneyInput             // fractional
  taxRate?:           MoneyInput             // fractional
  terminalMethod:     'GORDON' | 'EXIT_MULTIPLE'
  terminalGrowth?:    MoneyInput             // fractional; required if GORDON
  terminalExitMultiple?: MoneyInput          // required if EXIT_MULTIPLE
  midyearConvention?: boolean                // when true, discount at t - 0.5
}

export interface DcfDetailResult {
  years:          DcfYearResult[]
  pvSum:          Money
  terminalValue:  Money
  pvTerminal:     Money
  indicatedValue: Money   // enterprise value
}

/**
 * Compute a single year's derived rows given the year input + the
 * DCF-level tax rate. Returns fcff, ebit, ebitda even when only revenue
 * + margin was supplied.
 *
 * Precedence (a caller value beats a derivation):
 *   1. fcff, if given → return it directly (the caller has already
 *      folded everything into FCFF).
 *   2. Otherwise EBITDA = ebitda ?? revenue * ebitdaMargin.
 *   3. EBIT = EBITDA - depreciation - amortization.
 *   4. taxes = taxes ?? EBIT * taxRate (0 if no rate).
 *   5. FCFF = EBIT * (1 - taxRate) + D&A - capex - ΔWC.
 *
 * All missing inputs become 0. Overriding one component and leaving
 * the rest null is intentional — the workbench UI lets an analyst fix
 * one number without recomputing every dependent row.
 */
export function deriveYear(y: DcfYearInput, taxRate: MoneyInput = 0): {
  revenue: Money
  ebitda:  Money
  ebit:    Money
  taxes:   Money
  fcff:    Money
} {
  const revenue = money(y.revenue ?? 0)
  const ebitda  = y.ebitda != null
    ? money(y.ebitda)
    : y.ebitdaMargin != null ? moneyMul(revenue, y.ebitdaMargin) : money(0)
  const da = moneyAdd(y.depreciation ?? 0, y.amortization ?? 0)
  const ebit = moneySub(ebitda, da)
  const taxes = y.taxes != null
    ? money(y.taxes)
    : moneyMul(ebit, taxRate)
  const fcff = y.fcff != null
    ? money(y.fcff)
    : moneyAdd(
        moneyAdd(moneySub(ebit, taxes), da),
        moneySub(0, moneyAdd(y.capex ?? 0, y.workingCapitalChange ?? 0)),
      )
  return { revenue, ebitda, ebit, taxes, fcff }
}

/**
 * Present-value factor `1 / (1 + r)^t`. `t` may be fractional — used
 * with the mid-year convention (t = index - 0.5). Uses log-based
 * exponentiation via decimal.js, preserving precision at 20 digits.
 */
export function discountFactor(rate: MoneyInput, t: number): Money {
  const r = money(rate)
  const onePlusR = moneyAdd(1, r)
  // decimal.js supports .pow(n) with integer or decimal exponents.
  return money(1).div(onePlusR.pow(t))
}

/**
 * Terminal value at year N.
 *   GORDON        : lastFcff * (1 + g) / (r - g), thrown if r <= g.
 *   EXIT_MULTIPLE : lastEbitda * multiple.
 *
 * `EXIT_MULTIPLE` requires the caller to pass the year N EBITDA in
 * addition to the multiple (the terminal EBITDA can differ from the
 * last forecast row when the caller runs a two-stage growth).
 */
export function terminalValueGordon(lastFcff: MoneyInput, discountRate: MoneyInput, growth: MoneyInput): Money {
  const r = money(discountRate)
  const g = money(growth)
  if (r.lte(g)) {
    throw new RangeError(
      `terminalValueGordon: discountRate (${r.toString()}) must exceed growth (${g.toString()})`,
    )
  }
  return moneyDiv(moneyMul(lastFcff, moneyAdd(1, g)), moneySub(r, g))
}

export function terminalValueExitMultiple(lastEbitda: MoneyInput, exitMultiple: MoneyInput): Money {
  return moneyMul(lastEbitda, exitMultiple)
}

/**
 * Full DCF computation. Every intermediate is Decimal.
 *
 * Errors that surface as thrown `RangeError`s:
 *   - `years` empty
 *   - `terminalMethod = GORDON` and r ≤ g
 *   - `terminalMethod = EXIT_MULTIPLE` and no multiple supplied
 *   - non-positive `1 + discountRate`
 */
export function computeDcfDetail(input: DcfDetailInput): DcfDetailResult {
  if (input.years.length === 0) throw new RangeError('computeDcfDetail: no forecast years')
  const r = money(input.discountRate)
  if (moneyAdd(1, r).lte(0)) {
    throw new RangeError(`computeDcfDetail: 1 + discountRate must be positive (got ${r.toString()})`)
  }

  const taxRate = money(input.taxRate ?? 0)

  const rows: DcfYearResult[] = []
  let pvSum = money(0)

  for (const y of input.years) {
    const derived = deriveYear(y, taxRate)
    const t = input.midyearConvention ? y.yearIndex - 0.5 : y.yearIndex
    const df = discountFactor(r, t)
    const pv = moneyMul(derived.fcff, df)
    rows.push({
      yearLabel:      y.yearLabel,
      yearIndex:      y.yearIndex,
      revenue:        derived.revenue,
      ebitda:         derived.ebitda,
      ebit:           derived.ebit,
      taxes:          derived.taxes,
      fcff:           derived.fcff,
      discountFactor: df,
      presentValue:   pv,
    })
    pvSum = moneyAdd(pvSum, pv)
  }

  const lastYear = rows[rows.length - 1]!
  let terminalValue: Money
  if (input.terminalMethod === 'GORDON') {
    if (input.terminalGrowth == null) {
      throw new RangeError('computeDcfDetail: GORDON terminal requires terminalGrowth')
    }
    terminalValue = terminalValueGordon(lastYear.fcff, r, input.terminalGrowth)
  } else {
    if (input.terminalExitMultiple == null) {
      throw new RangeError('computeDcfDetail: EXIT_MULTIPLE terminal requires terminalExitMultiple')
    }
    terminalValue = terminalValueExitMultiple(lastYear.ebitda, input.terminalExitMultiple)
  }

  // Terminal discounted from year N (full-year for both conventions;
  // mid-year affects the interim PVs, not the perpetuity).
  const pvTerminal = moneyMul(terminalValue, discountFactor(r, lastYear.yearIndex))

  return {
    years: rows,
    pvSum,
    terminalValue,
    pvTerminal,
    indicatedValue: moneyAdd(pvSum, pvTerminal),
  }
}

// ─────────────────────────────────────────────────
// Convenience — sum FCFFs (used by the UI for a quick sanity strip)
// ─────────────────────────────────────────────────

export function sumFcff(years: DcfYearResult[]): Money {
  return moneySum(years.map(y => y.fcff))
}

// Silence unused import in the very rare case decimal.js drops moneyDivSafe.
void moneyDivSafe
