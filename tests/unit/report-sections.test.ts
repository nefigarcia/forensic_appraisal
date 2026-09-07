import { describe, it, expect } from 'vitest'
import {
  REPORT_SECTION_KEYS,
  SECTION_CATALOG,
  isReportSectionKey,
  isReportSectionStatus,
  canSectionTransition,
  ALLOWED_SECTION_TRANSITIONS,
  isRequiredSection,
  isReportStatus,
  type ReportSectionKey,
} from '@/lib/reports/sections'

describe('report section catalog', () => {
  it('covers the 23 canonical sections from the slice prompt', () => {
    // engagement identification, subject company, purpose, intended
    // use, valuation date, standard/premise of value, company
    // history, ownership, products/services, customers, management,
    // competition, economic overview, industry analysis, financial
    // analysis, normalization, valuation approaches, reconciliation,
    // conclusion, assumptions, limiting conditions, source list.
    const expected = [
      'ENGAGEMENT_ID', 'SUBJECT_COMPANY', 'PURPOSE', 'INTENDED_USE',
      'VALUATION_DATE', 'STANDARD_OF_VALUE', 'PREMISE_OF_VALUE',
      'COMPANY_HISTORY', 'OWNERSHIP', 'PRODUCTS_SERVICES',
      'CUSTOMERS', 'MANAGEMENT', 'COMPETITION',
      'ECONOMIC_OVERVIEW', 'INDUSTRY_ANALYSIS',
      'FINANCIAL_ANALYSIS', 'NORMALIZATION',
      'VALUATION_APPROACHES', 'RECONCILIATION', 'CONCLUSION',
      'ASSUMPTIONS', 'LIMITING_CONDITIONS', 'SOURCE_LIST',
    ]
    for (const k of expected) {
      expect(REPORT_SECTION_KEYS.includes(k as any)).toBe(true)
    }
    expect(REPORT_SECTION_KEYS.length).toBe(expected.length)
  })

  it('every key has metadata (title + isRequired + factScope)', () => {
    for (const k of REPORT_SECTION_KEYS) {
      const m = SECTION_CATALOG[k]
      expect(typeof m.title).toBe('string')
      expect(typeof m.isRequired).toBe('boolean')
      expect(Array.isArray(m.factScope)).toBe(true)
    }
  })

  it('type guards reject unknown values', () => {
    expect(isReportSectionKey('CONCLUSION')).toBe(true)
    expect(isReportSectionKey('WHATEVER')).toBe(false)
    expect(isReportStatus('DRAFT')).toBe(true)
    expect(isReportStatus('BOGUS')).toBe(false)
  })
})

describe('report section status machine', () => {
  it('happy path: NOT_STARTED → AI_DRAFTED → HUMAN_EDITING → READY_FOR_REVIEW → APPROVED', () => {
    expect(canSectionTransition('NOT_STARTED',      'AI_DRAFTED')).toBe(true)
    expect(canSectionTransition('AI_DRAFTED',       'HUMAN_EDITING')).toBe(true)
    expect(canSectionTransition('HUMAN_EDITING',    'READY_FOR_REVIEW')).toBe(true)
    expect(canSectionTransition('READY_FOR_REVIEW', 'APPROVED')).toBe(true)
  })

  it('reopening an APPROVED section always drops to HUMAN_EDITING (never directly to READY_FOR_REVIEW)', () => {
    expect(canSectionTransition('APPROVED', 'HUMAN_EDITING')).toBe(true)
    expect(canSectionTransition('APPROVED', 'READY_FOR_REVIEW')).toBe(false)
    expect(canSectionTransition('APPROVED', 'AI_DRAFTED')).toBe(false)
  })

  it('READY_FOR_REVIEW → HUMAN_EDITING (send back to author) is allowed', () => {
    expect(canSectionTransition('READY_FOR_REVIEW', 'HUMAN_EDITING')).toBe(true)
  })

  it('closed transition table — no self-loops', () => {
    for (const s of Object.keys(ALLOWED_SECTION_TRANSITIONS) as (keyof typeof ALLOWED_SECTION_TRANSITIONS)[]) {
      const transitions = ALLOWED_SECTION_TRANSITIONS[s]
      expect((transitions as readonly string[]).includes(s)).toBe(false)
    }
  })

  it('isReportSectionStatus rejects noise', () => {
    expect(isReportSectionStatus('APPROVED')).toBe(true)
    expect(isReportSectionStatus('YOLO')).toBe(false)
  })
})

describe('required-section subset', () => {
  it('non-required sections do not count toward readiness', () => {
    // Company history / products / customers / management / competition
    // are OPTIONAL — they can be omitted without holding up finalization.
    const nonRequired: ReportSectionKey[] = ['COMPANY_HISTORY', 'PRODUCTS_SERVICES', 'CUSTOMERS', 'MANAGEMENT', 'COMPETITION']
    for (const k of nonRequired) expect(isRequiredSection(k)).toBe(false)
  })

  it('every core professional section IS required', () => {
    const req: ReportSectionKey[] = [
      'ENGAGEMENT_ID', 'SUBJECT_COMPANY', 'PURPOSE', 'INTENDED_USE',
      'VALUATION_DATE', 'STANDARD_OF_VALUE', 'PREMISE_OF_VALUE',
      'OWNERSHIP', 'ECONOMIC_OVERVIEW', 'INDUSTRY_ANALYSIS',
      'FINANCIAL_ANALYSIS', 'NORMALIZATION', 'VALUATION_APPROACHES',
      'RECONCILIATION', 'CONCLUSION', 'ASSUMPTIONS',
      'LIMITING_CONDITIONS', 'SOURCE_LIST',
    ]
    for (const k of req) expect(isRequiredSection(k)).toBe(true)
  })
})
