/**
 * LOAD-BEARING: the whitelist of Slice-16 search fields.
 *
 * The AI planner is instructed to only produce fields from this list.
 * `validateFilterSet` is the authoritative enforcement — anything not
 * whitelisted is rejected. The query composer additionally drops
 * unrecognized fields as defense-in-depth.
 *
 * Any regression that lets an unwhitelisted field reach the DB WHERE
 * clause is a security bug and must fail here.
 */

import { describe, it, expect } from 'vitest'
import {
  STRING_SEARCH_FIELDS, NUMERIC_SEARCH_FIELDS,
  DATE_SEARCH_FIELDS, BOOLEAN_SEARCH_FIELDS, ARRAY_SEARCH_FIELDS,
  ALL_SEARCH_FIELDS,
  isStringSearchField, isNumericSearchField, isDateSearchField,
  isBooleanSearchField, isArraySearchField,
  validateFilterSet,
} from '@/lib/search/query-shape'
import { composeSearchQuery } from '@/lib/search/filters'

describe('search whitelist', () => {
  it('every declared category has at least one field', () => {
    expect(STRING_SEARCH_FIELDS.length).toBeGreaterThan(0)
    expect(NUMERIC_SEARCH_FIELDS.length).toBeGreaterThan(0)
    expect(DATE_SEARCH_FIELDS.length).toBeGreaterThan(0)
    expect(BOOLEAN_SEARCH_FIELDS.length).toBeGreaterThan(0)
    expect(ARRAY_SEARCH_FIELDS.length).toBeGreaterThan(0)
  })

  it('ALL_SEARCH_FIELDS is the union of every category', () => {
    const expected = new Set<string>([
      ...STRING_SEARCH_FIELDS, ...NUMERIC_SEARCH_FIELDS,
      ...DATE_SEARCH_FIELDS, ...BOOLEAN_SEARCH_FIELDS, ...ARRAY_SEARCH_FIELDS,
    ])
    expect(new Set(ALL_SEARCH_FIELDS)).toEqual(expected)
  })

  it('type guards reject anything outside the whitelist', () => {
    expect(isStringSearchField('naicsCode')).toBe(true)
    expect(isStringSearchField('anything_else')).toBe(false)
    expect(isNumericSearchField('approvedDlomPercent')).toBe(true)
    expect(isNumericSearchField('SELECT * FROM cases')).toBe(false)
    expect(isDateSearchField('valuationDate')).toBe(true)
    expect(isDateSearchField('createdAt')).toBe(false)   // not indexed
    expect(isBooleanSearchField('hasRelatedPartyAddBack')).toBe(true)
    expect(isBooleanSearchField('isDeleted')).toBe(false)
    expect(isArraySearchField('methodsApplied')).toBe(true)
    expect(isArraySearchField('methodsRecommended')).toBe(false)
  })

  it('the whitelist covers the Slice-16-required index fields', () => {
    // Explicitly named in the slice prompt.
    const required = [
      'naicsCode', 'sicCode', 'industryLabel',        // industry
      'subjectState', 'subjectCity', 'subjectCountry',// geography
      'valuationDate',                                 // valuation date
      'methodsApplied',                                // methods
      'approvedAddBackCategoryKeys',                   // approved adjustment categories
      'approvedAssumptionKeys',                        // approved assumptions
      'reportStatus', 'reportFinalizedAt',             // report metadata
      'documentCount',                                 // document metadata
    ]
    for (const f of required) expect(ALL_SEARCH_FIELDS).toContain(f)
  })
})

describe('validateFilterSet — rejects untrusted input', () => {
  it('rejects an unknown field even if the rest is well-formed', () => {
    const r = validateFilterSet({ filters: [
      { kind: 'string', filter: { field: 'confidential_key', op: 'eq', value: 'x' } as any },
    ] })
    expect(r.ok).toBe(false)
    expect(r.reasons.some(x => /confidential_key/.test(x))).toBe(true)
  })

  it('rejects an unknown kind', () => {
    const r = validateFilterSet({ filters: [
      { kind: 'SQL_LIKE', filter: { field: 'caseName', op: 'eq', value: 'x' } } as any,
    ] })
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown op on a valid field (e.g. numeric.contains)', () => {
    const r = validateFilterSet({ filters: [
      { kind: 'numeric', filter: { field: 'approvedDlomPercent', op: 'contains', value: '0.2' } as any },
    ] })
    expect(r.ok).toBe(false)
  })

  it('rejects a limit above the cap', () => {
    const r = validateFilterSet({ filters: [], limit: 500 })
    expect(r.ok).toBe(false)
  })

  it('rejects non-decimal numeric values', () => {
    const r = validateFilterSet({ filters: [
      { kind: 'numeric', filter: { field: 'approvedDlomPercent', op: 'gte', value: 'twenty percent' } },
    ] })
    expect(r.ok).toBe(false)
  })

  it('accepts a well-formed FilterSet with all supported kinds', () => {
    const r = validateFilterSet({
      filters: [
        { kind: 'string',  filter: { field: 'subjectState', op: 'eq', value: 'CO' } },
        { kind: 'array',   filter: { field: 'methodsApplied', op: 'includes', value: 'INCOME_CAP_EARNINGS' } },
        { kind: 'numeric', filter: { field: 'approvedDlomPercent', op: 'between', min: '0.18', max: '0.25' } },
        { kind: 'date',    filter: { field: 'valuationDate', op: 'gte', value: '2020-01-01' } },
        { kind: 'boolean', filter: { field: 'hasRelatedPartyAddBack', op: 'eq', value: true } },
      ],
      limit: 25,
    })
    expect(r.ok).toBe(true)
    expect(r.reasons).toEqual([])
  })
})

describe('composeSearchQuery — silently drops unwhitelisted fields', () => {
  it('discards a filter for an unknown field and records it in dropped[]', () => {
    const q = composeSearchQuery({
      organizationId: 'org-1',
      filterSet: { filters: [
        { kind: 'string', filter: { field: 'clientEmail', op: 'eq', value: 'x@y.com' } as any },
        { kind: 'string', filter: { field: 'subjectState', op: 'eq', value: 'CO'    } },
      ] },
    })
    expect(q.dropped).toContain('clientEmail')
    // The composed WHERE still applies the org filter + the valid clause.
    const whereAsAny = q.where as any
    expect(JSON.stringify(whereAsAny)).toContain('subjectState')
    expect(JSON.stringify(whereAsAny)).not.toContain('clientEmail')
  })

  it('always applies the tenant filter — never omits organizationId', () => {
    const q = composeSearchQuery({
      organizationId: 'org-1',
      filterSet: { filters: [] },
    })
    const whereAsAny = q.where as any
    expect(JSON.stringify(whereAsAny)).toContain('org-1')
  })

  it('caps `take` at 200 even when the caller passes 999', () => {
    const q = composeSearchQuery({
      organizationId: 'org-1',
      filterSet: { filters: [], limit: 999 },
    })
    expect(q.take).toBeLessThanOrEqual(200)
  })
})
