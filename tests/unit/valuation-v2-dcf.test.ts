import { describe, it, expect } from 'vitest'
import {
  deriveYear,
  discountFactor,
  terminalValueGordon,
  terminalValueExitMultiple,
  computeDcfDetail,
  sumFcff,
  type DcfYearInput,
} from '@/lib/valuation-v2/dcf'
import { money, moneyAdd } from '@/lib/money'

describe('DCF — deriveYear', () => {
  it('given revenue + ebitdaMargin, computes ebitda and ebit through D&A', () => {
    const d = deriveYear({
      yearLabel: 'Y1', yearIndex: 1,
      revenue: '1000', ebitdaMargin: '0.25',
      depreciation: '30', amortization: '20',
    }, '0.25')
    expect(d.revenue.toString()).toBe('1000')
    expect(d.ebitda.toString()).toBe('250')           // 1000 * 0.25
    expect(d.ebit.toString()).toBe('200')              // 250 - 30 - 20
    expect(d.taxes.toString()).toBe('50')              // 200 * 0.25
    // FCFF = ebit*(1-tr) + D&A - capex - ΔWC = 200*0.75 + 50 - 0 - 0
    expect(d.fcff.toString()).toBe('200')
  })

  it('given fcff directly, uses the caller-supplied value', () => {
    const d = deriveYear({
      yearLabel: 'Y1', yearIndex: 1,
      fcff: '123.4567',
    })
    expect(d.fcff.toString()).toBe('123.4567')
  })

  it('given ebitda directly, prefers it over revenue×margin', () => {
    const d = deriveYear({
      yearLabel: 'Y1', yearIndex: 1,
      revenue: '1000', ebitdaMargin: '0.9',
      ebitda:  '300',
      depreciation: '50',
    })
    expect(d.ebitda.toString()).toBe('300')
    expect(d.ebit.toString()).toBe('250')
  })

  it('decimal-safe — no 0.1 + 0.2 = 0.3000000...4 leak', () => {
    // ebitda = 0.1, ebit = 0.1 - 0.1 = 0; taxes = 0 * anything = 0.
    // Then FCFF = 0 + 0.1 - 0 - 0 = 0.1 exactly, even if the D&A slot
    // rounds through JS floats. Guard the invariant.
    const d = deriveYear({
      yearLabel: 'Y1', yearIndex: 1,
      ebitda: '0.1', depreciation: '0.05', amortization: '0.05',
    }, '0')
    expect(d.ebit.toString()).toBe('0')
    expect(d.fcff.toString()).toBe('0.1')   // 0 + 0.1 - 0 - 0
    // Decimal-safe invariant
    expect(moneyAdd('0.1', '0.2').toString()).toBe('0.3')
  })
})

describe('DCF — present-value math', () => {
  it('discountFactor(0.10, 1) = 0.9090909...', () => {
    const df = discountFactor('0.10', 1)
    // 1 / 1.1 — decimal.js keeps 20+ digits
    expect(df.toDecimalPlaces(6).toString()).toBe('0.909091')
  })

  it('supports mid-year (fractional t)', () => {
    const df = discountFactor('0.10', 0.5)
    // 1 / 1.1^0.5 ≈ 0.9534625892...
    expect(df.toDecimalPlaces(6).toString()).toBe('0.953463')
  })
})

describe('DCF — terminal value', () => {
  it('Gordon: fcff*(1+g)/(r-g)', () => {
    const tv = terminalValueGordon('100', '0.10', '0.03')
    // 100 * 1.03 / 0.07 = 1471.4285714...
    expect(tv.toDecimalPlaces(4).toString()).toBe('1471.4286')
  })

  it('Gordon: refuses r <= g', () => {
    expect(() => terminalValueGordon('100', '0.03', '0.03')).toThrow(/must exceed growth/)
    expect(() => terminalValueGordon('100', '0.02', '0.05')).toThrow(/must exceed/)
  })

  it('EXIT_MULTIPLE: ebitda × multiple', () => {
    const tv = terminalValueExitMultiple('200', '8')
    expect(tv.toString()).toBe('1600')
  })
})

describe('DCF — end-to-end computeDcfDetail', () => {
  const flatYears: DcfYearInput[] = [
    { yearLabel: 'Y1', yearIndex: 1, fcff: '100' },
    { yearLabel: 'Y2', yearIndex: 2, fcff: '110' },
    { yearLabel: 'Y3', yearIndex: 3, fcff: '121' },
    { yearLabel: 'Y4', yearIndex: 4, fcff: '133.10' },
    { yearLabel: 'Y5', yearIndex: 5, fcff: '146.41' },
  ]

  it('produces per-year PVs, terminal PV, and enterprise value', () => {
    const r = computeDcfDetail({
      years: flatYears,
      discountRate:   '0.10',
      terminalMethod: 'GORDON',
      terminalGrowth: '0.03',
    })
    expect(r.years).toHaveLength(5)
    // pvSum ≈ 100*.909 + 110*.826 + 121*.751 + 133.10*.683 + 146.41*.621
    //       ≈ 90.909 + 90.909 + 90.909 + 90.909 + 90.909 = 454.545...
    // (constant growth at 10 % under a 10 % discount → identical PVs)
    expect(r.pvSum.toDecimalPlaces(2).toString()).toBe('454.55')
    expect(r.terminalValue.toDecimalPlaces(2).toString()).toBe('2154.32')
    // Total indicated = pvSum + pvTerminal
    expect(r.indicatedValue.toDecimalPlaces(2).toString()).toBe(
      moneyAdd(r.pvSum.toDecimalPlaces(2), r.pvTerminal.toDecimalPlaces(2)).toDecimalPlaces(2).toString(),
    )
  })

  it('EXIT_MULTIPLE terminal uses last-year EBITDA', () => {
    const r = computeDcfDetail({
      years: [
        { yearLabel: 'Y1', yearIndex: 1, ebitda: '100', fcff: '80' },
        { yearLabel: 'Y2', yearIndex: 2, ebitda: '110', fcff: '90' },
      ],
      discountRate:         '0.10',
      terminalMethod:       'EXIT_MULTIPLE',
      terminalExitMultiple: '8',
    })
    // Terminal = 110 * 8 = 880. PV = 880 / 1.1^2 = 727.272...
    expect(r.terminalValue.toString()).toBe('880')
    expect(r.pvTerminal.toDecimalPlaces(2).toString()).toBe('727.27')
  })

  it('midyearConvention discounts interim years at t - 0.5 but keeps terminal at N', () => {
    const r = computeDcfDetail({
      years: [
        { yearLabel: 'Y1', yearIndex: 1, fcff: '100' },
        { yearLabel: 'Y2', yearIndex: 2, fcff: '100' },
      ],
      discountRate:      '0.10',
      terminalMethod:    'EXIT_MULTIPLE',
      terminalExitMultiple: '5',
      midyearConvention: true,
    })
    // Y1 df = 1 / 1.1^0.5 ≈ 0.953463
    expect(r.years[0]!.discountFactor.toDecimalPlaces(6).toString()).toBe('0.953463')
    // Y2 df = 1 / 1.1^1.5 ≈ 0.866784
    expect(r.years[1]!.discountFactor.toDecimalPlaces(6).toString()).toBe('0.866784')
  })

  it('refuses zero forecast years', () => {
    expect(() => computeDcfDetail({
      years: [], discountRate: '0.1',
      terminalMethod: 'GORDON', terminalGrowth: '0.03',
    })).toThrow(/no forecast years/)
  })

  it('refuses missing terminal inputs', () => {
    expect(() => computeDcfDetail({
      years: [{ yearLabel: 'Y1', yearIndex: 1, fcff: '100' }],
      discountRate:   '0.10',
      terminalMethod: 'GORDON',
    })).toThrow(/terminalGrowth/)
    expect(() => computeDcfDetail({
      years: [{ yearLabel: 'Y1', yearIndex: 1, fcff: '100' }],
      discountRate:   '0.10',
      terminalMethod: 'EXIT_MULTIPLE',
    })).toThrow(/terminalExitMultiple/)
  })
})

describe('DCF — helpers', () => {
  it('sumFcff totals a series of year rows', () => {
    const s = sumFcff([
      { yearLabel: 'Y1', yearIndex: 1, revenue: money(0), ebitda: money(0), ebit: money(0), taxes: money(0), fcff: money('10'), discountFactor: money(0), presentValue: money(0) },
      { yearLabel: 'Y2', yearIndex: 2, revenue: money(0), ebitda: money(0), ebit: money(0), taxes: money(0), fcff: money('20'), discountFactor: money(0), presentValue: money(0) },
    ])
    expect(s.toString()).toBe('30')
  })
})
