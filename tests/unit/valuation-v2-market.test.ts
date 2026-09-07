import { describe, it, expect } from 'vitest'
import {
  multipleStats,
  marketIndication,
  guidelineCompanyStats,
  guidelineTransactionStats,
} from '@/lib/valuation-v2/market'

describe('multipleStats', () => {
  it('returns count=0 zeroed stats for an empty set', () => {
    const s = multipleStats([])
    expect(s.count).toBe(0)
    expect(s.median.toString()).toBe('0')
  })

  it('skips null/undefined entries', () => {
    const s = multipleStats([null, undefined, '5', '10', '15'])
    expect(s.count).toBe(3)
    expect(s.min.toString()).toBe('5')
    expect(s.max.toString()).toBe('15')
    expect(s.mean.toString()).toBe('10')
    expect(s.median.toString()).toBe('10')
  })

  it('median with even count averages the middle two', () => {
    const s = multipleStats(['1', '2', '3', '4'])
    expect(s.median.toString()).toBe('2.5')
  })

  it('median with odd count picks the middle', () => {
    const s = multipleStats(['1', '2', '3'])
    expect(s.median.toString()).toBe('2')
  })

  it('decimal-safe mean of 0.1 + 0.2 + 0.3', () => {
    const s = multipleStats(['0.1', '0.2', '0.3'])
    expect(s.mean.toString()).toBe('0.2')
  })
})

describe('marketIndication', () => {
  it('EBITDA × multiple = enterprise indication', () => {
    const v = marketIndication({ subjectMetric: '2_500_000'.replace(/_/g, ''), multiple: '8' })
    expect(v.toString()).toBe('20000000')
  })
})

describe('guidelineCompanyStats — respects isIncluded flag', () => {
  it('excludes rows marked isIncluded=false', () => {
    const stats = guidelineCompanyStats([
      { evEbitda: '5', isIncluded: true },
      { evEbitda: '10', isIncluded: false },
      { evEbitda: '15', isIncluded: true },
    ])
    expect(stats.evEbitda.count).toBe(2)
    expect(stats.evEbitda.median.toString()).toBe('10')  // (5 + 15) / 2
  })

  it('defaults isIncluded to true when the field is missing', () => {
    const stats = guidelineCompanyStats([
      { evEbitda: '5' }, { evEbitda: '10' },
    ])
    expect(stats.evEbitda.count).toBe(2)
  })

  it('runs independently per multiple type — a null EV/Revenue does not disqualify EV/EBITDA', () => {
    const stats = guidelineCompanyStats([
      { evEbitda: '5', evRevenue: null },
      { evEbitda: '6', evRevenue: '1.5' },
    ])
    expect(stats.evEbitda.count).toBe(2)
    expect(stats.evRevenue.count).toBe(1)
  })
})

describe('guidelineTransactionStats', () => {
  it('same shape as company stats but without P/E', () => {
    const stats = guidelineTransactionStats([
      { evEbitda: '4' }, { evEbitda: '8' }, { evEbitda: '12' },
    ])
    expect(stats.evEbitda.median.toString()).toBe('8')
    expect(stats.evEbitda.min.toString()).toBe('4')
  })
})
