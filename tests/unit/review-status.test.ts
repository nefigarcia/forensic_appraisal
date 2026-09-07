import { describe, it, expect } from 'vitest'
import {
  REVIEW_STATUSES,
  ALLOWED_REVIEW_TRANSITIONS,
  canReviewTransition,
  transitionRequiresNote,
  isReviewerQueueStatus,
  REVIEW_STATUS_ORDER,
  REVIEW_STATUS_LABEL,
} from '@/lib/reviews/statuses'

describe('review status catalog', () => {
  it('exposes the four documented statuses', () => {
    expect([...REVIEW_STATUSES].sort()).toEqual(
      ['APPROVED','CHANGES_REQUESTED','DRAFT','READY_FOR_REVIEW']
    )
  })
  it('every status has a label + sort rank + transition list', () => {
    for (const s of REVIEW_STATUSES) {
      expect(REVIEW_STATUS_LABEL[s]).toBeTruthy()
      expect(typeof REVIEW_STATUS_ORDER[s]).toBe('number')
      expect(Array.isArray(ALLOWED_REVIEW_TRANSITIONS[s])).toBe(true)
    }
  })
})

describe('canReviewTransition — the state machine', () => {
  it.each([
    ['DRAFT',             'READY_FOR_REVIEW'],
    ['READY_FOR_REVIEW',  'APPROVED'],
    ['READY_FOR_REVIEW',  'CHANGES_REQUESTED'],
    ['READY_FOR_REVIEW',  'DRAFT'],
    ['CHANGES_REQUESTED', 'READY_FOR_REVIEW'],
    ['CHANGES_REQUESTED', 'DRAFT'],
    ['APPROVED',          'READY_FOR_REVIEW'],
  ] as const)('%s → %s is allowed', (from, to) => {
    expect(canReviewTransition(from, to)).toBe(true)
  })

  it.each([
    // Cannot skip READY_FOR_REVIEW gate
    ['DRAFT',    'APPROVED'],
    ['DRAFT',    'CHANGES_REQUESTED'],
    // Cannot flip a verdict silently
    ['APPROVED', 'CHANGES_REQUESTED'],
    ['APPROVED', 'DRAFT'],
    // Cannot go directly from NEEDS_SUPPORT-style state to APPROVED
    ['CHANGES_REQUESTED', 'APPROVED'],
    // Self-transitions rejected
    ['DRAFT',    'DRAFT'],
    ['APPROVED', 'APPROVED'],
  ] as const)('%s → %s is refused', (from, to) => {
    expect(canReviewTransition(from, to)).toBe(false)
  })
})

describe('reviewer queue definition', () => {
  it('only READY_FOR_REVIEW is a queue status', () => {
    expect(isReviewerQueueStatus('READY_FOR_REVIEW')).toBe(true)
    for (const other of ['DRAFT','CHANGES_REQUESTED','APPROVED']) {
      expect(isReviewerQueueStatus(other)).toBe(false)
    }
  })
})

describe('transitions requiring a note', () => {
  it('CHANGES_REQUESTED requires a note', () => {
    expect(transitionRequiresNote('CHANGES_REQUESTED')).toBe(true)
  })
  it.each(['DRAFT','READY_FOR_REVIEW','APPROVED'] as const)(
    '%s does not require a note', (s) => {
      expect(transitionRequiresNote(s)).toBe(false)
    })
})

describe('sort order — reviewer-queue items first', () => {
  it('READY_FOR_REVIEW sorts before every other status', () => {
    for (const other of ['CHANGES_REQUESTED','DRAFT','APPROVED'] as const) {
      expect(REVIEW_STATUS_ORDER['READY_FOR_REVIEW']).toBeLessThan(REVIEW_STATUS_ORDER[other])
    }
  })
  it('APPROVED sorts last', () => {
    for (const other of ['READY_FOR_REVIEW','CHANGES_REQUESTED','DRAFT'] as const) {
      expect(REVIEW_STATUS_ORDER[other]).toBeLessThan(REVIEW_STATUS_ORDER['APPROVED'])
    }
  })
})
