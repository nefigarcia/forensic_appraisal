/**
 * Post-AI citation validator.
 *
 * The AI is instructed to only cite ids that exist in the payload it
 * received. This module is the defense-in-depth guard: it inspects the
 * flow's returned citations and drops any whose (targetType, targetId)
 * is not in the fact index built from the scoped payload.
 *
 * Dropped citations are surfaced back to the caller so the reviewer
 * sees "the AI tried to cite X but X wasn't in the payload".
 */

import type { ReportFactsPayload } from './facts'

export type CitationTargetType =
  | 'FINANCIAL_VALUE'
  | 'ADDBACK'
  | 'VALUATION_ASSUMPTION'
  | 'OWNERSHIP_ADJUSTMENT'
  | 'RECONCILIATION'
  | 'DOCUMENT_VERSION'
  | 'EVIDENCE_CITATION'
  | 'REQUEST_ITEM'
  | 'TIE_OUT'

export interface CandidateCitation {
  targetType: CitationTargetType | string
  targetId:   string
  snippet?:   string
}

export interface ValidCitation extends CandidateCitation {
  targetType: CitationTargetType
}

export interface ValidatorResult {
  valid:      ValidCitation[]
  dropped:    CandidateCitation[]     // rejected — not in the payload
}

/**
 * Build the "legitimate ids" index from the payload. The AI receives
 * the same index in its prompt (see the flow); this is the enforcement
 * copy.
 */
export function buildFactIndex(scoped: Partial<ReportFactsPayload>): Set<string> {
  const idx = new Set<string>()
  const put = (t: CitationTargetType, id: string) => idx.add(`${t}:${id}`)

  scoped.financials?.values.forEach(v => put('FINANCIAL_VALUE', v.id))
  scoped.normalization?.approvedAddBacks.forEach(a => put('ADDBACK', a.id))
  scoped.assumptions?.approved.forEach(a => put('VALUATION_ASSUMPTION', a.id))
  scoped.ownership?.approvedAdjustments.forEach(o => put('OWNERSHIP_ADJUSTMENT', o.id))
  scoped.valuation?.scenarios.forEach(s => put('RECONCILIATION', s.scenarioId))
  scoped.evidence?.documents.forEach(d => {
    if (d.currentVersionId) put('DOCUMENT_VERSION', d.currentVersionId)
  })
  scoped.evidence?.citations.forEach(c => put('EVIDENCE_CITATION', c.id))
  return idx
}

const KNOWN_TYPES = new Set<CitationTargetType>([
  'FINANCIAL_VALUE', 'ADDBACK', 'VALUATION_ASSUMPTION',
  'OWNERSHIP_ADJUSTMENT', 'RECONCILIATION', 'DOCUMENT_VERSION',
  'EVIDENCE_CITATION', 'REQUEST_ITEM', 'TIE_OUT',
])

/**
 * Filter a set of candidate citations against the scoped payload. A
 * citation is dropped if:
 *   - the targetType is not one of the known kinds, or
 *   - the (targetType, targetId) pair isn't in the payload index.
 */
export function validateCitations(
  candidates: CandidateCitation[],
  scoped: Partial<ReportFactsPayload>,
): ValidatorResult {
  const idx = buildFactIndex(scoped)
  const valid: ValidCitation[] = []
  const dropped: CandidateCitation[] = []
  for (const c of candidates) {
    if (!KNOWN_TYPES.has(c.targetType as CitationTargetType)) {
      dropped.push(c); continue
    }
    if (!idx.has(`${c.targetType}:${c.targetId}`)) {
      dropped.push(c); continue
    }
    valid.push({ ...c, targetType: c.targetType as CitationTargetType })
  }
  return { valid, dropped }
}
