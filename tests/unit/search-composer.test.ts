/**
 * `composeSearchQuery` — filter DSL → Prisma WHERE.
 */

import { describe, it, expect } from 'vitest'
import { composeSearchQuery } from '@/lib/search/filters'

describe('composeSearchQuery', () => {
  it('emits the tenant clause + caseId shortlist as an AND', () => {
    const q = composeSearchQuery({
      organizationId: 'org-1',
      authorizedCaseIds: ['case-a', 'case-b'],
      filterSet: { filters: [] },
    })
    const asStr = JSON.stringify(q.where)
    expect(asStr).toContain('org-1')
    expect(asStr).toContain('case-a')
    expect(asStr).toContain('case-b')
  })

  it('empty authorizedCaseIds still produces the caseId IN [] clause (no results)', () => {
    const q = composeSearchQuery({
      organizationId: 'org-1',
      authorizedCaseIds: [],
      filterSet: { filters: [] },
    })
    const w = q.where as any
    // Look for the `caseId IN []` inside the AND.
    const asStr = JSON.stringify(w)
    expect(asStr).toContain('"in":[]')
  })

  it('string contains → { contains: ... }', () => {
    const q = composeSearchQuery({
      organizationId: 'org-1',
      filterSet: { filters: [
        { kind: 'string', filter: { field: 'industryLabel', op: 'contains', value: 'HVAC' } },
      ] },
    })
    const asStr = JSON.stringify(q.where)
    expect(asStr).toContain('"industryLabel"')
    expect(asStr).toContain('"contains":"HVAC"')
  })

  it('numeric between → { gte, lte }', () => {
    const q = composeSearchQuery({
      organizationId: 'org-1',
      filterSet: { filters: [
        { kind: 'numeric', filter: { field: 'approvedDlomPercent', op: 'between', min: '0.18', max: '0.25' } },
      ] },
    })
    const asStr = JSON.stringify(q.where)
    expect(asStr).toContain('"gte":"0.18"')
    expect(asStr).toContain('"lte":"0.25"')
  })

  it('array anyOf → OR of array_contains', () => {
    const q = composeSearchQuery({
      organizationId: 'org-1',
      filterSet: { filters: [
        { kind: 'array', filter: { field: 'methodsApplied', op: 'anyOf', values: ['INCOME_DCF', 'INCOME_CAP_EARNINGS'] } },
      ] },
    })
    const asStr = JSON.stringify(q.where)
    expect(asStr).toContain('array_contains')
    expect(asStr).toContain('INCOME_DCF')
    expect(asStr).toContain('INCOME_CAP_EARNINGS')
  })

  it('date between → { gte, lte } Date objects', () => {
    const q = composeSearchQuery({
      organizationId: 'org-1',
      filterSet: { filters: [
        { kind: 'date', filter: { field: 'valuationDate', op: 'between', min: '2020-01-01', max: '2023-12-31' } },
      ] },
    })
    // Prisma expects Date objects; the composer converts.
    const asStr = JSON.stringify(q.where)
    expect(asStr).toContain('2020-01-01')
    expect(asStr).toContain('2023-12-31')
  })

  it('boolean eq → the raw boolean value', () => {
    const q = composeSearchQuery({
      organizationId: 'org-1',
      filterSet: { filters: [
        { kind: 'boolean', filter: { field: 'hasRelatedPartyAddBack', op: 'eq', value: true } },
      ] },
    })
    const asStr = JSON.stringify(q.where)
    expect(asStr).toContain('"hasRelatedPartyAddBack":true')
  })

  it('respects orderBy + orderDir', () => {
    const q = composeSearchQuery({
      organizationId: 'org-1',
      filterSet: { filters: [], orderBy: 'valuationDate', orderDir: 'asc' },
    })
    expect(q.orderBy).toEqual({ valuationDate: 'asc' })
  })
})
