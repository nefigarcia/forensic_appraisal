/**
 * Report-readiness math.
 *
 *   readiness = APPROVED-required-sections / TOTAL-required-sections
 *
 * Also surfaces a per-section state ("stale" when the section body's
 * factsHash no longer matches the current facts) so the reviewer can
 * see what changed under the report.
 */

import { SECTION_CATALOG, isRequiredSection, type ReportSectionKey } from './sections'

export interface SectionReadinessInput {
  key:              string
  status:           string
  currentFactsHash: string | null
  currentBody:      string | null
}

export interface SectionReadinessRow {
  key:            ReportSectionKey
  title:          string
  isRequired:     boolean
  status:         string
  isStale:        boolean       // body was drafted against a different factsHash
  hasBody:        boolean
}

export interface ReadinessSummary {
  requiredTotal:      number
  requiredApproved:   number
  requiredStale:      number
  optionalTotal:      number
  optionalApproved:   number
  readinessPercent:   number    // 0..100 — required only
  atRiskChecklistItems: number  // filled by caller from ReportChecklistItem
  pendingChecklistItems: number
  isFinalReady:       boolean   // every required section approved AND not stale
  rows:               SectionReadinessRow[]
}

export function computeReadiness(
  sections: SectionReadinessInput[],
  currentFactsHash: string | null,
  checklistCounts: { atRisk: number; pending: number } = { atRisk: 0, pending: 0 },
): ReadinessSummary {
  const rows: SectionReadinessRow[] = []
  let requiredTotal = 0, requiredApproved = 0, requiredStale = 0
  let optionalTotal = 0, optionalApproved = 0

  for (const key of Object.keys(SECTION_CATALOG) as ReportSectionKey[]) {
    const meta = SECTION_CATALOG[key]
    const persisted = sections.find(s => s.key === key)
    const status = persisted?.status ?? 'NOT_STARTED'
    const isStale = !!persisted?.currentFactsHash
      && !!currentFactsHash
      && persisted.currentFactsHash !== currentFactsHash
    const hasBody = !!persisted?.currentBody && persisted.currentBody.trim().length > 0

    if (meta.isRequired) {
      requiredTotal++
      if (status === 'APPROVED') {
        if (isStale) requiredStale++
        else requiredApproved++
      }
    } else {
      optionalTotal++
      if (status === 'APPROVED') optionalApproved++
    }

    rows.push({
      key, title: meta.title, isRequired: meta.isRequired,
      status, isStale, hasBody,
    })
  }

  const readinessPercent = requiredTotal > 0
    ? Math.round((requiredApproved / requiredTotal) * 100)
    : 0

  return {
    requiredTotal,
    requiredApproved,
    requiredStale,
    optionalTotal,
    optionalApproved,
    readinessPercent,
    atRiskChecklistItems:  checklistCounts.atRisk,
    pendingChecklistItems: checklistCounts.pending,
    isFinalReady: requiredTotal > 0
      && requiredApproved === requiredTotal
      && requiredStale === 0
      && checklistCounts.atRisk === 0,
    rows,
  }
}

/** Convenience — is this section stale against the current facts? */
export function isSectionStale(
  sectionCurrentHash: string | null | undefined,
  currentFactsHash: string | null | undefined,
): boolean {
  if (!sectionCurrentHash) return false     // never drafted → not "stale"
  if (!currentFactsHash) return false
  return sectionCurrentHash !== currentFactsHash
}

/** Filter helper — the required-section subset by key. */
export function requiredSectionKeys(): ReportSectionKey[] {
  return (Object.keys(SECTION_CATALOG) as ReportSectionKey[]).filter(isRequiredSection)
}
