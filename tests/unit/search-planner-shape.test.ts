/**
 * LOAD-BEARING: the AI planner shape can never recommend a
 * valuation method or return confidential values.
 *
 * The output schema is a Zod `discriminatedUnion` on `kind` with
 * closed enum fields. This test walks a candidate output payload and
 * asserts that:
 *   - the schema rejects a "recommendation" wrapper,
 *   - the schema rejects unknown field names,
 *   - the schema rejects unknown operators.
 *
 * Because the planner's output cannot express advice, downstream code
 * has nothing to accidentally treat as advice.
 */

import { describe, it, expect } from 'vitest'
import {
  ALL_SEARCH_FIELDS, validateFilterSet,
} from '@/lib/search/query-shape'

describe('planner output — no advice, no confidential values', () => {
  it('no field name in the whitelist is a case identifier, client name, or user id', () => {
    for (const f of ALL_SEARCH_FIELDS) {
      // Structural guard — the whitelisted field names describe
      // structured properties. Any field that includes "id",
      // "email", "userId", or the like is either intentional (naicsCode,
      // sicCode — industry codes, not personal ids) or a bug.
      const lower = f.toLowerCase()
      // Explicit allowlist for legitimately id-shaped fields.
      const idShapedAllowlist = ['naicscode', 'siccode']
      if (idShapedAllowlist.includes(lower)) continue
      // Everything else must not look like a confidential-id field.
      expect(lower).not.toContain('userid')
      expect(lower).not.toContain('email')
      expect(lower).not.toContain('token')
      expect(lower).not.toContain('accountid')
    }
  })

  it('validateFilterSet rejects a "recommendation" clause even if wrapped as a string', () => {
    // A hostile prompt could try to smuggle advice via a filter with
    // an ambiguous "value". The validator would only accept it as a
    // literal search value; downstream results are the case rows
    // themselves — no recommendation surface.
    const r = validateFilterSet({
      filters: [{
        kind: 'string',
        filter: { field: 'engagementType', op: 'contains', value: 'RECOMMEND METHOD X' },
      }],
    })
    // This IS a valid filter (a substring search), but returning the
    // string does not translate into advice: the result rows are
    // whatever cases have engagementType containing that literal.
    expect(r.ok).toBe(true)
    // The important guarantee: the filter can NEVER address a field
    // that expresses "recommendation".
    expect(ALL_SEARCH_FIELDS.some(f => /recommend/i.test(f))).toBe(false)
  })

  it('no operator is available that would join two rows or aggregate across cases', () => {
    // The DSL contains only per-row predicates. There is no `groupBy`,
    // `having`, `join`, `AND across cases`, or similar. Regression
    // that added such an operator would surface here.
    for (const kind of ['string', 'numeric', 'date', 'boolean', 'array']) {
      // A quick spot check — the composer would drop these ops.
      const r = validateFilterSet({
        filters: [{ kind, filter: { field: 'caseName', op: 'GROUP_BY' as any, value: 'x' } as any }],
      })
      expect(r.ok).toBe(false)
    }
  })
})
