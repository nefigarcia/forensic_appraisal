import { describe, it, expect } from 'vitest'
import {
  marketApproachValue,
  weightedMultiple,
  presentValue,
  computeDcf,
  computeWacc,
  reconcileValues,
  sumAddBackTtm,
} from '@/lib/valuation'
import { money } from '@/lib/money'

// ─────────────────────────────────────────────────
// Market approach
// ─────────────────────────────────────────────────

describe('marketApproachValue', () => {
  it('EBITDA × multiple, exact', () => {
    expect(marketApproachValue('1000000.05', '5.5').toString()).toBe('5500000.275')
  })

  it('handles zero EBITDA', () => {
    expect(marketApproachValue(0, '5.5').toString()).toBe('0')
  })
})

describe('weightedMultiple', () => {
  it('weights sum to 100, weighted average is exact', () => {
    // (6 × 40 + 8 × 60) / 100 = 7.2
    const wm = weightedMultiple([
      { multiple: 6, weightPercent: 40 },
      { multiple: 8, weightPercent: 60 },
    ])
    expect(wm.toString()).toBe('7.2')
  })

  it('returns 0 for empty input', () => {
    expect(weightedMultiple([]).toString()).toBe('0')
  })
})

// ─────────────────────────────────────────────────
// DCF
// ─────────────────────────────────────────────────

describe('presentValue', () => {
  it('discounts a single cash flow one year exactly', () => {
    // 110 / (1 + 0.10)^1 = 100
    expect(presentValue(110, 0.10, 1).toString()).toBe('100')
  })

  it('year 0 returns the value undiscounted', () => {
    expect(presentValue(1000, 0.10, 0).toString()).toBe('1000')
  })

  it('handles large exponents (Gordon-growth terminal)', () => {
    const pv = presentValue(1000, 0.10, 10)
    // 1000 / 1.1^10 ≈ 385.5432893...
    // decimal.js computes 1.1^10 exactly via repeated mul.
    expect(pv.toString().slice(0, 5)).toBe('385.5')
  })
})

describe('computeDcf', () => {
  it('happy path: known-answer DCF', () => {
    // Flat 100/year for 5 years, r=10%, g=3%.
    // Per-year PVs sum ≈ 379.08
    // Terminal = 100 * 1.03 / (0.10 - 0.03) = 1471.4285...
    // PV of terminal at year 5 = 1471.43 / 1.1^5 = 913.6...
    // Indicated ≈ 379.08 + 913.6 ≈ 1292.7
    const dcf = computeDcf({
      cashflows:      [100, 100, 100, 100, 100],
      discountRate:   0.10,
      terminalGrowth: 0.03,
    })
    expect(dcf.presentValues.length).toBe(5)
    // Rough sanity: total should sit between 1200 and 1400.
    const total = Number(dcf.indicatedValue.toFixed(2))
    expect(total).toBeGreaterThan(1200)
    expect(total).toBeLessThan(1400)
  })

  it('throws when r <= g (terminal value diverges)', () => {
    expect(() => computeDcf({
      cashflows:      [100, 100, 100, 100, 100],
      discountRate:   0.03,
      terminalGrowth: 0.03,
    })).toThrow(/discountRate.*terminalGrowth/)
  })

  it('nullish cash flows become 0 (no NaN propagation)', () => {
    const dcf = computeDcf({
      cashflows:      [null as any, undefined as any, 100, 100, 100],
      discountRate:   0.10,
      terminalGrowth: 0.03,
    })
    expect(dcf.indicatedValue.isNaN()).toBe(false)
  })
})

// ─────────────────────────────────────────────────
// WACC
// ─────────────────────────────────────────────────

describe('computeWacc', () => {
  it('sums components exactly', () => {
    const w = computeWacc({
      riskFreeRate:      0.04,
      equityRiskPremium: 0.055,
      sizePremium:       0.02,
      specificRisk:      0.03,
    })
    expect(w.toString()).toBe('0.145')
  })

  it('missing components treated as 0', () => {
    expect(computeWacc({ riskFreeRate: 0.04 }).toString()).toBe('0.04')
    expect(computeWacc({}).toString()).toBe('0')
  })
})

// ─────────────────────────────────────────────────
// Reconciliation
// ─────────────────────────────────────────────────

describe('reconcileValues', () => {
  it('weighted average across approaches', () => {
    const c = reconcileValues([
      { value: 1_000, weight: 60 },
      { value: 2_000, weight: 40 },
    ])
    expect(c.toString()).toBe('1400')
  })

  it('normalizes when weights don\'t sum to 100', () => {
    // 3 and 1 => 3/4 to 1000, 1/4 to 2000 = 1250
    const c = reconcileValues([
      { value: 1_000, weight: 3 },
      { value: 2_000, weight: 1 },
    ])
    expect(c.toString()).toBe('1250')
  })

  it('returns 0 when all weights are zero (defensive, no divide-by-zero)', () => {
    const c = reconcileValues([
      { value: 1_000, weight: 0 },
      { value: 2_000, weight: 0 },
    ])
    expect(c.toString()).toBe('0')
  })

  it('returns 0 for empty input', () => {
    expect(reconcileValues([]).toString()).toBe('0')
  })
})

// ─────────────────────────────────────────────────
// Add-back TTM sum
// ─────────────────────────────────────────────────

describe('sumAddBackTtm', () => {
  it('sums the ttm column of a list of add-backs', () => {
    expect(sumAddBackTtm([
      { ttm: '10000.50' },
      { ttm: '5000.25'  },
      { ttm: '2500.75'  },
    ]).toString()).toBe('17501.5')
  })

  it('handles null / missing ttm', () => {
    expect(sumAddBackTtm([
      { ttm: '10000' },
      { ttm: null    },
      { }, // no ttm field
    ]).toString()).toBe('10000')
  })

  it('returns 0 for empty input', () => {
    expect(sumAddBackTtm([]).toString()).toBe('0')
  })
})

// ─────────────────────────────────────────────────
// Cross-domain: exact reproducibility of a real-world scenario
// ─────────────────────────────────────────────────

describe('end-to-end scenario', () => {
  it('reproduces a small-firm valuation deterministically', () => {
    const ebitda = money('1250000.55')
    const multiple = money('6.4')
    const market  = marketApproachValue(ebitda, multiple)

    const dcf = computeDcf({
      cashflows:      [1_400_000, 1_450_000, 1_500_000, 1_600_000, 1_700_000],
      discountRate:   0.18,
      terminalGrowth: 0.03,
    })

    const concluded = reconcileValues([
      { value: market,               weight: 40 },
      { value: dcf.indicatedValue,   weight: 60 },
    ])

    // Regardless of how many times we run it, the number is exact.
    const twice = reconcileValues([
      { value: marketApproachValue(ebitda, multiple), weight: 40 },
      { value: computeDcf({
          cashflows:      [1_400_000, 1_450_000, 1_500_000, 1_600_000, 1_700_000],
          discountRate:   0.18,
          terminalGrowth: 0.03,
        }).indicatedValue,
        weight: 60 },
    ])
    expect(concluded.toString()).toBe(twice.toString())
    // Sanity band: this scenario should land in [8M, 20M] for a healthy
    // small firm; if the math drifted, this band would fail loudly.
    const n = Number(concluded.toFixed(0))
    expect(n).toBeGreaterThan(8_000_000)
    expect(n).toBeLessThan(20_000_000)
  })
})
