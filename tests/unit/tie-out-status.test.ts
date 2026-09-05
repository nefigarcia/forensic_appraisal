import { describe, it, expect } from 'vitest'
import {
  median,
  maxPairwiseDifference,
  effectiveTolerance,
  computeTieOutStatus,
  DASHBOARD_SORT_ORDER,
} from '@/lib/tie-out/status'
import { money } from '@/lib/money'
import { defaultToleranceFor } from '@/lib/tie-out/concepts'

// ─────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────

describe('median', () => {
  it('handles empty (returns zero)', () => {
    expect(median([]).toString()).toBe('0')
  })
  it('odd count', () => {
    expect(median(['1','3','2'].map(money)).toString()).toBe('2')
  })
  it('even count averages the two middles', () => {
    expect(median(['1','2','3','4'].map(money)).toString()).toBe('2.5')
  })
  it('handles a single element', () => {
    expect(median([money('42')]).toString()).toBe('42')
  })
  it('handles decimals exactly (no float drift)', () => {
    expect(median(['0.1','0.2','0.3'].map(money)).toString()).toBe('0.2')
  })
})

describe('maxPairwiseDifference', () => {
  it('zero for 0 or 1 values', () => {
    expect(maxPairwiseDifference([]).toString()).toBe('0')
    expect(maxPairwiseDifference([money('100')]).toString()).toBe('0')
  })
  it('equals max - min', () => {
    expect(maxPairwiseDifference(['10','5','7','20','12'].map(money)).toString()).toBe('15')
  })
  it('handles negative values', () => {
    expect(maxPairwiseDifference(['-5','10','-2'].map(money)).toString()).toBe('15')
  })
  it('handles exact decimal differences', () => {
    expect(maxPairwiseDifference(['0.1','0.2','0.3'].map(money)).toString()).toBe('0.2')
  })
})

describe('effectiveTolerance', () => {
  it('uses whichever of absolute or percent×|median| is larger', () => {
    const tol = { absolute: money('100'), percent: money('0.01') }
    // median = 10_000 → percent term = 100 → absolute term = 100 → tie
    expect(effectiveTolerance(money('10000'), tol).toString()).toBe('100')
    // median = 100_000 → percent term = 1_000 → dominates absolute
    expect(effectiveTolerance(money('100000'), tol).toString()).toBe('1000')
  })
  it('uses absolute when median is 0', () => {
    const tol = { absolute: money('100'), percent: money('0.01') }
    expect(effectiveTolerance(money('0'), tol).toString()).toBe('100')
  })
  it('handles negative medians via absolute value', () => {
    const tol = { absolute: money('0'), percent: money('0.05') }
    expect(effectiveTolerance(money('-1000'), tol).toString()).toBe('50')
  })
})

// ─────────────────────────────────────────────────
// computeTieOutStatus — the four automatic states
// ─────────────────────────────────────────────────

describe('computeTieOutStatus', () => {
  const tol = { absolute: money('1000'), percent: money('0.002') }

  it('UNRESOLVED for 0 items', () => {
    expect(computeTieOutStatus([], tol).status).toBe('UNRESOLVED')
  })

  it('UNRESOLVED for exactly 1 item — you cannot reconcile a single source', () => {
    const r = computeTieOutStatus(['5000000'], tol)
    expect(r.status).toBe('UNRESOLVED')
    expect(r.maxDifference.toString()).toBe('0')
    expect(r.median.toString()).toBe('5000000')
  })

  it('TIED when every value is identical', () => {
    const r = computeTieOutStatus(['4821309','4821309','4821309'], tol)
    expect(r.status).toBe('TIED')
    expect(r.maxDifference.toString()).toBe('0')
  })

  it('WITHIN_TOLERANCE for small pennies difference', () => {
    // Revenue example: 3 values within $2 of each other
    const r = computeTieOutStatus(['4821309','4821309','4821307'], tol)
    expect(r.status).toBe('WITHIN_TOLERANCE')
    expect(r.maxDifference.toString()).toBe('2')
  })

  it('DISCREPANCY when max diff exceeds both tolerance rules', () => {
    // percent term = 0.2% * median(5_005_000) = 10_010; absolute = 1_000
    // effective = max(1_000, 10_010) = 10_010. Diff of 15_000 clears both.
    const r = computeTieOutStatus(['5000000','5015000','5005000'], tol)
    expect(r.status).toBe('DISCREPANCY')
    expect(r.maxDifference.toString()).toBe('15000')
  })

  it('the boundary — exactly equal to effective tolerance is WITHIN_TOLERANCE', () => {
    // percent term = 0.2% * 5_000_000 = 10_000; diff = exactly 10_000 → within
    const r = computeTieOutStatus(['5000000','5010000','5000000'], tol)
    expect(r.status).toBe('WITHIN_TOLERANCE')
    expect(r.maxDifference.toString()).toBe('10000')
  })

  it('classic tax-return / P&L / GL revenue example ties', () => {
    // Exact scenario from the slice prompt: $2 diff → within Revenue tolerance.
    const r = computeTieOutStatus(['4821309','4821309','4821307'], defaultToleranceFor('REVENUE'))
    expect(r.status).toBe('WITHIN_TOLERANCE')
    expect(r.maxDifference.toString()).toBe('2')
  })

  it('same shape at a much larger scale still stays within % tolerance', () => {
    // Revenue tol is 0.2% or $1000. At $48M with a $10 diff, easily within.
    const r = computeTieOutStatus(['48213090','48213090','48213080'], defaultToleranceFor('REVENUE'))
    expect(r.status).toBe('WITHIN_TOLERANCE')
  })

  it('handles NEGATIVE values (e.g. net loss)', () => {
    const r = computeTieOutStatus(['-500000','-500001','-499999'], defaultToleranceFor('NET_INCOME'))
    expect(r.status).toBe('WITHIN_TOLERANCE')
    expect(r.maxDifference.toString()).toBe('2')
  })

  it('exact-decimal difference stays deterministic (no float drift)', () => {
    // 0.1 + 0.2 + 0.3 would drift in float arithmetic; Decimal keeps it clean.
    const r = computeTieOutStatus(['0.1','0.2','0.3'], { absolute: money('0.05'), percent: money('0') })
    // Max diff 0.2 > 0.05 → discrepancy, exactly.
    expect(r.status).toBe('DISCREPANCY')
    expect(r.maxDifference.toString()).toBe('0.2')
  })
})

// ─────────────────────────────────────────────────
// Sort order — the "never auto-hide" invariant
// ─────────────────────────────────────────────────

describe('dashboard sort order', () => {
  it('DISCREPANCY comes before every other status', () => {
    const others: (keyof typeof DASHBOARD_SORT_ORDER)[] = ['UNRESOLVED','RESOLVED','WITHIN_TOLERANCE','TIED']
    for (const o of others) {
      expect(DASHBOARD_SORT_ORDER['DISCREPANCY']).toBeLessThan(DASHBOARD_SORT_ORDER[o])
    }
  })

  it('RESOLVED sits BETWEEN UNRESOLVED and WITHIN_TOLERANCE — deliberate visibility choice', () => {
    // Reasoning: RESOLVED items are still worth a glance after unresolved,
    // ahead of the "everything's fine" tier. Documented, not accidental.
    expect(DASHBOARD_SORT_ORDER['UNRESOLVED']).toBeLessThan(DASHBOARD_SORT_ORDER['RESOLVED'])
    expect(DASHBOARD_SORT_ORDER['RESOLVED']).toBeLessThan(DASHBOARD_SORT_ORDER['WITHIN_TOLERANCE'])
  })

  it('TIED comes last', () => {
    for (const s of ['DISCREPANCY','UNRESOLVED','RESOLVED','WITHIN_TOLERANCE'] as const) {
      expect(DASHBOARD_SORT_ORDER[s]).toBeLessThan(DASHBOARD_SORT_ORDER['TIED'])
    }
  })
})
