import { describe, it, expect } from 'vitest'
import { computeCapEarnings } from '@/lib/valuation-v2/cap-earnings'

describe('capitalization of earnings', () => {
  it('IndicatedValue = NormalizedEarnings / capitalizationRate', () => {
    const r = computeCapEarnings({
      normalizedEarnings: '500000',
      capitalizationRate: '0.20',
    })
    expect(r.effectiveCapRate.toString()).toBe('0.2')
    expect(r.indicatedValue.toString()).toBe('2500000')
  })

  it('derives cap rate from (discountRate - growthRate)', () => {
    const r = computeCapEarnings({
      normalizedEarnings: '500000',
      discountRate: '0.15', growthRate: '0.03',
    })
    expect(r.effectiveCapRate.toString()).toBe('0.12')
    // 500000 / 0.12 = 4166666.666...
    expect(r.indicatedValue.toDecimalPlaces(2).toString()).toBe('4166666.67')
  })

  it('prefers explicit cap rate over discount/growth pair', () => {
    const r = computeCapEarnings({
      normalizedEarnings: '100',
      capitalizationRate: '0.10',
      discountRate: '0.99', growthRate: '0.99',   // would blow up if used
    })
    expect(r.effectiveCapRate.toString()).toBe('0.1')
    expect(r.indicatedValue.toString()).toBe('1000')
  })

  it('refuses cap rate <= 0', () => {
    expect(() => computeCapEarnings({
      normalizedEarnings: '100', capitalizationRate: '0',
    })).toThrow(/cap rate must be > 0/)
    expect(() => computeCapEarnings({
      normalizedEarnings: '100', discountRate: '0.05', growthRate: '0.10',
    })).toThrow(/cap rate must be > 0/)
  })

  it('refuses missing inputs', () => {
    expect(() => computeCapEarnings({ normalizedEarnings: '100' })).toThrow(/capitalizationRate or/)
    expect(() => computeCapEarnings({ normalizedEarnings: '100', discountRate: '0.10' })).toThrow()
  })
})
