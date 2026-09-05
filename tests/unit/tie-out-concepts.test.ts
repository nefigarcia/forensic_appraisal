import { describe, it, expect } from 'vitest'
import {
  classifyLineItem,
  TIE_OUT_CONCEPTS,
  DEFAULT_TOLERANCES,
  defaultToleranceFor,
  CONCEPT_LABEL,
  isTieOutConcept,
} from '@/lib/tie-out/concepts'

describe('classifier — positive matches', () => {
  it.each([
    ['Revenue',                          'REVENUE'],
    ['Total Revenue',                    'REVENUE'],
    ['Gross Sales',                      'REVENUE'],
    ['Gross Receipts or Sales',          'REVENUE'],
    ['Net Sales',                        'REVENUE'],
    ['revenue',                          'REVENUE'],   // case-insensitive
    ['EBITDA',                           'EBITDA'],
    ['Operating Income',                 'EBITDA'],
    ['Income from Operations',           'EBITDA'],
    ['Net Income',                       'NET_INCOME'],
    ['Net Income (Loss)',                'NET_INCOME'],
    ['Net Profit',                       'NET_INCOME'],
    ['Net Earnings',                     'NET_INCOME'],
    ['Cash',                             'CASH'],
    ['Cash and Cash Equivalents',        'CASH'],
    ['Cash & Equivalents',               'CASH'],
    ['Accounts Receivable',              'ACCOUNTS_RECEIVABLE'],
    ['Accounts Receivable (net)',        'ACCOUNTS_RECEIVABLE'],
    ['A/R',                              'ACCOUNTS_RECEIVABLE'],
    ['Trade Receivables',                'ACCOUNTS_RECEIVABLE'],
    ['Accounts Payable',                 'ACCOUNTS_PAYABLE'],
    ['A/P',                              'ACCOUNTS_PAYABLE'],
    ['Total Assets',                     'TOTAL_ASSETS'],
    ['Total Liabilities',                'TOTAL_LIABILITIES'],
  ])('%s → %s', (input, expected) => {
    expect(classifyLineItem(input)).toBe(expected)
  })
})

describe('classifier — deliberate NULLs (no fabrication)', () => {
  it.each([
    '',
    '   ',
    'Miscellaneous',
    'Cost of Goods Sold',                     // real line item, not one of our concepts
    'Depreciation',
    'Total Liabilities and Equity',           // ambiguous — not "Total Liabilities" alone
    'Total Liabilities and Shareholders Equity',
    'Long-Term Debt',
    'random text',
  ])('returns null for %o', (input) => {
    expect(classifyLineItem(input)).toBeNull()
  })
})

describe('concept catalog invariants', () => {
  it('every concept has a label and a default tolerance', () => {
    for (const c of TIE_OUT_CONCEPTS) {
      expect(CONCEPT_LABEL[c]).toBeTruthy()
      const t = DEFAULT_TOLERANCES[c]
      expect(t).toBeTruthy()
      expect(t.absolute.gte(0)).toBe(true)
      expect(t.percent.gte(0)).toBe(true)
    }
  })

  it('isTieOutConcept guards the enum', () => {
    for (const c of TIE_OUT_CONCEPTS) expect(isTieOutConcept(c)).toBe(true)
    expect(isTieOutConcept('BOGUS')).toBe(false)
    expect(isTieOutConcept('revenue')).toBe(false)  // case-sensitive at the enum boundary
  })

  it('defaultToleranceFor returns money-typed values', () => {
    const t = defaultToleranceFor('REVENUE')
    expect(t.absolute.toString()).toBe('1000')
    expect(t.percent.toString()).toBe('0.002')
  })
})
