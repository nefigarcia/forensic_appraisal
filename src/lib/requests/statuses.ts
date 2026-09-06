/**
 * RequestItem status machine.
 *
 * ```
 *           ┌────────────────────────────────────┐
 *           │            NOT_REQUESTED           │  ← initial (list is DRAFT)
 *           └───────────────┬────────────────────┘
 *                           │  markRequested (list SENT)
 *                           ▼
 *           ┌────────────────────────────────────┐
 *           │             REQUESTED              │
 *           └───────┬───────────────────────┬────┘
 *                   │                       │
 *   client uploads  │                       │  reviewer marks N/A
 *                   ▼                       │
 *           ┌────────────────┐               │
 *           │    RECEIVED    │◄──────────────┼── portal uploads
 *           └───────┬────────┘               │
 *                   │                       │
 *   reviewer flags  │       reviewer        │
 *  NEEDS_CLARIF     │        approves       │
 *                   ▼                       ▼
 *      ┌──────────────────────┐   ┌────────────────┐
 *      │ NEEDS_CLARIFICATION  │   │   NOT_APPLIC   │
 *      └──────────┬───────────┘   └────────────────┘
 *                 │  client re-uploads
 *                 ▼
 *           ┌────────────────┐
 *           │    RECEIVED    │
 *           └────────┬───────┘
 *                    │
 *                    ▼
 *           ┌────────────────┐
 *           │    ACCEPTED    │  ← terminal (reviewer sign-off)
 *           └────────────────┘
 * ```
 *
 * `ACCEPTED` and `NOT_APPLICABLE` are terminal from the client's
 * perspective — the portal hides them from the "outstanding" pile.
 * Firm reviewers can still reopen (transitioning back to REQUESTED /
 * NEEDS_CLARIFICATION) — reopening is intentional so a late-discovered
 * discrepancy can be re-worked without duplicating the item.
 */

export const REQUEST_ITEM_STATUSES = [
  'NOT_REQUESTED',
  'REQUESTED',
  'RECEIVED',
  'NEEDS_CLARIFICATION',
  'ACCEPTED',
  'NOT_APPLICABLE',
] as const

export type RequestItemStatus = typeof REQUEST_ITEM_STATUSES[number]

export function isRequestItemStatus(s: unknown): s is RequestItemStatus {
  return typeof s === 'string' && (REQUEST_ITEM_STATUSES as readonly string[]).includes(s)
}

/**
 * ALLOWED_TRANSITIONS is *closed* — anything not listed is refused.
 * Reviewer-driven reopens are explicit edges (ACCEPTED → REQUESTED,
 * ACCEPTED → NEEDS_CLARIFICATION).
 */
export const ALLOWED_REQUEST_ITEM_TRANSITIONS: Record<RequestItemStatus, ReadonlyArray<RequestItemStatus>> = {
  NOT_REQUESTED:       ['REQUESTED', 'NOT_APPLICABLE'],
  REQUESTED:           ['RECEIVED', 'NEEDS_CLARIFICATION', 'NOT_APPLICABLE', 'ACCEPTED'],
  RECEIVED:            ['NEEDS_CLARIFICATION', 'ACCEPTED', 'NOT_APPLICABLE', 'REQUESTED'],
  NEEDS_CLARIFICATION: ['RECEIVED', 'ACCEPTED', 'NOT_APPLICABLE'],
  ACCEPTED:            ['REQUESTED', 'NEEDS_CLARIFICATION'],
  NOT_APPLICABLE:      ['REQUESTED'],
}

export function canRequestItemTransition(
  from: RequestItemStatus,
  to:   RequestItemStatus,
): boolean {
  return ALLOWED_REQUEST_ITEM_TRANSITIONS[from]?.includes(to) ?? false
}

/** Transitions that require a note (stored in `clarificationNote`). */
export function requestItemTransitionRequiresNote(to: RequestItemStatus): boolean {
  return to === 'NEEDS_CLARIFICATION'
}

/**
 * Dashboard buckets. The header shows three headline counts:
 *   received     — RECEIVED or ACCEPTED (i.e. we have the file)
 *   clarification — NEEDS_CLARIFICATION
 *   outstanding  — REQUESTED (still awaiting a first upload)
 * NOT_REQUESTED and NOT_APPLICABLE do NOT count toward the visible
 * totals: NOT_REQUESTED is still being drafted; NOT_APPLICABLE was
 * explicitly deemed irrelevant.
 */
export function classifyForDashboard(status: RequestItemStatus): 'received' | 'clarification' | 'outstanding' | 'other' {
  if (status === 'RECEIVED' || status === 'ACCEPTED') return 'received'
  if (status === 'NEEDS_CLARIFICATION') return 'clarification'
  if (status === 'REQUESTED') return 'outstanding'
  return 'other'
}

/** Sort order — outstanding-first, so anything the client owes surfaces up top. */
export const REQUEST_ITEM_SORT_ORDER: Record<RequestItemStatus, number> = {
  NEEDS_CLARIFICATION: 0,
  REQUESTED:           1,
  RECEIVED:            2,
  ACCEPTED:            3,
  NOT_APPLICABLE:      4,
  NOT_REQUESTED:       5,
}

// Human-facing labels — used by the UI and the portal so wording stays
// consistent between the analyst view and the client view.
export const REQUEST_ITEM_STATUS_LABEL: Record<RequestItemStatus, string> = {
  NOT_REQUESTED:       'Not yet requested',
  REQUESTED:           'Requested',
  RECEIVED:            'Received',
  NEEDS_CLARIFICATION: 'Needs clarification',
  ACCEPTED:            'Accepted',
  NOT_APPLICABLE:      'Not applicable',
}

// ─────────────────────────────────────────────────
// RequestList status
// ─────────────────────────────────────────────────

export const REQUEST_LIST_STATUSES = ['DRAFT', 'SENT', 'CLOSED'] as const
export type RequestListStatus = typeof REQUEST_LIST_STATUSES[number]

export function isRequestListStatus(s: unknown): s is RequestListStatus {
  return typeof s === 'string' && (REQUEST_LIST_STATUSES as readonly string[]).includes(s)
}
