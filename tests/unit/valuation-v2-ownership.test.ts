/**
 * LOAD-BEARING: DLOC/DLOM never auto-apply.
 *
 * These tests pin the Slice-13 invariant that `applyOwnershipDiscounts`
 * refuses any non-APPROVED row. Any regression that lets a DRAFT
 * discount reach the persisted math must fail here.
 */

import { describe, it, expect } from 'vitest'
import {
  applyOwnershipDiscounts,
  previewOwnershipDiscounts,
  type OwnershipDiscountRow,
} from '@/lib/valuation-v2/ownership'

const APPROVED = (r: Partial<OwnershipDiscountRow>): OwnershipDiscountRow => ({
  kind: 'DLOM', percent: '0.20', status: 'APPROVED',
  rationale: 'Restricted-stock study — 20% median (Longstaff 2019)',
  source: 'Restricted-stock studies',
  ...r,
})

describe('applyOwnershipDiscounts — non-APPROVED rows are refused', () => {
  it.each(['DRAFT', 'PROPOSED', 'REJECTED', 'SUPERSEDED'] as const)(
    'throws when a row is %s',
    (status) => {
      expect(() => applyOwnershipDiscounts('10_000_000'.replace(/_/g, ''), [
        APPROVED({ id: 'row-1', status }),
      ])).toThrow(/only APPROVED rows may be applied/)
    },
  )

  it('does NOT touch the value when the input list is empty', () => {
    const r = applyOwnershipDiscounts('10000000', [])
    expect(r.effectiveMultiplier.toString()).toBe('1')
    expect(r.cumulativeDiscount.toString()).toBe('0')
    expect(r.discountedValue.toString()).toBe('10000000')
  })

  it('a single 30 % DLOM approved with a rationale drops equity by 30 %', () => {
    const r = applyOwnershipDiscounts('10000000', [
      APPROVED({ kind: 'DLOM', percent: '0.30' }),
    ])
    expect(r.cumulativeDiscount.toString()).toBe('0.3')
    expect(r.discountedValue.toString()).toBe('7000000')
  })

  it('multiple discounts compose multiplicatively, not additively', () => {
    // 30 % DLOC then 20 % DLOM ≠ 50 %. Should be 1 - 0.7*0.8 = 0.44.
    const r = applyOwnershipDiscounts('10000000', [
      APPROVED({ kind: 'DLOC', percent: '0.30', rationale: 'Mandelbaum factors' }),
      APPROVED({ kind: 'DLOM', percent: '0.20' }),
    ])
    expect(r.effectiveMultiplier.toString()).toBe('0.56')
    expect(r.cumulativeDiscount.toString()).toBe('0.44')
    expect(r.discountedValue.toString()).toBe('5600000')
  })

  it('refuses percent < 0 or ≥ 1', () => {
    expect(() => applyOwnershipDiscounts('100', [APPROVED({ percent: '-0.05' })])).toThrow(/must be in \[0, 1\)/)
    expect(() => applyOwnershipDiscounts('100', [APPROVED({ percent: '1'   })])).toThrow(/must be in \[0, 1\)/)
    expect(() => applyOwnershipDiscounts('100', [APPROVED({ percent: '2'   })])).toThrow()
  })

  it('refuses an APPROVED row that somehow made it through with a blank rationale', () => {
    // Schema invariant should prevent this at the action layer; the
    // math library is defense-in-depth.
    expect(() => applyOwnershipDiscounts('100', [
      APPROVED({ rationale: '' }),
    ])).toThrow(/missing rationale/)
    expect(() => applyOwnershipDiscounts('100', [
      APPROVED({ rationale: '   ' }),
    ])).toThrow(/missing rationale/)
  })
})

describe('previewOwnershipDiscounts — accepts any status', () => {
  it('computes the same effective multiplier as applyOwnershipDiscounts', () => {
    const p = previewOwnershipDiscounts('10000000', [
      { kind: 'DLOM', percent: '0.30', status: 'DRAFT', rationale: null },
    ])
    expect(p.effectiveMultiplier.toString()).toBe('0.7')
    expect(p.previewValue.toString()).toBe('7000000')
    expect(p.includedCount).toBe(1)
  })

  it('returns a preview-shaped result (distinct type — no accidental swap possible)', () => {
    const p = previewOwnershipDiscounts('100', [])
    // Preview shape has `previewValue`, application has `discountedValue`.
    expect((p as any).previewValue).toBeDefined()
    expect((p as any).discountedValue).toBeUndefined()
  })
})

describe('sanity: control-vs-marketability semantics remain the analyst\'s choice', () => {
  it('no default DLOM is applied to a non-marketable interest — the caller must add an APPROVED row', () => {
    // A non-marketable interest without any ownership adjustments
    // returns the equity value unchanged. There is NO built-in default
    // DLOM the library applies on its own.
    const r = applyOwnershipDiscounts('12345678', [])
    expect(r.discountedValue.toString()).toBe('12345678')
    expect(r.cumulativeDiscount.toString()).toBe('0')
  })
})
