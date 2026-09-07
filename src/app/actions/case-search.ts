'use server'

/**
 * Slice-16 knowledge-base search server actions.
 *
 * Every action starts by resolving `authorizedCaseIds` for the caller
 * (see `resolveAuthorizedCaseIds`). The composed query is scoped to
 * those ids. A post-query defense-in-depth pass filters any leaked
 * row via `filterResultsToAuthorized` — leaked cases are logged (they
 * indicate a schema drift or bug, not a routine event).
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireSession, requireCaseAccess } from '@/lib/authz'
import { withAIExecution } from '@/lib/ai/execution'
import { planCaseSearch } from '@/ai/flows/case-search-planner-flow'
import {
  composeSearchQuery,
} from '@/lib/search/filters'
import {
  validateFilterSet, type FilterSet,
} from '@/lib/search/query-shape'
import {
  resolveAuthorizedCaseIds, filterResultsToAuthorized,
} from '@/lib/search/permissions'
import { refreshCaseSearchIndex } from '@/lib/search/index-refresh'

// ─────────────────────────────────────────────────
// Client DTO
// ─────────────────────────────────────────────────

export interface SearchResultRow {
  caseId:                  string
  caseName:                string
  clientName:              string
  engagementType:          string | null
  caseStatus:              string | null
  subjectState:            string | null
  subjectCity:             string | null
  subjectCountry:          string | null
  naicsCode:               string | null
  sicCode:                 string | null
  industryLabel:           string | null
  valuationDate:           Date | null
  reportStatus:            string | null
  reportFinalizedAt:       Date | null
  methodsApplied:          string[]
  approvedAddBackCategories: Record<string, number>
  hasRelatedPartyAddBack:  boolean
  approvedAssumptions:     Array<{ key: string; value: string | null; unit: string | null }>
  approvedDlocPercent:     string | null
  approvedDlomPercent:     string | null
  concludedEnterpriseValue: string | null
  concludedEquityValue:     string | null
  concludedOwnershipValue:  string | null
  documentCount:           number
  refreshedAt:             Date
}

export interface FactualSearchResult {
  rows:              SearchResultRow[]
  dropped:           string[]         // fields the composer discarded
  restrictedCount:   number           // # of cases the user has org access to but is engagement-gated out of
  totalAuthorized:   number
}

// ─────────────────────────────────────────────────
// Factual search
// ─────────────────────────────────────────────────

export async function searchCasesFactual(filterSet: FilterSet): Promise<FactualSearchResult> {
  const session = await requireSession()
  const validation = validateFilterSet(filterSet)
  if (!validation.ok) {
    throw new Error(`Invalid filter set: ${validation.reasons.join('; ')}`)
  }
  const auth = await resolveAuthorizedCaseIds(session)
  if (auth.authorizedCaseIds.length === 0) {
    return { rows: [], dropped: [], restrictedCount: auth.restrictedCaseIds.length, totalAuthorized: 0 }
  }

  const composed = composeSearchQuery({
    organizationId:    session.organizationId,
    authorizedCaseIds: auth.authorizedCaseIds,
    filterSet,
  })

  const rows = await prisma.caseSearchIndex.findMany({
    where:   composed.where,
    orderBy: composed.orderBy,
    take:    composed.take,
  })

  // Defense-in-depth: drop any row that somehow slipped past the
  // authorized-id filter.
  const filtered = filterResultsToAuthorized(rows, auth.authorizedCaseIds)
  if (filtered.leakedCaseIds.length > 0) {
    // Leaked ids ARE a schema drift or a bug. Log via the audit
    // trail; do not throw — the caller still gets a safe result.
    await logAction({
      userId: session.userId, action: 'UPDATE_CASE',
      targetModel: 'CaseSearchIndex',
      note: `LEAKAGE DEFENSE dropped ${filtered.leakedCaseIds.length} unauthorized rows from search`,
    })
  }

  return {
    rows:            filtered.rows.map(shapeResultRow),
    dropped:         composed.dropped,
    restrictedCount: auth.restrictedCaseIds.length,
    totalAuthorized: auth.authorizedCaseIds.length,
  }
}

// ─────────────────────────────────────────────────
// AI-planned search
// ─────────────────────────────────────────────────

export interface AiSearchResult extends FactualSearchResult {
  question:         string
  explanation:      string
  isConfident:      boolean
  fallbackReason:   string | null
  proposedFilters:  FilterSet
  runId:            string
  aiExecutionId:    string | null
}

export async function searchCasesWithAI(input: { question: string }): Promise<AiSearchResult> {
  const session = await requireSession()
  if (!input.question || input.question.trim().length === 0) {
    throw new Error('Question required')
  }

  // Run the planner. The AI never sees confidential data; its input
  // is the caller's question + the current date. Its output is a
  // structured FilterSet.
  const { output, executionId } = await withAIExecution(
    {
      session,
      flowName: 'caseSearchPlannerFlow',
    },
    { question: input.question, todayIso: new Date().toISOString() },
    planCaseSearch,
  )

  const proposedFilters: FilterSet = {
    filters: (output.filters as any) ?? [],
  }
  // Re-validate defense-in-depth. Any invalid clause is dropped by
  // the composer; the run row is stamped with what was executed.
  const validation = validateFilterSet(proposedFilters)
  const isConfident = !!output.isConfident && validation.ok

  const auth = await resolveAuthorizedCaseIds(session)

  let rows: SearchResultRow[] = []
  let dropped: string[] = []
  if (auth.authorizedCaseIds.length > 0 && validation.ok) {
    const composed = composeSearchQuery({
      organizationId:    session.organizationId,
      authorizedCaseIds: auth.authorizedCaseIds,
      filterSet:         proposedFilters,
    })
    const raw = await prisma.caseSearchIndex.findMany({
      where:   composed.where,
      orderBy: composed.orderBy,
      take:    composed.take,
    })
    dropped = composed.dropped
    const filtered = filterResultsToAuthorized(raw, auth.authorizedCaseIds)
    if (filtered.leakedCaseIds.length > 0) {
      await logAction({
        userId: session.userId, action: 'UPDATE_CASE',
        targetModel: 'CaseSearchIndex',
        note: `AI-SEARCH LEAKAGE DEFENSE dropped ${filtered.leakedCaseIds.length} unauthorized rows`,
      })
    }
    rows = filtered.rows.map(shapeResultRow)
  }

  const run = await prisma.aiCaseSearchRun.create({
    data: {
      organizationId:  session.organizationId,
      userId:          session.userId,
      question:        input.question,
      proposedFilters: proposedFilters as any,
      executedFilters: validation.ok ? proposedFilters as any : null,
      returnedCaseIds: rows.map(r => r.caseId) as any,
      aiExecutionId:   executionId,
      isConfident,
      fallbackReason:  output.fallbackReason ?? (validation.ok ? null : validation.reasons.join('; ')),
    },
  })

  return {
    rows, dropped,
    restrictedCount: auth.restrictedCaseIds.length,
    totalAuthorized: auth.authorizedCaseIds.length,
    question:        input.question,
    explanation:     output.explanation ?? '',
    isConfident,
    fallbackReason:  output.fallbackReason ?? (validation.ok ? null : validation.reasons.join('; ')),
    proposedFilters,
    runId:           run.id,
    aiExecutionId:   executionId,
  }
}

// ─────────────────────────────────────────────────
// Refresh — invoked from the case admin action
// ─────────────────────────────────────────────────

export async function refreshCaseIndex(input: { caseId: string }): Promise<{ ok: true; refreshedAt: Date }> {
  const { session } = await requireCaseAccess(input.caseId, 'case:read')
  const r = await refreshCaseSearchIndex({ caseId: input.caseId, refreshedBy: session.userId })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: input.caseId, targetModel: 'CaseSearchIndex',
    note: `refreshed search index (${r.approvedAssumptions} assumptions, ${r.approvedAddBacks} add-backs)`,
  })
  revalidatePath('/knowledge-base')
  return { ok: true, refreshedAt: r.refreshedAt }
}

// ─────────────────────────────────────────────────
// Shape helper
// ─────────────────────────────────────────────────

function shapeResultRow(row: any): SearchResultRow {
  return {
    caseId:                  row.caseId,
    caseName:                row.caseName,
    clientName:              row.clientName,
    engagementType:          row.engagementType,
    caseStatus:              row.caseStatus,
    subjectState:            row.subjectState,
    subjectCity:             row.subjectCity,
    subjectCountry:          row.subjectCountry,
    naicsCode:               row.naicsCode,
    sicCode:                 row.sicCode,
    industryLabel:           row.industryLabel,
    valuationDate:           row.valuationDate,
    reportStatus:            row.reportStatus,
    reportFinalizedAt:       row.reportFinalizedAt,
    methodsApplied:          Array.isArray(row.methodsApplied) ? row.methodsApplied : [],
    approvedAddBackCategories: (row.approvedAddBackCategories ?? {}) as Record<string, number>,
    hasRelatedPartyAddBack:  !!row.hasRelatedPartyAddBack,
    approvedAssumptions:     (Array.isArray(row.approvedAssumptions) ? row.approvedAssumptions : [])
                              .map((a: any) => ({ key: a.key, value: a.value ?? null, unit: a.unit ?? null })),
    approvedDlocPercent:     row.approvedDlocPercent?.toString() ?? null,
    approvedDlomPercent:     row.approvedDlomPercent?.toString() ?? null,
    concludedEnterpriseValue: row.concludedEnterpriseValue?.toString() ?? null,
    concludedEquityValue:     row.concludedEquityValue?.toString() ?? null,
    concludedOwnershipValue:  row.concludedOwnershipValue?.toString() ?? null,
    documentCount:           row.documentCount,
    refreshedAt:             row.refreshedAt,
  }
}
