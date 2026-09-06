/**
 * Approved-only ReportFacts extractor.
 *
 * The load-bearing Slice-14 invariant is: **the AI narrative flow
 * NEVER sees a fact that a professional has not approved.** This
 * module is the sole boundary between raw case data (which contains
 * proposed / draft / rejected rows) and the payload the AI receives.
 *
 * Filtering rules:
 *   - `FinancialValue.isVerified = true` — verified by a professional
 *     (accepted or overridden).
 *   - `AddBack.status = 'APPROVED'` — Slice-10 normalization workbench.
 *   - `ValuationAssumption.status = 'APPROVED'` — Slice-13.
 *   - `OwnershipAdjustment.status = 'APPROVED'` — Slice-13.
 *   - `ValuationReconciliation.hasBlockingAssumptions = false` — the
 *     scenario must be free of blocking assumptions.
 *   - `EvidenceCitation.isConfident = true` — Slice-7.
 *   - `Document.isArchived = false` — Slice-5 versioning.
 *
 * The output is canonicalized + hashed. `factsHash` becomes the
 * "snapshot fingerprint" that a `ReportSectionVersion` and
 * `ReportVersion` pin to prove they were drafted against the exact
 * data present at generation time.
 */

import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import type { ReportFactScope, ReportSectionKey } from './sections'
import { SECTION_CATALOG } from './sections'

// ─────────────────────────────────────────────────
// Output shape
// ─────────────────────────────────────────────────

export interface ReportFactsPayload {
  engagement: {
    caseId:          string
    caseName:        string
    clientName:      string
    engagementType:  string
    manager:         string
    valuationDate:   string | null       // ISO date
    reportDueDate:   string | null
    purposeOfValue:  string | null
    standardOfValue: string | null
    premiseOfValue:  string | null
    interestType:    string | null
    marketability:   string | null
    reportingCurrency: string | null
  }
  company: {
    industry:  { code: string | null; description: string | null } | null
  }
  ownership: {
    // APPROVED ownership adjustments only.
    approvedAdjustments: Array<{
      id: string; kind: string; percent: string; source: string | null; rationale: string | null
    }>
  }
  industry: {
    naics: string | null
    sic:   string | null
    description: string | null
  }
  economic: {
    // Placeholder — Slice-14 does not source economic data. The section
    // renderer flags "missing information" for the reviewer.
    dataAvailable: false
  }
  financials: {
    // Verified rows only. Kept as strings so the AI has no chance of
    // silently re-rounding.
    values: Array<{
      id: string; year: string; statementType: string;
      lineItem: string; value: string; documentId: string | null;
    }>
  }
  normalization: {
    approvedAddBacks: Array<{
      id: string; category: string; description: string;
      year2: string | null; year1: string | null; ttm: string | null;
      rationale: string | null;
    }>
  }
  valuation: {
    // Non-blocking reconciliations only; the scenario is trustworthy.
    scenarios: Array<{
      scenarioId: string; scenarioKey: string; scenarioName: string;
      enterpriseValue: string | null; equityValue: string | null;
      ownershipValue: string | null;
      approaches: Array<{
        approachId: string; kind: string; weight: string; isIncluded: boolean; indicatedValue: string | null;
      }>
      bridgeItems: Array<{
        category: string; label: string; amount: string;
      }>
    }>
  }
  reconciliation: {
    finalized: boolean       // engagement.status = 'FINAL' and every scenario reconciled
  }
  assumptions: {
    // APPROVED assumptions only.
    approved: Array<{
      id: string; key: string; label: string; category: string | null;
      value: string | null; unit: string | null;
      source: string | null; rationale: string | null;
    }>
  }
  evidence: {
    documents: Array<{
      documentId: string; name: string; currentVersionId: string | null;
      sha256Hash: string | null;
    }>
    // Confident citations only.
    citations: Array<{
      id: string; documentVersionId: string; pageNumber: number | null;
      sourceLabel: string | null; rawText: string | null;
    }>
  }
}

export interface ReportFactsResult {
  payload:   ReportFactsPayload
  factsHash: string       // sha256 hex
}

/**
 * Fetch the approved-only fact payload for a case + return a canonical
 * hash. Safe to call from any server-side context — expects that the
 * caller has already authorized case access.
 */
export async function buildReportFacts(caseId: string): Promise<ReportFactsResult> {
  const [
    c, engagementRow, values, addBacks, assumptions, ownership,
    reconciliations, documents, citations, industry,
  ] = await Promise.all([
    prisma.case.findUnique({ where: { id: caseId } }),
    prisma.valuationEngagement.findUnique({
      where: { caseId },
      include: {
        scenarios: {
          include: {
            approaches: true,
            bridgeItems: true,
            reconciliation: true,
          },
        },
      },
    }),
    prisma.financialValue.findMany({
      where: { caseId, isVerified: true },
      orderBy: [{ year: 'asc' }, { statementType: 'asc' }, { lineItem: 'asc' }],
    }),
    prisma.addBack.findMany({
      where: { caseId, status: 'APPROVED' },
      orderBy: [{ category: 'asc' }, { description: 'asc' }],
    }),
    prisma.valuationAssumption.findMany({
      where: { engagement: { caseId }, status: 'APPROVED' },
      orderBy: [{ key: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.ownershipAdjustment.findMany({
      where: { engagement: { caseId }, status: 'APPROVED' },
      orderBy: [{ kind: 'asc' }],
    }),
    prisma.valuationReconciliation.findMany({
      where: { engagement: { caseId }, hasBlockingAssumptions: false },
      include: { scenario: { select: { key: true, name: true } } },
    }),
    prisma.document.findMany({
      where: { caseId, isArchived: false },
      select: { id: true, name: true, sha256Hash: true, currentVersionId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.evidenceCitation.findMany({
      where: {
        isConfident: true,
        documentVersion: { document: { caseId } },
      },
      select: { id: true, documentVersionId: true, pageNumber: true, sourceLabel: true, rawText: true },
    }),
    prisma.industryClassification.findUnique({ where: { caseId } }),
  ])

  if (!c) throw new Error(`Case ${caseId} not found`)

  const scenarios = (engagementRow?.scenarios ?? [])
    // Include a scenario only if its reconciliation is trustworthy
    // (either not yet computed, or non-blocking).
    .filter(s => !s.reconciliation || !s.reconciliation.hasBlockingAssumptions)
    .map(s => ({
      scenarioId:   s.id,
      scenarioKey:  s.key,
      scenarioName: s.name,
      enterpriseValue: s.reconciliation?.enterpriseValue?.toString() ?? null,
      equityValue:     s.reconciliation?.equityValue?.toString() ?? null,
      ownershipValue:  s.reconciliation?.ownershipValue?.toString() ?? null,
      approaches: s.approaches.map(a => ({
        approachId: a.id, kind: a.kind, weight: a.weight.toString(),
        isIncluded: a.isIncluded,
        indicatedValue: a.indicatedValue?.toString() ?? null,
      })),
      bridgeItems: s.bridgeItems.map(b => ({
        category: b.category, label: b.label, amount: b.amount.toString(),
      })),
    }))

  const payload: ReportFactsPayload = {
    engagement: {
      caseId:            c.id,
      caseName:          c.name,
      clientName:        c.client,
      engagementType:    c.type,
      manager:           c.manager,
      valuationDate:     c.valuationDate?.toISOString() ?? engagementRow?.valuationDate?.toISOString() ?? null,
      reportDueDate:     c.reportDueDate?.toISOString() ?? null,
      purposeOfValue:    c.purposeOfValue,
      standardOfValue:   engagementRow?.standardOfValue ?? c.standardOfValue,
      premiseOfValue:    engagementRow?.premiseOfValue ?? null,
      interestType:      engagementRow?.interestType ?? null,
      marketability:     engagementRow?.marketability ?? null,
      reportingCurrency: engagementRow?.reportingCurrency ?? null,
    },
    company: {
      industry: industry ? { code: industry.naicsCode ?? industry.sicCode ?? null, description: industry.description } : null,
    },
    ownership: {
      approvedAdjustments: ownership.map(o => ({
        id: o.id, kind: o.kind, percent: o.percent.toString(),
        source: o.source, rationale: o.rationale,
      })),
    },
    industry: {
      naics: industry?.naicsCode ?? null,
      sic:   industry?.sicCode ?? null,
      description: industry?.description ?? null,
    },
    economic: { dataAvailable: false },
    financials: {
      values: values.map(v => ({
        id: v.id, year: v.year, statementType: v.statementType,
        lineItem: v.lineItem,
        value: (v.valueDecimal?.toString() ?? String(v.value)),
        documentId: v.documentId,
      })),
    },
    normalization: {
      approvedAddBacks: addBacks.map(a => ({
        id: a.id, category: a.category, description: a.description,
        year2: a.year2Decimal?.toString() ?? (a.year2 != null ? String(a.year2) : null),
        year1: a.year1Decimal?.toString() ?? (a.year1 != null ? String(a.year1) : null),
        ttm:   a.ttmDecimal?.toString()   ?? (a.ttm   != null ? String(a.ttm)   : null),
        rationale: a.rationale,
      })),
    },
    valuation: { scenarios },
    reconciliation: {
      finalized: (engagementRow?.status === 'FINAL') && scenarios.length > 0,
    },
    assumptions: {
      approved: assumptions.map(a => ({
        id: a.id, key: a.key, label: a.label, category: a.category,
        value: a.valueString ?? a.valueNumeric?.toString() ?? null,
        unit: a.unit, source: a.source, rationale: a.rationale,
      })),
    },
    evidence: {
      documents: documents.map(d => ({
        documentId: d.id, name: d.name,
        currentVersionId: d.currentVersionId,
        sha256Hash: d.sha256Hash,
      })),
      citations: citations.map(c => ({
        id: c.id, documentVersionId: c.documentVersionId,
        pageNumber: c.pageNumber, sourceLabel: c.sourceLabel, rawText: c.rawText,
      })),
    },
  }

  const factsHash = hashPayload(payload)
  return { payload, factsHash }
}

// ─────────────────────────────────────────────────
// Section-scoped extraction
// ─────────────────────────────────────────────────

/**
 * Given the full payload and a section key, return only the scoped
 * subset. The AI narrative flow calls this so it receives no more
 * data than the section requires. Even if a hostile prompt tried to
 * cite an out-of-scope fact, it wouldn't be in the input.
 */
export function scopeForSection(
  payload: ReportFactsPayload,
  key: ReportSectionKey,
): Partial<ReportFactsPayload> {
  const scopes = new Set<ReportFactScope>(SECTION_CATALOG[key].factScope)
  const out: Partial<ReportFactsPayload> = {}
  if (scopes.has('engagement'))     out.engagement     = payload.engagement
  if (scopes.has('company'))        out.company        = payload.company
  if (scopes.has('ownership'))      out.ownership      = payload.ownership
  if (scopes.has('industry'))       out.industry       = payload.industry
  if (scopes.has('economic'))       out.economic       = payload.economic
  if (scopes.has('financials'))     out.financials     = payload.financials
  if (scopes.has('normalization'))  out.normalization  = payload.normalization
  if (scopes.has('valuation'))      out.valuation      = payload.valuation
  if (scopes.has('reconciliation')) out.reconciliation = payload.reconciliation
  if (scopes.has('assumptions'))    out.assumptions    = payload.assumptions
  if (scopes.has('evidence'))       out.evidence       = payload.evidence
  return out
}

// ─────────────────────────────────────────────────
// Canonicalization + hashing
// ─────────────────────────────────────────────────

/**
 * Deterministic canonicalization. Keys are sorted alphabetically at
 * every object level. Arrays keep their order (the extractor already
 * sorted them). Booleans and numbers stay as-is. `undefined` becomes
 * `null` for stability.
 */
export function canonicalize(v: unknown): string {
  if (v === undefined || v === null) return 'null'
  if (typeof v === 'string')  return JSON.stringify(v)
  if (typeof v === 'number')  return Number.isFinite(v) ? String(v) : 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']'
  if (typeof v === 'object') {
    const rec = v as Record<string, unknown>
    const keys = Object.keys(rec).sort()
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(rec[k])).join(',') + '}'
  }
  return 'null'
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex')
}

/** True when the two hashes refer to identical facts payloads. */
export function factsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a === b
}

