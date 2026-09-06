/**
 * ReviewItem status machine.
 *
 *   DRAFT ──► READY_FOR_REVIEW ──► APPROVED
 *                     │
 *                     ├── CHANGES_REQUESTED ──► READY_FOR_REVIEW
 *                     └── DRAFT (author sends back to themselves)
 *
 * APPROVED can be reopened to READY_FOR_REVIEW (reviewer changes their
 * mind) but never silently jumps back to CHANGES_REQUESTED. The
 * DRAFT state is only reachable during the initial submission cycle;
 * once a review item has been APPROVED, DRAFT is not an option.
 *
 * Reviewer-queue rows are READY_FOR_REVIEW.
 */

export const REVIEW_STATUSES = [
  'DRAFT',
  'READY_FOR_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
] as const

export type ReviewStatus = typeof REVIEW_STATUSES[number]

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  DRAFT:              'Draft',
  READY_FOR_REVIEW:   'Ready for review',
  CHANGES_REQUESTED:  'Changes requested',
  APPROVED:           'Approved',
}

export const ALLOWED_REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  DRAFT:             ['READY_FOR_REVIEW'],
  READY_FOR_REVIEW:  ['APPROVED', 'CHANGES_REQUESTED', 'DRAFT'],
  CHANGES_REQUESTED: ['READY_FOR_REVIEW', 'DRAFT'],
  APPROVED:          ['READY_FOR_REVIEW'],
}

export function canReviewTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  return ALLOWED_REVIEW_TRANSITIONS[from]?.includes(to) ?? false
}

/** Reviewer-queue eligibility: only READY_FOR_REVIEW is on the queue. */
export function isReviewerQueueStatus(s: string): s is 'READY_FOR_REVIEW' {
  return s === 'READY_FOR_REVIEW'
}

/** Dashboard sort — items awaiting action come first. */
export const REVIEW_STATUS_ORDER: Record<ReviewStatus, number> = {
  READY_FOR_REVIEW:  0,
  CHANGES_REQUESTED: 1,
  DRAFT:             2,
  APPROVED:          3,
}

export function transitionRequiresNote(next: ReviewStatus): boolean {
  return next === 'CHANGES_REQUESTED'
}
