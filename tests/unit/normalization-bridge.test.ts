import { describe, it, expect } from 'vitest'
import { bridgeForPeriod, computeBridge, PERIODS } from '@/lib/normalization/bridge'
import { money } from '@/lib/money'

// ─────────────────────────────────────────────────
// bridgeForPeriod
// ─────────────────────────────────────────────────

describe('bridgeForPeriod', () => {
  it('starts at reported when there are no adjustments', () => {
    const r = bridgeForPeriod('year1', '1000000', [])
    expect(r.reported.toString()).toBe('1000000')
    expect(r.netAdjustment.toString()).toBe('0')
    expect(r.normalized.toString()).toBe('1000000')
    expect(r.appliedAdjustments).toBe(0)
  })

  it('adds an APPROVED ADD adjustment for the matching period', () => {
    const r = bridgeForPeriod('year1', '1000000', [
      { id: 'a1', direction: 'ADD', status: 'APPROVED', amounts: { year1: '50000' } },
    ])
    expect(r.netAdjustment.toString()).toBe('50000')
    expect(r.normalized.toString()).toBe('1050000')
    expect(r.appliedAdjustments).toBe(1)
  })

  it('subtracts an APPROVED SUBTRACT adjustment', () => {
    const r = bridgeForPeriod('year1', '1000000', [
      { id: 'a1', direction: 'SUBTRACT', status: 'APPROVED', amounts: { year1: '75000' } },
    ])
    expect(r.netAdjustment.toString()).toBe('-75000')
    expect(r.normalized.toString()).toBe('925000')
  })

  it('IGNORES non-APPROVED adjustments (Rule: no silent inclusion of unapproved work)', () => {
    const r = bridgeForPeriod('year1', '1000000', [
      { id: 'a1', direction: 'ADD', status: 'DRAFT',         amounts: { year1: '50000' } },
      { id: 'a2', direction: 'ADD', status: 'PROPOSED',      amounts: { year1: '10000' } },
      { id: 'a3', direction: 'ADD', status: 'NEEDS_SUPPORT', amounts: { year1: '20000' } },
      { id: 'a4', direction: 'ADD', status: 'REJECTED',      amounts: { year1: '30000' } },
      { id: 'a5', direction: 'ADD', status: 'APPROVED',      amounts: { year1: '99999' } },
    ])
    // Only the APPROVED $99,999 hits the bridge.
    expect(r.netAdjustment.toString()).toBe('99999')
    expect(r.appliedAdjustments).toBe(1)
  })

  it('ignores an adjustment that has no amount for the requested period', () => {
    const r = bridgeForPeriod('ttm', '500000', [
      { id: 'a1', direction: 'ADD', status: 'APPROVED', amounts: { year1: '100000' } },
    ])
    expect(r.netAdjustment.toString()).toBe('0')
    expect(r.appliedAdjustments).toBe(0)
  })

  it('handles negative reported EBITDA (net operating loss year)', () => {
    const r = bridgeForPeriod('year2', '-200000', [
      { id: 'a1', direction: 'ADD', status: 'APPROVED', amounts: { year2: '250000' } },
    ])
    expect(r.normalized.toString()).toBe('50000')
  })

  it('exact decimal arithmetic — no float drift', () => {
    // Classic float trap: 0.1 + 0.2 = 0.30000000000000004. Decimal keeps it exact.
    const r = bridgeForPeriod('year1', '0.1', [
      { id: 'a1', direction: 'ADD', status: 'APPROVED', amounts: { year1: '0.2' } },
    ])
    expect(r.normalized.toString()).toBe('0.3')
  })

  it('sums many small APPROVED add-backs correctly', () => {
    const r = bridgeForPeriod('year1', '0', Array.from({ length: 10_000 }, (_, i) => ({
      id: `a${i}`, direction: 'ADD' as const, status: 'APPROVED', amounts: { year1: '0.0001' },
    })))
    expect(r.normalized.toString()).toBe('1')
  })
})

// ─────────────────────────────────────────────────
// computeBridge — full three-period roll-up
// ─────────────────────────────────────────────────

describe('computeBridge', () => {
  it('produces a per-period record for every supported period', () => {
    const b = computeBridge({ year2: '1000', year1: '2000', ttm: '3000' }, [])
    for (const p of PERIODS) {
      expect(b.perPeriod[p]!.reported.toString()).toBeDefined()
    }
    expect(b.totalReported.toString()).toBe('6000')
    expect(b.totalNormalized.toString()).toBe('6000')
  })

  it('mixes ADD and SUBTRACT correctly across periods', () => {
    const b = computeBridge({ year2: '1000', year1: '2000', ttm: '3000' }, [
      { id: 'a1', direction: 'ADD',      status: 'APPROVED', amounts: { year1: '500' } },
      { id: 'a2', direction: 'SUBTRACT', status: 'APPROVED', amounts: { ttm: '300' } },
      { id: 'a3', direction: 'ADD',      status: 'PROPOSED', amounts: { year1: '100000' } }, // ignored
    ])
    expect(b.perPeriod.year1.normalized.toString()).toBe('2500')
    expect(b.perPeriod.ttm.normalized.toString()).toBe('2700')
    expect(b.perPeriod.year2.normalized.toString()).toBe('1000')  // no adjustments
    expect(b.approvedCount).toBe(2)
    expect(b.ignoredCount).toBe(1)
  })

  it('nullish reported values fall back to 0', () => {
    const b = computeBridge({ year2: null, year1: undefined, ttm: '1000' }, [])
    expect(b.perPeriod.year2.reported.toString()).toBe('0')
    expect(b.perPeriod.year1.reported.toString()).toBe('0')
    expect(b.perPeriod.ttm.reported.toString()).toBe('1000')
  })

  it('counts every adjustment either approved or ignored — the union is exhaustive', () => {
    const adjustments = [
      { id: '1', direction: 'ADD' as const, status: 'APPROVED', amounts: { year1: '10' } },
      { id: '2', direction: 'ADD' as const, status: 'DRAFT',    amounts: { year1: '10' } },
      { id: '3', direction: 'ADD' as const, status: 'REJECTED', amounts: { year1: '10' } },
    ]
    const b = computeBridge({ year1: '0' }, adjustments)
    expect(b.approvedCount + b.ignoredCount).toBe(adjustments.length)
  })
})
