/**
 * Refresh a case's row in `CaseSearchIndex`.
 *
 * The refresh function aggregates ONLY approved facts across the
 * earlier slices — same filter policy as `buildReportFacts` in
 * Slice 14. If a case has no APPROVED assumptions / add-backs, those
 * fields land empty in the index; the search never surfaces a
 * proposed or draft value across the firm.
 *
 * Called on-demand from `refreshCaseSearchIndex` action after any of:
 *   - engagement finalization
 *   - report finalization
 *   - assumption / DLOC / DLOM approval
 *   - add-back approval
 *   - Case geography edits
 *
 * Existing indexes for other cases are untouched.
 */

import { prisma } from '@/lib/prisma'

export interface RefreshIndexResult {
  caseId:            string
  organizationId:    string
  methodsApplied:    string[]
  approvedAssumptions: number
  approvedAddBacks:  number
  hasRelatedParty:   boolean
  approvedDlomPct:   string | null
  approvedDlocPct:   string | null
  refreshedAt:       Date
}

const RELATED_PARTY_ADDBACK_CATEGORIES = new Set([
  'RELATED_PARTY',      // Slice-0 add-back category (if introduced)
  'RENT_ADJUSTMENT',    // Slice-0 category — related-party rent
])

export async function refreshCaseSearchIndex(input: {
  caseId:    string
  refreshedBy?: string
}): Promise<RefreshIndexResult> {
  const c = await prisma.case.findUnique({
    where: { id: input.caseId },
    include: {
      industry: true,
      report:   { select: { status: true, finalizedAt: true } },
      valuationEngagement: {
        include: {
          scenarios: {
            include: {
              approaches:     { select: { kind: true, isIncluded: true } },
              reconciliation: true,
            },
          },
          assumptions:          { where: { status: 'APPROVED' } },
          ownershipAdjustments: { where: { status: 'APPROVED' } },
        },
      },
      addBacks: { where: { status: 'APPROVED' } },
      documents: { select: { type: true, isArchived: true } },
    },
  })
  if (!c) throw new Error(`Case ${input.caseId} not found`)

  const methodsApplied = collectMethodsApplied(c.valuationEngagement?.scenarios ?? [])
  const approvedAddBackCategories: Record<string, number> = {}
  let hasRelatedParty = false
  for (const a of c.addBacks) {
    approvedAddBackCategories[a.category] = (approvedAddBackCategories[a.category] ?? 0) + 1
    if (RELATED_PARTY_ADDBACK_CATEGORIES.has(a.category)) hasRelatedParty = true
  }

  const approvedAssumptions = (c.valuationEngagement?.assumptions ?? []).map(a => ({
    key:      a.key,
    category: a.category,
    value:    a.valueString ?? a.valueNumeric?.toString() ?? null,
    unit:     a.unit,
  }))

  // Ownership discounts — pick the APPROVED row per kind (there is
  // only one approved per kind at a time, per Slice-13 supersession).
  const ownershipByKind: Record<string, string> = {}
  for (const o of c.valuationEngagement?.ownershipAdjustments ?? []) {
    ownershipByKind[o.kind] = o.percent.toString()
  }
  const approvedDlomPct = ownershipByKind['DLOM'] ?? null
  const approvedDlocPct = ownershipByKind['DLOC'] ?? null

  // Concluded values — pick the largest equity-value scenario whose
  // reconciliation is non-blocking. Callers who need per-scenario
  // detail can drill into the ValuationEngagement directly.
  let concludedEnterprise: string | null = null
  let concludedEquity:     string | null = null
  let concludedOwnership:  string | null = null
  for (const s of c.valuationEngagement?.scenarios ?? []) {
    const rec = s.reconciliation
    if (!rec || rec.hasBlockingAssumptions) continue
    if (rec.equityValue == null) continue
    if (concludedEquity == null || parseFloat(rec.equityValue.toString()) > parseFloat(concludedEquity)) {
      concludedEnterprise = rec.enterpriseValue?.toString() ?? null
      concludedEquity     = rec.equityValue?.toString() ?? null
      concludedOwnership  = rec.ownershipValue?.toString() ?? null
    }
  }

  // Document categories from Document.type.
  const documentCategories: Record<string, number> = {}
  let docCount = 0
  for (const d of c.documents) {
    if (d.isArchived) continue
    const key = (d.type || 'OTHER').toString().toUpperCase()
    documentCategories[key] = (documentCategories[key] ?? 0) + 1
    docCount++
  }

  const now = new Date()
  await prisma.caseSearchIndex.upsert({
    where: { caseId: c.id },
    create: {
      caseId:                    c.id,
      organizationId:            c.organizationId,
      hasEngagementTeam:         c.hasEngagementTeam,
      caseName:                  c.name,
      clientName:                c.client,
      engagementType:            c.type,
      caseStatus:                c.status,
      subjectState:              c.subjectState,
      subjectCity:               c.subjectCity,
      subjectCountry:            c.subjectCountry,
      naicsCode:                 c.industry?.naicsCode ?? null,
      sicCode:                   c.industry?.sicCode ?? null,
      industryLabel:             c.industry?.description ?? c.industry?.suggestedIndustry ?? null,
      valuationDate:             c.valuationDate,
      reportDueDate:             c.reportDueDate,
      reportFinalizedAt:         c.report?.finalizedAt ?? null,
      reportStatus:              c.report?.status ?? null,
      methodsApplied:            methodsApplied as any,
      approvedAddBackCategories: approvedAddBackCategories as any,
      hasRelatedPartyAddBack:    hasRelatedParty,
      approvedAssumptions:       approvedAssumptions as any,
      approvedDlocPercent:       approvedDlocPct ?? undefined,
      approvedDlomPercent:       approvedDlomPct ?? undefined,
      concludedEnterpriseValue:  concludedEnterprise ?? undefined,
      concludedEquityValue:      concludedEquity ?? undefined,
      concludedOwnershipValue:   concludedOwnership ?? undefined,
      documentCount:             docCount,
      documentCategories:        documentCategories as any,
      refreshedAt:               now,
      refreshedBy:               input.refreshedBy ?? 'system',
    },
    update: {
      organizationId:            c.organizationId,
      hasEngagementTeam:         c.hasEngagementTeam,
      caseName:                  c.name,
      clientName:                c.client,
      engagementType:            c.type,
      caseStatus:                c.status,
      subjectState:              c.subjectState,
      subjectCity:               c.subjectCity,
      subjectCountry:            c.subjectCountry,
      naicsCode:                 c.industry?.naicsCode ?? null,
      sicCode:                   c.industry?.sicCode ?? null,
      industryLabel:             c.industry?.description ?? c.industry?.suggestedIndustry ?? null,
      valuationDate:             c.valuationDate,
      reportDueDate:             c.reportDueDate,
      reportFinalizedAt:         c.report?.finalizedAt ?? null,
      reportStatus:              c.report?.status ?? null,
      methodsApplied:            methodsApplied as any,
      approvedAddBackCategories: approvedAddBackCategories as any,
      hasRelatedPartyAddBack:    hasRelatedParty,
      approvedAssumptions:       approvedAssumptions as any,
      approvedDlocPercent:       approvedDlocPct,
      approvedDlomPercent:       approvedDlomPct,
      concludedEnterpriseValue:  concludedEnterprise,
      concludedEquityValue:      concludedEquity,
      concludedOwnershipValue:   concludedOwnership,
      documentCount:             docCount,
      documentCategories:        documentCategories as any,
      refreshedAt:               now,
      refreshedBy:               input.refreshedBy ?? 'system',
    },
  })

  return {
    caseId:              c.id,
    organizationId:      c.organizationId,
    methodsApplied,
    approvedAssumptions: approvedAssumptions.length,
    approvedAddBacks:    c.addBacks.length,
    hasRelatedParty,
    approvedDlomPct,
    approvedDlocPct,
    refreshedAt:         now,
  }
}

/**
 * Collect the distinct set of approach kinds that appear on any
 * scenario as `isIncluded=true`. Excluded / stub approaches are not
 * counted.
 */
function collectMethodsApplied(scenarios: Array<{ approaches: Array<{ kind: string; isIncluded: boolean }> }>): string[] {
  const set = new Set<string>()
  for (const s of scenarios) {
    for (const a of s.approaches) {
      if (a.isIncluded) set.add(a.kind)
    }
  }
  return Array.from(set).sort()
}
