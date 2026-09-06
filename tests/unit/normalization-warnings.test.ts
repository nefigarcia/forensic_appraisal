import { describe, it, expect } from 'vitest'
import { warningsFor, severityRank } from '@/lib/normalization/warnings'

describe('warningsFor', () => {
  it('flags a fully-empty adjustment with multiple warnings including ERRORs', () => {
    const ws = warningsFor({
      rationale: null, citationCount: 0,
      amounts: { year2: null, year1: null, ttm: null },
    })
    const codes = ws.map(w => w.code)
    expect(codes).toContain('MISSING_RATIONALE')
    expect(codes).toContain('NO_AMOUNTS')
    expect(codes).toContain('NO_CITATIONS')
    expect(codes).toContain('MISSING_RECURRING_LABEL')
    expect(codes).toContain('MISSING_TAX_TREATMENT')
    const errors = ws.filter(w => w.severity === 'ERROR')
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })

  it('does NOT flag a fully-populated adjustment', () => {
    const ws = warningsFor({
      rationale: 'Owner personal auto lease; not required for continuing operations.',
      citationCount: 2,
      amounts: { year2: 30000, year1: 32000, ttm: 33000 },
      recurring: 'NONRECURRING',
      taxTreatment: 'PRE_TAX',
    })
    expect(ws).toEqual([])
  })

  it('MISSING_RATIONALE fires for a whitespace-only rationale', () => {
    const ws = warningsFor({
      rationale: '   \n\t  ',
      citationCount: 1,
      amounts: { year1: 100 },
    })
    expect(ws.some(w => w.code === 'MISSING_RATIONALE')).toBe(true)
  })

  it('NO_AMOUNTS fires when all three period amounts are null / undefined', () => {
    const ws = warningsFor({
      rationale: 'x', citationCount: 1,
      amounts: { year2: undefined, year1: null, ttm: undefined },
    })
    expect(ws.some(w => w.code === 'NO_AMOUNTS')).toBe(true)
  })

  it('does NOT fire NO_AMOUNTS when any period has a value', () => {
    const ws = warningsFor({
      rationale: 'x', citationCount: 1,
      amounts: { year2: null, year1: 5, ttm: null },
    })
    expect(ws.some(w => w.code === 'NO_AMOUNTS')).toBe(false)
  })

  it('MISSING_TAX_TREATMENT is INFO severity — optional field', () => {
    const ws = warningsFor({
      rationale: 'x', citationCount: 1,
      amounts: { year1: 100 },
      recurring: 'NONRECURRING',
      // taxTreatment omitted
    })
    const tax = ws.find(w => w.code === 'MISSING_TAX_TREATMENT')
    expect(tax?.severity).toBe('INFO')
  })
})

describe('severityRank', () => {
  it('ERROR < WARN < INFO', () => {
    expect(severityRank({ code: 'MISSING_RATIONALE',       message: '', severity: 'ERROR' })).toBeLessThan(
           severityRank({ code: 'NO_CITATIONS',            message: '', severity: 'WARN'  }))
    expect(severityRank({ code: 'NO_CITATIONS',            message: '', severity: 'WARN'  })).toBeLessThan(
           severityRank({ code: 'MISSING_TAX_TREATMENT',   message: '', severity: 'INFO'  }))
  })
})
