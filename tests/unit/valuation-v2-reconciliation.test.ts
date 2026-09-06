import { describe, it, expect } from 'vitest'
import { computeReconciliation } from '@/lib/valuation-v2/reconciliation'

describe('reconciliation — weighted enterprise value', () => {
  it('weights normalize automatically', () => {
    const r = computeReconciliation({
      approaches: [
        { kind: 'INCOME_DCF',   isIncluded: true, weight: '60', indicatedValue: '10000000' },
        { kind: 'MARKET_GPCM',  isIncluded: true, weight: '40', indicatedValue: '20000000' },
      ],
    })
    // 0.6 * 10M + 0.4 * 20M = 14M
    expect(r.enterpriseValue.toString()).toBe('14000000')
    expect(r.equityValue.toString()).toBe('14000000')     // no bridge → equity == enterprise
    expect(r.ownershipValue.toString()).toBe('14000000')  // no ownership → unchanged
  })

  it('excludes approaches with isIncluded=false', () => {
    const r = computeReconciliation({
      approaches: [
        { kind: 'INCOME_DCF',  isIncluded: true,  weight: '1', indicatedValue: '100' },
        { kind: 'INCOME_CAP_EARNINGS', isIncluded: false, weight: '99', indicatedValue: '999999' },
      ],
    })
    expect(r.enterpriseValue.toString()).toBe('100')
  })

  it('folds in the bridge to reach equity value', () => {
    const r = computeReconciliation({
      approaches: [
        { kind: 'INCOME_DCF', isIncluded: true, weight: '1', indicatedValue: '20000000' },
      ],
      bridge: [
        { category: 'CASH', label: 'cash',  amount: '2000000'  },
        { category: 'DEBT', label: 'loans', amount: '-5000000' },
      ],
    })
    expect(r.enterpriseValue.toString()).toBe('20000000')
    expect(r.bridgeNet.toString()).toBe('-3000000')
    expect(r.equityValue.toString()).toBe('17000000')
  })

  it('applies APPROVED ownership discounts multiplicatively', () => {
    const r = computeReconciliation({
      approaches: [
        { kind: 'INCOME_DCF', isIncluded: true, weight: '1', indicatedValue: '17000000' },
      ],
      ownership: [
        { kind: 'DLOM', percent: '0.20', status: 'APPROVED',
          rationale: 'Restricted-stock study', source: 'Longstaff 2019' },
      ],
    })
    expect(r.ownershipDiscount.toString()).toBe('0.2')
    expect(r.ownershipValue.toString()).toBe('13600000')
  })

  it('refuses to apply a DRAFT ownership discount — even mixed with an APPROVED one', () => {
    // The load-bearing "no-auto-discount" invariant: even a single
    // non-APPROVED row causes the whole apply to throw.
    expect(() => computeReconciliation({
      approaches: [{ kind: 'INCOME_DCF', isIncluded: true, weight: '1', indicatedValue: '10000000' }],
      ownership: [
        { kind: 'DLOM', percent: '0.20', status: 'APPROVED', rationale: 'x', source: 's' },
        { kind: 'DLOC', percent: '0.30', status: 'DRAFT',    rationale: 'x', source: 's' },
      ],
    })).toThrow(/only APPROVED rows may be applied/)
  })

  it('strict mode throws when an included approach has no indicatedValue', () => {
    expect(() => computeReconciliation({
      strict: true,
      approaches: [
        { kind: 'INCOME_DCF', isIncluded: true, weight: '1', indicatedValue: null },
      ],
    })).toThrow(/no indicatedValue/)
  })

  it('non-strict mode treats missing indicatedValue as 0 (preview only)', () => {
    const r = computeReconciliation({
      strict: false,
      approaches: [
        { kind: 'INCOME_DCF', isIncluded: true, weight: '1', indicatedValue: null },
        { kind: 'MARKET_GPCM', isIncluded: true, weight: '1', indicatedValue: '1000' },
      ],
    })
    expect(r.enterpriseValue.toString()).toBe('500')
  })

  it('all-zero weights collapses to 0 enterprise (defensive; caller should show empty state)', () => {
    const r = computeReconciliation({
      approaches: [
        { kind: 'INCOME_DCF', isIncluded: true, weight: '0', indicatedValue: '100' },
      ],
    })
    expect(r.enterpriseValue.toString()).toBe('0')
  })
})
