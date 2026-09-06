import { describe, it, expect } from 'vitest'
import {
  ADJUSTMENT_STATUSES,
  canTransition,
  isReviewerQueueStatus,
  transitionRequiresReason,
  DASHBOARD_STATUS_ORDER,
  STATUS_LABEL,
  ALLOWED_TRANSITIONS,
} from '@/lib/normalization/statuses'

describe('adjustment status catalog', () => {
  it('exposes the five documented statuses', () => {
    expect([...ADJUSTMENT_STATUSES].sort()).toEqual(
      ['APPROVED', 'DRAFT', 'NEEDS_SUPPORT', 'PROPOSED', 'REJECTED']
    )
  })

  it('every status has a label', () => {
    for (const s of ADJUSTMENT_STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy()
    }
  })

  it('every status has a dashboard sort rank', () => {
    for (const s of ADJUSTMENT_STATUSES) {
      expect(typeof DASHBOARD_STATUS_ORDER[s]).toBe('number')
    }
  })
})

describe('canTransition — the state machine', () => {
  it.each([
    ['DRAFT',         'PROPOSED'],
    ['PROPOSED',      'APPROVED'],
    ['PROPOSED',      'REJECTED'],
    ['PROPOSED',      'NEEDS_SUPPORT'],
    ['PROPOSED',      'DRAFT'],
    ['NEEDS_SUPPORT', 'PROPOSED'],
    ['NEEDS_SUPPORT', 'DRAFT'],
    ['APPROVED',      'DRAFT'],   // reviewer reopens for rework
    ['REJECTED',      'DRAFT'],
  ] as const)('%s → %s is allowed', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it.each([
    // Cannot skip PROPOSED gate
    ['DRAFT', 'APPROVED'],
    ['DRAFT', 'REJECTED'],
    ['DRAFT', 'NEEDS_SUPPORT'],
    // Cannot flip a verdict silently
    ['APPROVED', 'REJECTED'],
    ['REJECTED', 'APPROVED'],
    // Cannot go from NEEDS_SUPPORT direct to APPROVED (must re-propose)
    ['NEEDS_SUPPORT', 'APPROVED'],
    ['NEEDS_SUPPORT', 'REJECTED'],
    // Self-transitions
    ['DRAFT', 'DRAFT'],
    ['APPROVED', 'APPROVED'],
  ] as const)('%s → %s is refused', (from, to) => {
    expect(canTransition(from, to)).toBe(false)
  })
})

describe('reviewer queue definition', () => {
  it('PROPOSED and NEEDS_SUPPORT are reviewer-queue statuses', () => {
    expect(isReviewerQueueStatus('PROPOSED')).toBe(true)
    expect(isReviewerQueueStatus('NEEDS_SUPPORT')).toBe(true)
  })
  it.each(['DRAFT','APPROVED','REJECTED','SOMETHING_ELSE'])('%s is NOT a queue status', (s) => {
    expect(isReviewerQueueStatus(s)).toBe(false)
  })
})

describe('reasons required', () => {
  it('REJECTED requires a reason', () => {
    expect(transitionRequiresReason('REJECTED')).toBe(true)
  })
  it('NEEDS_SUPPORT requires a reason', () => {
    expect(transitionRequiresReason('NEEDS_SUPPORT')).toBe(true)
  })
  it.each(['DRAFT','PROPOSED','APPROVED'] as const)('%s does NOT require a reason', (s) => {
    expect(transitionRequiresReason(s)).toBe(false)
  })
})

describe('dashboard sort order — pending review comes first', () => {
  it('NEEDS_SUPPORT sorts before every other status', () => {
    for (const other of ['PROPOSED','DRAFT','REJECTED','APPROVED'] as const) {
      expect(DASHBOARD_STATUS_ORDER['NEEDS_SUPPORT']).toBeLessThan(DASHBOARD_STATUS_ORDER[other])
    }
  })
  it('PROPOSED sorts before DRAFT / REJECTED / APPROVED', () => {
    for (const other of ['DRAFT','REJECTED','APPROVED'] as const) {
      expect(DASHBOARD_STATUS_ORDER['PROPOSED']).toBeLessThan(DASHBOARD_STATUS_ORDER[other])
    }
  })
  it('APPROVED sorts last', () => {
    for (const other of ['NEEDS_SUPPORT','PROPOSED','DRAFT','REJECTED'] as const) {
      expect(DASHBOARD_STATUS_ORDER[other]).toBeLessThan(DASHBOARD_STATUS_ORDER['APPROVED'])
    }
  })
})

describe('ALLOWED_TRANSITIONS is exhaustive and consistent', () => {
  it('has an entry for every status', () => {
    for (const s of ADJUSTMENT_STATUSES) {
      expect(Array.isArray(ALLOWED_TRANSITIONS[s])).toBe(true)
    }
  })
})
