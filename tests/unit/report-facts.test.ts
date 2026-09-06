/**
 * Facts hashing + scoping tests.
 *
 * Load-bearing: `hashPayload` is deterministic (canonicalizes keys)
 * and `scopeForSection` filters payloads to only the fact families a
 * given section may consume.
 */

import { describe, it, expect } from 'vitest'
import { canonicalize, hashPayload, scopeForSection, type ReportFactsPayload } from '@/lib/reports/facts'

const emptyPayload: ReportFactsPayload = {
  engagement: {
    caseId: 'case-a', caseName: 'A', clientName: 'C', engagementType: 'X', manager: 'M',
    valuationDate: null, reportDueDate: null, purposeOfValue: null,
    standardOfValue: null, premiseOfValue: null, interestType: null,
    marketability: null, reportingCurrency: null,
  },
  company:  { industry: null },
  ownership: { approvedAdjustments: [] },
  industry:  { naics: null, sic: null, description: null },
  economic:  { dataAvailable: false },
  financials: { values: [] },
  normalization: { approvedAddBacks: [] },
  valuation: { scenarios: [] },
  reconciliation: { finalized: false },
  assumptions: { approved: [] },
  evidence:  { documents: [], citations: [] },
}

describe('canonicalize', () => {
  it('sorts object keys alphabetically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]')
  })

  it('null and undefined both serialize to null', () => {
    expect(canonicalize(null)).toBe('null')
    expect(canonicalize(undefined)).toBe('null')
  })

  it('non-finite numbers become null (defensive)', () => {
    expect(canonicalize(NaN)).toBe('null')
    expect(canonicalize(Infinity)).toBe('null')
  })

  it('two equal payloads with differently-ordered keys have the same canonical form', () => {
    const a = { engagement: { b: 1, a: 2 }, values: [1, 2] }
    const b = { values: [1, 2], engagement: { a: 2, b: 1 } }
    expect(canonicalize(a)).toBe(canonicalize(b))
  })
})

describe('hashPayload', () => {
  it('is deterministic and stable across identical payloads', () => {
    const h1 = hashPayload(emptyPayload)
    const h2 = hashPayload(emptyPayload)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when a fact changes', () => {
    const h1 = hashPayload(emptyPayload)
    const mutated: ReportFactsPayload = {
      ...emptyPayload,
      financials: { values: [{
        id: 'fv-1', year: '2024', statementType: 'IS',
        lineItem: 'Revenue', value: '100', documentId: null,
      }] },
    }
    const h2 = hashPayload(mutated)
    expect(h1).not.toBe(h2)
  })
})

describe('scopeForSection', () => {
  it('CONCLUSION only sees the reconciliation slice', () => {
    const s = scopeForSection(emptyPayload, 'CONCLUSION')
    expect(s.reconciliation).toBeDefined()
    expect(s.financials).toBeUndefined()
    expect(s.evidence).toBeUndefined()
  })

  it('FINANCIAL_ANALYSIS only sees financials', () => {
    const s = scopeForSection(emptyPayload, 'FINANCIAL_ANALYSIS')
    expect(s.financials).toBeDefined()
    expect(s.engagement).toBeUndefined()
    expect(s.ownership).toBeUndefined()
  })

  it('NORMALIZATION only sees normalization data', () => {
    const s = scopeForSection(emptyPayload, 'NORMALIZATION')
    expect(s.normalization).toBeDefined()
    expect(s.valuation).toBeUndefined()
  })

  it('ASSUMPTIONS only sees the approved assumptions slice', () => {
    const s = scopeForSection(emptyPayload, 'ASSUMPTIONS')
    expect(s.assumptions).toBeDefined()
    expect(s.financials).toBeUndefined()
  })

  it('LIMITING_CONDITIONS is a scope-less section — receives nothing', () => {
    const s = scopeForSection(emptyPayload, 'LIMITING_CONDITIONS')
    expect(s.engagement).toBeUndefined()
    expect(s.financials).toBeUndefined()
    expect(s.assumptions).toBeUndefined()
  })

  it('SOURCE_LIST only sees the evidence slice', () => {
    const s = scopeForSection(emptyPayload, 'SOURCE_LIST')
    expect(s.evidence).toBeDefined()
    expect(s.assumptions).toBeUndefined()
  })
})
