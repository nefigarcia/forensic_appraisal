/**
 * Standards-oriented checklist presets.
 *
 * IMPORTANT: These are professional aids only. The application does
 * NOT represent that use of these checklists certifies compliance
 * with AICPA SSVS, ASA BVS, NACVA, or any other standard. The
 * disclaimer text is surfaced on every checklist UI and included as
 * a header row when a checklist is attached to a report.
 *
 * The presets live in code so they version with the app. Firms can
 * clone a preset into an org-owned `StandardsChecklist` and edit
 * freely — the clone is detached from the preset.
 */

export type StandardsFamily = 'AICPA' | 'ASA' | 'NACVA' | 'CUSTOM'

export const STANDARDS_FAMILIES: readonly StandardsFamily[] = ['AICPA', 'ASA', 'NACVA', 'CUSTOM']

export function isStandardsFamily(k: unknown): k is StandardsFamily {
  return typeof k === 'string' && STANDARDS_FAMILIES.includes(k as StandardsFamily)
}

export interface SeedChecklistItem {
  key:       string      // stable machine key (e.g. 'aicpa.ssvs.100')
  title:     string
  guidance?: string
}

export interface SeedChecklist {
  key:            string
  standardsFamily: StandardsFamily
  name:           string
  description:    string
  items:          readonly SeedChecklistItem[]
}

/**
 * Prominent, non-negotiable disclaimer text. Rendered above every
 * checklist. Both the UI copy and the DOCX exporter include this.
 */
export const CHECKLIST_DISCLAIMER =
  'This checklist is a professional aid. Use of this checklist does not, by ' +
  'itself, constitute compliance with AICPA SSVS, ASA BVS, NACVA Professional ' +
  'Standards, USPAP, or any other professional standard. The user remains ' +
  'solely responsible for determining whether the report and its supporting ' +
  'documentation meet the applicable standards.'

// ─────────────────────────────────────────────────
// Seeded presets
// ─────────────────────────────────────────────────

export const SEED_CHECKLISTS: readonly SeedChecklist[] = [
  {
    key:            'aicpa-ssvs-summary',
    standardsFamily: 'AICPA',
    name:           'AICPA SSVS — summary reminders',
    description:    'Reminders drawn from AICPA SSVS. Not a substitute for reading the standard.',
    items: [
      { key: 'aicpa.ssvs.identify-client-users',     title: 'Identify the client and intended users' },
      { key: 'aicpa.ssvs.subject-interest',          title: 'Identify the subject business interest and the interest to be valued' },
      { key: 'aicpa.ssvs.valuation-date',            title: 'Identify the valuation date' },
      { key: 'aicpa.ssvs.purpose-and-use',           title: 'Identify the purpose of the valuation and the intended use of the report' },
      { key: 'aicpa.ssvs.standard-and-premise',      title: 'Identify the standard and premise of value' },
      { key: 'aicpa.ssvs.type-of-report',            title: 'Identify the type of report (Detailed / Summary / Calculation)' },
      { key: 'aicpa.ssvs.scope-limitations',         title: 'Disclose any restrictions or limitations on the scope of work' },
      { key: 'aicpa.ssvs.hypothetical-conditions',   title: 'Identify hypothetical conditions or assumptions and their effect' },
      { key: 'aicpa.ssvs.approaches-considered',     title: 'Describe valuation approaches considered and, if excluded, why' },
      { key: 'aicpa.ssvs.reconciliation',            title: 'Explain the reconciliation of value indications' },
      { key: 'aicpa.ssvs.representation',            title: 'Include the required representation of the valuation analyst' },
    ],
  },
  {
    key:            'asa-bvs-summary',
    standardsFamily: 'ASA',
    name:           'ASA BVS — summary reminders',
    description:    'Reminders drawn from ASA Business Valuation Standards. Not a substitute for reading the standard.',
    items: [
      { key: 'asa.bvs1.definition-of-assignment',     title: 'Definition of assignment: interest, standard, premise, purpose' },
      { key: 'asa.bvs1.effective-date',               title: 'Effective date and report date' },
      { key: 'asa.bvs1.limiting-conditions',          title: 'Assumptions and limiting conditions' },
      { key: 'asa.bvs2.financial-statement-analysis', title: 'Historical financial statement analysis' },
      { key: 'asa.bvs2.normalization-adjustments',    title: 'Normalization adjustments' },
      { key: 'asa.bvs3.income-approach',              title: 'Income approach: methods considered and applied' },
      { key: 'asa.bvs4.market-approach',              title: 'Market approach: comparables and multiples applied' },
      { key: 'asa.bvs5.asset-approach',               title: 'Asset approach: assets and liabilities considered' },
      { key: 'asa.bvs6.reconciliation',               title: 'Reconciliation of value conclusions' },
      { key: 'asa.bvs7.appraiser-representation',     title: 'Appraiser representation and certification' },
    ],
  },
  {
    key:            'nacva-summary',
    standardsFamily: 'NACVA',
    name:           'NACVA — summary reminders',
    description:    'Reminders drawn from NACVA Professional Standards. Not a substitute for reading the standard.',
    items: [
      { key: 'nacva.engagement-standards',      title: 'General and ethical standards (competence, integrity, objectivity)' },
      { key: 'nacva.scope-limitations',         title: 'Disclosure of any scope limitations' },
      { key: 'nacva.subsequent-events',         title: 'Consideration of subsequent events' },
      { key: 'nacva.subject-interest',          title: 'Description of the subject interest and rights conveyed' },
      { key: 'nacva.approaches',                title: 'Description of approaches considered and applied' },
      { key: 'nacva.discounts-premia',          title: 'Discounts and premiums considered, applied, and supported' },
      { key: 'nacva.reconciliation-conclusion', title: 'Reconciliation and value conclusion' },
      { key: 'nacva.signature-representation',  title: 'Signed representation of the valuation analyst' },
    ],
  },
]

export function findSeedChecklist(key: string): SeedChecklist | undefined {
  return SEED_CHECKLISTS.find(c => c.key === key)
}

// ─────────────────────────────────────────────────
// Per-report checklist item status
// ─────────────────────────────────────────────────

export const CHECKLIST_ITEM_STATUSES = [
  'PENDING',       // reviewer has not judged
  'ADDRESSED',     // reviewer confirms satisfied
  'NOT_APPLIC',    // reviewer marked N/A
  'AT_RISK',       // reviewer flagged unresolved
] as const

export type ChecklistItemStatus = typeof CHECKLIST_ITEM_STATUSES[number]

export function isChecklistItemStatus(k: unknown): k is ChecklistItemStatus {
  return typeof k === 'string' && (CHECKLIST_ITEM_STATUSES as readonly string[]).includes(k)
}

export const CHECKLIST_STATUS_LABEL: Record<ChecklistItemStatus, string> = {
  PENDING:    'Pending',
  ADDRESSED:  'Addressed',
  NOT_APPLIC: 'Not applicable',
  AT_RISK:    'At risk',
}
