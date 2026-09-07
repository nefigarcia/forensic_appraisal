/**
 * Assumption and ownership-adjustment status machine.
 *
 * ```
 *      DRAFT ──► PROPOSED ──► APPROVED
 *                    │
 *                    ├── REJECTED ──► DRAFT   (author rework)
 *                    └── DRAFT               (author withdraws)
 *      APPROVED ──► SUPERSEDED               (a newer row replaces this)
 *      REJECTED ──► DRAFT                    (author rework)
 * ```
 *
 * `SUPERSEDED` is terminal — the row is retained for audit but the
 * reconciliation math ignores it. A new APPROVED row supersedes any
 * older APPROVED row with the same `(engagementId, key)` — the
 * transition is written by `supersedeOlderApproved` in
 * `src/app/actions/valuation-assumptions.ts`.
 *
 * The math library only ever consumes `APPROVED` rows. A DRAFT preview
 * exists (see `valuation-v2/preview.ts`) but is deliberately isolated
 * from the persisted reconciliation output.
 */

export const ASSUMPTION_STATUSES = [
  'DRAFT',
  'PROPOSED',
  'APPROVED',
  'REJECTED',
  'SUPERSEDED',
] as const

export type AssumptionStatus = typeof ASSUMPTION_STATUSES[number]

export function isAssumptionStatus(s: unknown): s is AssumptionStatus {
  return typeof s === 'string' && (ASSUMPTION_STATUSES as readonly string[]).includes(s)
}

export const ALLOWED_ASSUMPTION_TRANSITIONS: Record<AssumptionStatus, ReadonlyArray<AssumptionStatus>> = {
  DRAFT:      ['PROPOSED'],
  PROPOSED:   ['APPROVED', 'REJECTED', 'DRAFT'],
  APPROVED:   ['SUPERSEDED'],
  REJECTED:   ['DRAFT'],
  SUPERSEDED: [],
}

export function canAssumptionTransition(from: AssumptionStatus, to: AssumptionStatus): boolean {
  return ALLOWED_ASSUMPTION_TRANSITIONS[from]?.includes(to) ?? false
}

export function assumptionTransitionRequiresNote(to: AssumptionStatus): boolean {
  // REJECTED requires a rejection note. Everything else is optional.
  return to === 'REJECTED'
}

/**
 * Only APPROVED assumptions feed the persisted reconciliation math.
 * This helper is the single authoritative filter — every call site
 * uses it, so a change in policy is one edit.
 */
export function isEffectiveAssumption(status: AssumptionStatus): boolean {
  return status === 'APPROVED'
}

export const ASSUMPTION_STATUS_LABEL: Record<AssumptionStatus, string> = {
  DRAFT:      'Draft',
  PROPOSED:   'Proposed',
  APPROVED:   'Approved',
  REJECTED:   'Rejected',
  SUPERSEDED: 'Superseded',
}

// ─────────────────────────────────────────────────
// Approach kinds
// ─────────────────────────────────────────────────

export const APPROACH_KINDS = [
  'INCOME_CAP_EARNINGS',
  'INCOME_DCF',
  'MARKET_GPCM',
  'MARKET_TRANSACTIONS',
  'ASSET',
] as const

export type ApproachKind = typeof APPROACH_KINDS[number]

export function isApproachKind(k: unknown): k is ApproachKind {
  return typeof k === 'string' && (APPROACH_KINDS as readonly string[]).includes(k)
}

export const APPROACH_LABEL: Record<ApproachKind, string> = {
  INCOME_CAP_EARNINGS:  'Income — Capitalization of Earnings',
  INCOME_DCF:           'Income — Discounted Cash Flow',
  MARKET_GPCM:          'Market — Guideline Public Companies',
  MARKET_TRANSACTIONS:  'Market — Guideline Transactions',
  ASSET:                'Asset — Adjusted Net Assets',
}

// ─────────────────────────────────────────────────
// Ownership adjustment kinds
// ─────────────────────────────────────────────────

export const OWNERSHIP_ADJUSTMENT_KINDS = [
  'DLOC',         // Discount for Lack of Control (minority interest)
  'DLOM',         // Discount for Lack of Marketability
  'KEY_PERSON',   // Key-person discount
  'OTHER',
] as const

export type OwnershipAdjustmentKind = typeof OWNERSHIP_ADJUSTMENT_KINDS[number]

export function isOwnershipAdjustmentKind(k: unknown): k is OwnershipAdjustmentKind {
  return typeof k === 'string' && (OWNERSHIP_ADJUSTMENT_KINDS as readonly string[]).includes(k)
}

export const OWNERSHIP_KIND_LABEL: Record<OwnershipAdjustmentKind, string> = {
  DLOC:       'Discount for Lack of Control (DLOC)',
  DLOM:       'Discount for Lack of Marketability (DLOM)',
  KEY_PERSON: 'Key-Person Discount',
  OTHER:      'Other ownership-level adjustment',
}

// ─────────────────────────────────────────────────
// Equity-bridge categories
// ─────────────────────────────────────────────────

export const BRIDGE_CATEGORIES = [
  'CASH',              // +
  'DEBT',              // −
  'DEBT_LIKE',         // −
  'NON_OPERATING',     // ±
  'PREFERRED_EQUITY',  // −
  'NCI',               // −
  'OTHER',             // ±
] as const

export type BridgeCategory = typeof BRIDGE_CATEGORIES[number]

export function isBridgeCategory(k: unknown): k is BridgeCategory {
  return typeof k === 'string' && (BRIDGE_CATEGORIES as readonly string[]).includes(k)
}

/**
 * The *conventional* sign for a bridge category — cash is a positive
 * contribution to equity, debt is a negative contribution. The
 * `EquityBridgeItem.amount` column is stored signed; callers who omit
 * a sign can be normalized with `orientAmount(category, |amount|)`.
 */
export function orientAmount(category: BridgeCategory, magnitude: number): number {
  if (category === 'CASH')             return  magnitude
  if (category === 'DEBT')             return -magnitude
  if (category === 'DEBT_LIKE')        return -magnitude
  if (category === 'PREFERRED_EQUITY') return -magnitude
  if (category === 'NCI')              return -magnitude
  // NON_OPERATING and OTHER preserve caller's sign as-is.
  return magnitude
}

// ─────────────────────────────────────────────────
// Engagement status
// ─────────────────────────────────────────────────

export const ENGAGEMENT_STATUSES = ['DRAFT', 'UNDER_REVIEW', 'FINAL'] as const
export type EngagementStatus = typeof ENGAGEMENT_STATUSES[number]

export function isEngagementStatus(s: unknown): s is EngagementStatus {
  return typeof s === 'string' && (ENGAGEMENT_STATUSES as readonly string[]).includes(s)
}
