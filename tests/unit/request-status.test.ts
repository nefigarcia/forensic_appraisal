import { describe, it, expect } from 'vitest'
import {
  REQUEST_ITEM_STATUSES,
  ALLOWED_REQUEST_ITEM_TRANSITIONS,
  canRequestItemTransition,
  requestItemTransitionRequiresNote,
  classifyForDashboard,
  REQUEST_ITEM_SORT_ORDER,
  isRequestItemStatus,
  isRequestListStatus,
  REQUEST_ITEM_STATUS_LABEL,
  type RequestItemStatus,
} from '@/lib/requests/statuses'

describe('RequestItem status machine', () => {
  it('every status has a label', () => {
    for (const s of REQUEST_ITEM_STATUSES) {
      expect(REQUEST_ITEM_STATUS_LABEL[s]).toBeTruthy()
    }
  })

  it('isRequestItemStatus and isRequestListStatus reject noise', () => {
    expect(isRequestItemStatus('RECEIVED')).toBe(true)
    expect(isRequestItemStatus('WHATEVER')).toBe(false)
    expect(isRequestItemStatus(null)).toBe(false)
    expect(isRequestListStatus('DRAFT')).toBe(true)
    expect(isRequestListStatus('ARCHIVED')).toBe(false)
  })

  it('happy path: NOT_REQUESTED → REQUESTED → RECEIVED → ACCEPTED', () => {
    expect(canRequestItemTransition('NOT_REQUESTED', 'REQUESTED')).toBe(true)
    expect(canRequestItemTransition('REQUESTED',     'RECEIVED')).toBe(true)
    expect(canRequestItemTransition('RECEIVED',      'ACCEPTED')).toBe(true)
  })

  it('rework loop: RECEIVED → NEEDS_CLARIFICATION → RECEIVED → ACCEPTED', () => {
    expect(canRequestItemTransition('RECEIVED',            'NEEDS_CLARIFICATION')).toBe(true)
    expect(canRequestItemTransition('NEEDS_CLARIFICATION', 'RECEIVED')).toBe(true)
    expect(canRequestItemTransition('RECEIVED',            'ACCEPTED')).toBe(true)
  })

  it('reviewer may reopen: ACCEPTED → REQUESTED, ACCEPTED → NEEDS_CLARIFICATION', () => {
    expect(canRequestItemTransition('ACCEPTED', 'REQUESTED')).toBe(true)
    expect(canRequestItemTransition('ACCEPTED', 'NEEDS_CLARIFICATION')).toBe(true)
  })

  it('NOT_APPLICABLE can be reopened but not accepted directly', () => {
    expect(canRequestItemTransition('NOT_APPLICABLE', 'REQUESTED')).toBe(true)
    expect(canRequestItemTransition('NOT_APPLICABLE', 'ACCEPTED')).toBe(false)
  })

  it('forbidden transitions are rejected', () => {
    expect(canRequestItemTransition('NOT_REQUESTED',       'RECEIVED')).toBe(false)
    expect(canRequestItemTransition('NOT_REQUESTED',       'ACCEPTED')).toBe(false)
    expect(canRequestItemTransition('NEEDS_CLARIFICATION', 'REQUESTED')).toBe(false)
  })

  it('NEEDS_CLARIFICATION requires a note', () => {
    expect(requestItemTransitionRequiresNote('NEEDS_CLARIFICATION')).toBe(true)
    expect(requestItemTransitionRequiresNote('RECEIVED')).toBe(false)
    expect(requestItemTransitionRequiresNote('ACCEPTED')).toBe(false)
  })

  it('dashboard classification matches slice-12 headline copy', () => {
    // "17 / 24 received, 3 need clarification, 7 outstanding"
    expect(classifyForDashboard('RECEIVED')).toBe('received')
    expect(classifyForDashboard('ACCEPTED')).toBe('received')
    expect(classifyForDashboard('NEEDS_CLARIFICATION')).toBe('clarification')
    expect(classifyForDashboard('REQUESTED')).toBe('outstanding')
    // NOT_REQUESTED and NOT_APPLICABLE are NOT part of the visible pile.
    expect(classifyForDashboard('NOT_REQUESTED')).toBe('other')
    expect(classifyForDashboard('NOT_APPLICABLE')).toBe('other')
  })

  it('sort order places NEEDS_CLARIFICATION first (surface the ask that needs work)', () => {
    const statuses = [...REQUEST_ITEM_STATUSES].sort(
      (a, b) => REQUEST_ITEM_SORT_ORDER[a] - REQUEST_ITEM_SORT_ORDER[b],
    )
    expect(statuses[0]).toBe('NEEDS_CLARIFICATION')
    expect(statuses[1]).toBe('REQUESTED')
    // Terminal / dormant states last.
    expect(statuses[statuses.length - 1]).toBe('NOT_REQUESTED')
  })

  it('the transitions table is closed — no self-loops', () => {
    for (const from of REQUEST_ITEM_STATUSES) {
      expect(ALLOWED_REQUEST_ITEM_TRANSITIONS[from].includes(from as RequestItemStatus)).toBe(false)
    }
  })
})
