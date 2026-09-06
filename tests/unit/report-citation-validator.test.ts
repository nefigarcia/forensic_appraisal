/**
 * LOAD-BEARING: post-AI citation validation.
 *
 * The AI is instructed to only cite ids present in the payload. This
 * module is the enforcement copy — a hallucinated citation (targetId
 * not in the payload) is dropped.
 */

import { describe, it, expect } from 'vitest'
import { buildFactIndex, validateCitations } from '@/lib/reports/citation-validator'
import type { ReportFactsPayload } from '@/lib/reports/facts'

const payload: Partial<ReportFactsPayload> = {
  financials: { values: [
    { id: 'fv-1', year: '2024', statementType: 'IS', lineItem: 'Revenue', value: '1000', documentId: null },
  ] },
  normalization: { approvedAddBacks: [
    { id: 'ab-1', category: 'OWNER_COMP', description: 'excess comp', year2: null, year1: '100', ttm: '110', rationale: null },
  ] },
  assumptions: { approved: [
    { id: 'as-1', key: 'wacc', label: 'WACC', category: null, value: '0.12', unit: 'RATE', source: null, rationale: null },
  ] },
  ownership: { approvedAdjustments: [
    { id: 'ow-1', kind: 'DLOM', percent: '0.20', source: null, rationale: null },
  ] },
  valuation: { scenarios: [
    { scenarioId: 'sc-1', scenarioKey: 'BASE', scenarioName: 'Base',
      enterpriseValue: '1000000', equityValue: '900000', ownershipValue: '720000',
      approaches: [], bridgeItems: [] },
  ] },
  evidence: {
    documents: [{ documentId: 'd-1', name: 'Return.pdf', currentVersionId: 'dv-1', sha256Hash: null }],
    citations: [{ id: 'ec-1', documentVersionId: 'dv-1', pageNumber: 4, sourceLabel: null, rawText: null }],
  },
}

describe('buildFactIndex', () => {
  it('records every legitimate (type,id) pair from the payload', () => {
    const idx = buildFactIndex(payload)
    expect(idx.has('FINANCIAL_VALUE:fv-1')).toBe(true)
    expect(idx.has('ADDBACK:ab-1')).toBe(true)
    expect(idx.has('VALUATION_ASSUMPTION:as-1')).toBe(true)
    expect(idx.has('OWNERSHIP_ADJUSTMENT:ow-1')).toBe(true)
    expect(idx.has('RECONCILIATION:sc-1')).toBe(true)
    expect(idx.has('DOCUMENT_VERSION:dv-1')).toBe(true)
    expect(idx.has('EVIDENCE_CITATION:ec-1')).toBe(true)
  })
})

describe('validateCitations — the anti-hallucination guard', () => {
  it('drops a citation whose targetId is not in the payload', () => {
    const r = validateCitations([
      { targetType: 'FINANCIAL_VALUE', targetId: 'fv-1' },
      { targetType: 'FINANCIAL_VALUE', targetId: 'fv-does-not-exist' },
    ], payload)
    expect(r.valid.length).toBe(1)
    expect(r.dropped.length).toBe(1)
    expect(r.dropped[0]!.targetId).toBe('fv-does-not-exist')
  })

  it('drops a citation whose targetType is unknown', () => {
    const r = validateCitations([
      { targetType: 'MADE_UP_KIND', targetId: 'fv-1' },
    ], payload)
    expect(r.valid.length).toBe(0)
    expect(r.dropped.length).toBe(1)
  })

  it('preserves the snippet when a citation is valid', () => {
    const r = validateCitations([
      { targetType: 'FINANCIAL_VALUE', targetId: 'fv-1', snippet: 'Revenue for 2024' },
    ], payload)
    expect(r.valid[0]!.snippet).toBe('Revenue for 2024')
  })

  it('empty input returns empty valid + empty dropped', () => {
    const r = validateCitations([], payload)
    expect(r.valid).toEqual([])
    expect(r.dropped).toEqual([])
  })

  it('citing an EVIDENCE_CITATION that is in the payload is accepted', () => {
    const r = validateCitations([
      { targetType: 'EVIDENCE_CITATION', targetId: 'ec-1' },
    ], payload)
    expect(r.valid.length).toBe(1)
  })

  it('citing a DOCUMENT_VERSION that is in the payload is accepted', () => {
    const r = validateCitations([
      { targetType: 'DOCUMENT_VERSION', targetId: 'dv-1' },
    ], payload)
    expect(r.valid.length).toBe(1)
  })

  it('an empty payload → all citations dropped', () => {
    const r = validateCitations([
      { targetType: 'FINANCIAL_VALUE', targetId: 'fv-1' },
      { targetType: 'ADDBACK', targetId: 'ab-1' },
    ], {})
    expect(r.valid).toEqual([])
    expect(r.dropped.length).toBe(2)
  })
})
