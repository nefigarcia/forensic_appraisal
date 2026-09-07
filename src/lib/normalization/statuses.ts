/**
 * Normalization-adjustment status machine.
 *
 *      DRAFT  ─┐          ┌── NEEDS_SUPPORT ──┐
 *              ├──►  PROPOSED  ◄──────────────┤
 *              │        │                    │
 *              │        ├── APPROVED         │
 *              │        └── REJECTED  ──► DRAFT (reviewer sends back)
 *              │
 *              └── (never reached from APPROVED / REJECTED unless the
 *                   reviewer explicitly sends it back)
 *
 * Rules enforced in code (not in the DB):
 *   - You cannot transition from APPROVED to REJECTED without an
 *     explicit reviewer step; that's REJECTED → DRAFT to signal rework.
 *   - You cannot delete an APPROVED adjustment (the schema doesn't
 *     enforce it either — the server action refuses).
 *
 * Reviewer-queue definition: PROPOSED or NEEDS_SUPPORT.
 */

export const ADJUSTMENT_STATUSES = [
  'DRAFT',
  'PROPOSED',
  'NEEDS_SUPPORT',
  'APPROVED',
  'REJECTED',
] as const

export type AdjustmentStatus = typeof ADJUSTMENT_STATUSES[number]

export const STATUS_LABEL: Record<AdjustmentStatus, string> = {
  DRAFT:         'Draft',
  PROPOSED:      'Proposed',
  NEEDS_SUPPORT: 'Needs support',
  APPROVED:      'Approved',
  REJECTED:      'Rejected',
}

/**
 * Allowed transitions. This is deliberately conservative — a reviewer
 * who wants to undo an approval sends the row back to DRAFT and the
 * proposer re-submits. No silent APPROVED → REJECTED.
 */
export const ALLOWED_TRANSITIONS: Record<AdjustmentStatus, AdjustmentStatus[]> = {
  DRAFT:         ['PROPOSED'],
  PROPOSED:      ['APPROVED', 'REJECTED', 'NEEDS_SUPPORT', 'DRAFT'],
  NEEDS_SUPPORT: ['PROPOSED', 'DRAFT'],
  APPROVED:      ['DRAFT'],
  REJECTED:      ['DRAFT'],
}

export function canTransition(from: AdjustmentStatus, to: AdjustmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/** True iff a status counts as an unresolved reviewer-queue item. */
export function isReviewerQueueStatus(s: string): s is 'PROPOSED' | 'NEEDS_SUPPORT' {
  return s === 'PROPOSED' || s === 'NEEDS_SUPPORT'
}

/** Sort order for the dashboard: pending review first, approved / rejected
 *  last. Matches the never-hide discipline from Slice 9 — items awaiting
 *  action are not buried below completed work. */
export const DASHBOARD_STATUS_ORDER: Record<AdjustmentStatus, number> = {
  NEEDS_SUPPORT: 0,
  PROPOSED:      1,
  DRAFT:         2,
  REJECTED:      3,
  APPROVED:      4,
}

/** REJECTED requires a reason; APPROVED doesn't (the audit trail records
 *  the reviewer + timestamp; further prose is optional). */
export function transitionRequiresReason(next: AdjustmentStatus): boolean {
  return next === 'REJECTED' || next === 'NEEDS_SUPPORT'
}
