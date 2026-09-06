/**
 * The Slice-14 canonical section catalog.
 *
 * A `Report` is composed of `ReportSection` rows keyed by one of the
 * closed enum values below. The section keys, titles, required-ness,
 * and default order live here so the workbench UI, the AI narrative
 * flow, and the DOCX exporter all agree on the set.
 *
 * Adding a new section:
 *   1. Add the key to `REPORT_SECTION_KEYS`.
 *   2. Add its metadata to `SECTION_CATALOG`.
 *   3. The DOCX renderer, seed template, and readiness dashboard all
 *      pick up the new entry automatically.
 */

export const REPORT_SECTION_KEYS = [
  'ENGAGEMENT_ID',        // engagement identification
  'SUBJECT_COMPANY',      // subject company
  'PURPOSE',              // purpose of the valuation
  'INTENDED_USE',         // intended use / users
  'VALUATION_DATE',       // valuation date
  'STANDARD_OF_VALUE',    // standard of value
  'PREMISE_OF_VALUE',     // premise of value
  'COMPANY_HISTORY',      // company history
  'OWNERSHIP',            // ownership structure
  'PRODUCTS_SERVICES',    // products and services
  'CUSTOMERS',            // customer profile
  'MANAGEMENT',           // management team
  'COMPETITION',          // competitive landscape
  'ECONOMIC_OVERVIEW',    // macro-economic conditions
  'INDUSTRY_ANALYSIS',    // industry analysis
  'FINANCIAL_ANALYSIS',   // historical financials
  'NORMALIZATION',        // normalization / add-backs
  'VALUATION_APPROACHES', // methods applied
  'RECONCILIATION',       // reconciliation of approaches
  'CONCLUSION',           // concluded value
  'ASSUMPTIONS',          // material assumptions
  'LIMITING_CONDITIONS',  // limiting conditions
  'SOURCE_LIST',          // sources / citations
] as const

export type ReportSectionKey = typeof REPORT_SECTION_KEYS[number]

export function isReportSectionKey(k: unknown): k is ReportSectionKey {
  return typeof k === 'string' && (REPORT_SECTION_KEYS as readonly string[]).includes(k)
}

// ─────────────────────────────────────────────────
// Per-section metadata
// ─────────────────────────────────────────────────
// - `title`      — human label used in the DOCX + UI.
// - `isRequired` — counts toward the report-readiness percentage.
// - `guidance`   — analyst hint (shown next to the section).
// - `factScope`  — which slices of ReportFacts this section may
//   consume. The AI flow is instructed to use ONLY the scoped subset;
//   the facts extractor already excludes non-APPROVED rows.

export interface SectionCatalogEntry {
  title:      string
  isRequired: boolean
  guidance:   string
  factScope:  readonly ReportFactScope[]
}

export type ReportFactScope =
  | 'engagement'
  | 'company'
  | 'ownership'
  | 'industry'
  | 'economic'
  | 'financials'
  | 'normalization'
  | 'valuation'
  | 'reconciliation'
  | 'evidence'
  | 'assumptions'

export const SECTION_CATALOG: Record<ReportSectionKey, SectionCatalogEntry> = {
  ENGAGEMENT_ID:        { title: 'Engagement Identification', isRequired: true,
                          guidance: 'Firm, engaging party, matter reference, and engagement letter date.',
                          factScope: ['engagement'] },
  SUBJECT_COMPANY:      { title: 'Subject Company',           isRequired: true,
                          guidance: 'Legal entity name, state of formation, and business.',
                          factScope: ['engagement', 'company'] },
  PURPOSE:              { title: 'Purpose of the Valuation',  isRequired: true,
                          guidance: 'Why this valuation is being performed (litigation, transaction, tax, etc.).',
                          factScope: ['engagement'] },
  INTENDED_USE:         { title: 'Intended Use and Users',    isRequired: true,
                          guidance: 'Who may rely on this report and for what purpose.',
                          factScope: ['engagement'] },
  VALUATION_DATE:       { title: 'Valuation Date',            isRequired: true,
                          guidance: 'The as-of date of value. Must match the engagement letter.',
                          factScope: ['engagement'] },
  STANDARD_OF_VALUE:    { title: 'Standard of Value',         isRequired: true,
                          guidance: 'FMV, FV, IV, or other. Justify the choice.',
                          factScope: ['engagement'] },
  PREMISE_OF_VALUE:     { title: 'Premise of Value',          isRequired: true,
                          guidance: 'Going concern, orderly liquidation, forced liquidation.',
                          factScope: ['engagement'] },
  COMPANY_HISTORY:      { title: 'Company History',           isRequired: false,
                          guidance: 'Founding, key events, ownership transitions.',
                          factScope: ['company'] },
  OWNERSHIP:            { title: 'Ownership',                 isRequired: true,
                          guidance: 'Cap table, subject interest, controlling vs. minority.',
                          factScope: ['ownership'] },
  PRODUCTS_SERVICES:    { title: 'Products and Services',     isRequired: false,
                          guidance: 'Revenue mix by product line.',
                          factScope: ['company'] },
  CUSTOMERS:            { title: 'Customers',                 isRequired: false,
                          guidance: 'Concentration, geographic mix, top customers.',
                          factScope: ['company'] },
  MANAGEMENT:           { title: 'Management',                isRequired: false,
                          guidance: 'Key personnel and dependence on any one person.',
                          factScope: ['company'] },
  COMPETITION:          { title: 'Competition',               isRequired: false,
                          guidance: 'Competitive landscape and moats.',
                          factScope: ['industry', 'company'] },
  ECONOMIC_OVERVIEW:    { title: 'Economic Overview',         isRequired: true,
                          guidance: 'Macro conditions relevant to the valuation date.',
                          factScope: ['economic'] },
  INDUSTRY_ANALYSIS:    { title: 'Industry Analysis',         isRequired: true,
                          guidance: 'NAICS/SIC classification, trends, risks.',
                          factScope: ['industry'] },
  FINANCIAL_ANALYSIS:   { title: 'Financial Analysis',        isRequired: true,
                          guidance: 'Historical revenue, profitability, and ratios.',
                          factScope: ['financials'] },
  NORMALIZATION:        { title: 'Normalization',             isRequired: true,
                          guidance: 'Add-backs and rationalizations to derive representative earnings.',
                          factScope: ['normalization'] },
  VALUATION_APPROACHES: { title: 'Valuation Approaches',      isRequired: true,
                          guidance: 'Approaches applied, per-approach indications.',
                          factScope: ['valuation', 'assumptions'] },
  RECONCILIATION:       { title: 'Reconciliation',            isRequired: true,
                          guidance: 'Weighting and reconciliation across approaches.',
                          factScope: ['reconciliation'] },
  CONCLUSION:           { title: 'Conclusion',                isRequired: true,
                          guidance: 'The concluded value and its bounds.',
                          factScope: ['reconciliation'] },
  ASSUMPTIONS:          { title: 'Assumptions',               isRequired: true,
                          guidance: 'Approved material assumptions with source and rationale.',
                          factScope: ['assumptions'] },
  LIMITING_CONDITIONS:  { title: 'Limiting Conditions',       isRequired: true,
                          guidance: 'Standard limiting conditions and disclaimers.',
                          factScope: [] },
  SOURCE_LIST:          { title: 'Source List / Citations',   isRequired: true,
                          guidance: 'Documents, industry reports, market data references.',
                          factScope: ['evidence'] },
}

/** Ordered list — the default DOCX + UI order. */
export const DEFAULT_SECTION_ORDER: ReportSectionKey[] = [...REPORT_SECTION_KEYS]

// ─────────────────────────────────────────────────
// Section-level status machine
// ─────────────────────────────────────────────────

export const REPORT_SECTION_STATUSES = [
  'NOT_STARTED',
  'AI_DRAFTED',
  'HUMAN_EDITING',
  'READY_FOR_REVIEW',
  'APPROVED',
] as const

export type ReportSectionStatus = typeof REPORT_SECTION_STATUSES[number]

export function isReportSectionStatus(s: unknown): s is ReportSectionStatus {
  return typeof s === 'string' && (REPORT_SECTION_STATUSES as readonly string[]).includes(s)
}

/**
 * ```
 *      NOT_STARTED ─► AI_DRAFTED ─► HUMAN_EDITING ─► READY_FOR_REVIEW ─► APPROVED
 *          ▲                              ▲                                 │
 *          │                              │                                 │
 *          └──────── reset by author ─────┘                                 │
 *                              (APPROVED → HUMAN_EDITING) reopens for rework┘
 * ```
 * Reopening an APPROVED section always drops it back to
 * HUMAN_EDITING — never straight to READY_FOR_REVIEW — so the next
 * approval requires the reviewer to look at what changed.
 */
export const ALLOWED_SECTION_TRANSITIONS: Record<ReportSectionStatus, readonly ReportSectionStatus[]> = {
  NOT_STARTED:      ['AI_DRAFTED', 'HUMAN_EDITING'],
  AI_DRAFTED:       ['HUMAN_EDITING', 'READY_FOR_REVIEW', 'NOT_STARTED'],
  HUMAN_EDITING:    ['READY_FOR_REVIEW', 'NOT_STARTED', 'AI_DRAFTED'],
  READY_FOR_REVIEW: ['APPROVED', 'HUMAN_EDITING'],
  APPROVED:         ['HUMAN_EDITING'],
}

export function canSectionTransition(from: ReportSectionStatus, to: ReportSectionStatus): boolean {
  return ALLOWED_SECTION_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Sections that count toward the readiness percentage. The dashboard
 * uses `SECTION_CATALOG[key].isRequired`, but the check lives here so
 * every consumer agrees.
 */
export function isRequiredSection(key: ReportSectionKey): boolean {
  return SECTION_CATALOG[key]?.isRequired === true
}

// ─────────────────────────────────────────────────
// Report-level status
// ─────────────────────────────────────────────────

export const REPORT_STATUSES = ['DRAFT', 'UNDER_REVIEW', 'FINAL'] as const
export type ReportStatus = typeof REPORT_STATUSES[number]

export function isReportStatus(s: unknown): s is ReportStatus {
  return typeof s === 'string' && (REPORT_STATUSES as readonly string[]).includes(s)
}
