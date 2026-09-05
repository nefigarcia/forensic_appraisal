'use server'

/**
 * Server actions for the tie-out engine.
 *
 * All reads and writes route through the Slice-1 authz helpers. Building
 * tie-outs requires `anomaly:run` (analogous to running anomaly detection —
 * a case-analysis operation). Resolving a discrepancy requires
 * `value:override` (EDITOR+). Reads only require `case:read`.
 *
 * Rule "never automatically hide material discrepancies":
 *   - `runTieOutsForCase` upserts by (caseId, concept, year). Existing
 *     RESOLVED rows are NOT downgraded on rebuild — the reviewer's
 *     explicit resolution survives.
 *   - DISCREPANCY status is never auto-transitioned to RESOLVED.
 *   - The dashboard sort places DISCREPANCY first regardless of age.
 */

import { prisma } from '@/lib/prisma'
import { logAction } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { requireCaseAccess, NotFoundError } from '@/lib/authz'
import { readMoney, money, serializeMoney } from '@/lib/money'
import {
  classifyLineItem,
  defaultToleranceFor,
  CONCEPT_LABEL,
  type TieOutConcept,
} from '@/lib/tie-out/concepts'
import {
  computeTieOutStatus,
  DASHBOARD_SORT_ORDER,
} from '@/lib/tie-out/status'

// ─────────────────────────────────────────────────
// Read shapes for the client
// ─────────────────────────────────────────────────

export interface TieOutItemForClient {
  id:                string
  sourceLabel:       string
  value:             string   // serialized Decimal
  documentVersionId: string | null
  financialValueId:  string | null
  documentName:      string | null
  versionNumber:     number | null
}

export interface TieOutForClient {
  id:                string
  concept:           TieOutConcept
  conceptLabel:      string
  year:              string
  status:            'TIED' | 'WITHIN_TOLERANCE' | 'DISCREPANCY' | 'UNRESOLVED' | 'RESOLVED'
  maxDifference:     string | null
  toleranceAbsolute: string | null
  tolerancePercent:  string | null
  resolvedBy:        string | null
  resolvedAt:        Date | null
  resolutionNote:    string | null
  updatedAt:         Date
  items:             TieOutItemForClient[]
}

const ITEM_SELECT = {
  id: true, sourceLabel: true, value: true,
  documentVersionId: true, financialValueId: true,
  documentVersion: { select: { versionNumber: true, document: { select: { name: true } } } },
} as const

const TIE_OUT_SELECT = {
  id: true, concept: true, year: true, status: true,
  maxDifference: true, toleranceAbsolute: true, tolerancePercent: true,
  resolvedBy: true, resolvedAt: true, resolutionNote: true, updatedAt: true,
  items: { select: ITEM_SELECT },
} as const

function itemToClient(row: any): TieOutItemForClient {
  return {
    id:                row.id,
    sourceLabel:       row.sourceLabel,
    value:             row.value?.toString?.() ?? String(row.value ?? '0'),
    documentVersionId: row.documentVersionId,
    financialValueId:  row.financialValueId,
    documentName:      row.documentVersion?.document?.name ?? null,
    versionNumber:     row.documentVersion?.versionNumber ?? null,
  }
}

function tieOutToClient(row: any): TieOutForClient {
  return {
    id:                row.id,
    concept:           row.concept,
    conceptLabel:      CONCEPT_LABEL[row.concept as TieOutConcept] ?? row.concept,
    year:              row.year,
    status:            row.status,
    maxDifference:     row.maxDifference?.toString?.() ?? null,
    toleranceAbsolute: row.toleranceAbsolute?.toString?.() ?? null,
    tolerancePercent:  row.tolerancePercent?.toString?.() ?? null,
    resolvedBy:        row.resolvedBy,
    resolvedAt:        row.resolvedAt,
    resolutionNote:    row.resolutionNote,
    updatedAt:         row.updatedAt,
    items:             (row.items ?? []).map(itemToClient),
  }
}

// ─────────────────────────────────────────────────
// getTieOutsForCase
// ─────────────────────────────────────────────────

/**
 * List every tie-out for the case, sorted with discrepancies first so
 * material issues can't be hidden by scroll.
 */
export async function getTieOutsForCase(caseId: string): Promise<TieOutForClient[]> {
  await requireCaseAccess(caseId, 'case:read')
  const rows = await prisma.tieOut.findMany({
    where:   { caseId },
    select:  TIE_OUT_SELECT,
    orderBy: [{ status: 'asc' }, { concept: 'asc' }, { year: 'desc' }],
  })
  const shaped = rows.map(tieOutToClient)
  // JS sort — DB `orderBy status` is alphabetic, we want the dashboard
  // priority order (DISCREPANCY → UNRESOLVED → RESOLVED → WITHIN → TIED).
  shaped.sort((a, b) => {
    const sa = DASHBOARD_SORT_ORDER[a.status]
    const sb = DASHBOARD_SORT_ORDER[b.status]
    if (sa !== sb) return sa - sb
    if (a.concept < b.concept) return -1
    if (a.concept > b.concept) return  1
    return a.year < b.year ? 1 : -1
  })
  return shaped
}

// ─────────────────────────────────────────────────
// runTieOutsForCase — build from classified FinancialValues
// ─────────────────────────────────────────────────

interface GroupedValue {
  concept: TieOutConcept
  year:    string
  items:   {
    sourceLabel:       string
    value:             string
    financialValueId:  string
    documentVersionId: string | null
  }[]
}

/**
 * Deterministic build. Every FinancialValue whose `lineItem` classifies
 * to a known concept becomes a TieOutItem on the (concept, year) group.
 * Rows that don't classify are silently skipped — the classifier never
 * guesses (Rule 9 from Slice 7 carries over: unclassifiable rows aren't
 * fabricated into a wrong concept).
 *
 * Concurrency: uses upsert by unique (caseId, concept, year). Existing
 * RESOLVED tie-outs are preserved. Existing DISCREPANCY tie-outs are
 * re-evaluated but their status is only downgraded to WITHIN_TOLERANCE or
 * TIED if the new item set actually satisfies the rules.
 */
export async function runTieOutsForCase(caseId: string): Promise<{ built: number; concepts: number }> {
  const { session } = await requireCaseAccess(caseId, 'anomaly:run')

  const values = await prisma.financialValue.findMany({
    where:  { caseId },
    include: { document: { select: { currentVersionId: true } } },
  })

  // Group by (concept, year).
  const byKey = new Map<string, GroupedValue>()
  for (const v of values) {
    const concept = classifyLineItem(v.lineItem)
    if (!concept) continue
    const year = v.year || 'UNSPECIFIED'
    const key  = `${concept}::${year}`
    const dec = readMoney(v as any, 'value')  // Slice 4 dual-column helper
    if (!dec) continue
    const g = byKey.get(key) ?? { concept, year, items: [] as GroupedValue['items'] }
    g.items.push({
      sourceLabel:      v.statementType || 'Unknown source',
      value:            dec.toString(),
      financialValueId: v.id,
      documentVersionId: (v.document as any)?.currentVersionId ?? null,
    })
    byKey.set(key, g)
  }

  let built = 0
  for (const { concept, year, items } of byKey.values()) {
    // Compute the aggregate status. Even for 0-1 items we still create
    // the TieOut — it shows up as UNRESOLVED so the analyst sees the
    // one-source coverage gap explicitly.
    const tol = defaultToleranceFor(concept)
    const { status, maxDifference } = computeTieOutStatus(items.map(i => i.value), tol)

    await prisma.$transaction(async (tx) => {
      const existing = await tx.tieOut.findUnique({
        where: { caseId_concept_year: { caseId, concept, year } },
      })

      // Rule: never automatically hide material discrepancies.
      //   - If the existing row is RESOLVED, keep the reviewer's verdict.
      //   - If the newly-computed status is DISCREPANCY, use it (no auto-hide).
      //   - If the existing was DISCREPANCY and the new is a better
      //     status (within tolerance / tied), we do change it — the
      //     underlying evidence changed, and the change is visible to
      //     the reviewer via the updatedAt column.
      const nextStatus =
        existing?.status === 'RESOLVED' ? 'RESOLVED' : status

      const upserted = await tx.tieOut.upsert({
        where: { caseId_concept_year: { caseId, concept, year } },
        create: {
          caseId, concept, year,
          toleranceAbsolute: tol.absolute,
          tolerancePercent:  tol.percent,
          status:            nextStatus,
          maxDifference,
        },
        update: {
          // Do not overwrite tolerances if the reviewer set custom ones.
          // We only set on create above.
          status:        nextStatus,
          maxDifference,
        },
      })

      // Rebuild items — the immutable evidence is on the source rows
      // (FinancialValue / DocumentVersion), so replacing items is safe.
      await tx.tieOutItem.deleteMany({ where: { tieOutId: upserted.id } })
      await tx.tieOutItem.createMany({
        data: items.map(i => ({
          tieOutId:          upserted.id,
          sourceLabel:       i.sourceLabel,
          value:             money(i.value) as any,
          financialValueId:  i.financialValueId,
          documentVersionId: i.documentVersionId,
        })),
      })
    })
    built++
  }

  await logAction({
    userId: session.userId, action: 'RUN_ANOMALY_DETECTION', caseId,
    note: `Built ${built} tie-outs across ${byKey.size} groups`,
  })
  revalidatePath(`/projects/${caseId}`)
  return { built, concepts: byKey.size }
}

// ─────────────────────────────────────────────────
// resolveTieOut — human closure of a DISCREPANCY
// ─────────────────────────────────────────────────

export async function resolveTieOut(id: string, resolutionNote: string): Promise<void> {
  if (!resolutionNote?.trim()) throw new Error('Resolution note required')

  const row = await prisma.tieOut.findUnique({ where: { id }, select: { caseId: true, status: true } })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.caseId, 'value:override')

  if (row.status === 'TIED' || row.status === 'WITHIN_TOLERANCE') {
    // Silently no-op — resolving a tie is meaningless. But do NOT throw:
    // the UI shouldn't have surfaced the button, so quietly accepting a
    // stale click is a friendlier outcome than an error.
    return
  }

  await prisma.tieOut.update({
    where: { id },
    data:  {
      status:        'RESOLVED',
      resolvedBy:    session.userId,
      resolvedAt:    new Date(),
      resolutionNote,
    },
  })
  await logAction({
    userId: session.userId, action: 'RESOLVE_FLAG', caseId: row.caseId,
    targetModel: 'TieOut', targetId: id,
    note: resolutionNote.slice(0, 200),
  })
  revalidatePath(`/projects/${row.caseId}`)
}

// ─────────────────────────────────────────────────
// reopenTieOut — undo a mistaken resolution
// ─────────────────────────────────────────────────

/**
 * Reopens a RESOLVED tie-out — clears reviewer fields and recomputes the
 * status from the current items. Never auto-hides: if the underlying
 * items still fail the tolerance rule, the status returns to
 * DISCREPANCY.
 */
export async function reopenTieOut(id: string): Promise<void> {
  const row = await prisma.tieOut.findUnique({
    where:  { id },
    include: { items: true },
  })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.caseId, 'value:override')
  if (row.status !== 'RESOLVED') return

  const tol = {
    absolute: row.toleranceAbsolute ?? defaultToleranceFor(row.concept as TieOutConcept).absolute,
    percent:  row.tolerancePercent  ?? defaultToleranceFor(row.concept as TieOutConcept).percent,
  }
  const { status, maxDifference } = computeTieOutStatus(
    row.items.map((i: any) => i.value?.toString?.() ?? '0'),
    { absolute: money(tol.absolute), percent: money(tol.percent) },
  )

  await prisma.tieOut.update({
    where: { id },
    data:  {
      status,
      maxDifference,
      resolvedBy:     null,
      resolvedAt:     null,
      resolutionNote: null,
    },
  })
  await logAction({
    userId: session.userId, action: 'RESOLVE_FLAG', caseId: row.caseId,
    targetModel: 'TieOut', targetId: id, note: `reopened → ${status}`,
  })
  revalidatePath(`/projects/${row.caseId}`)
}

/** Helper for tests that want to inspect the serialized Decimal shape. */
export async function _debugSerializeDecimal(v: string): Promise<string | null> {
  return serializeMoney(money(v))
}
