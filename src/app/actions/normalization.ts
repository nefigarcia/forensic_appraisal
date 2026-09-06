'use server'

/**
 * Normalization Workbench server actions.
 *
 * All reads/writes route through Slice-1 authz. Status transitions are
 * enforced in code (see src/lib/normalization/statuses.ts). Every
 * mutation writes an audit event.
 *
 * Bridge math and warnings use Slice-4 Decimal helpers end-to-end.
 * Reported EBITDA is derived from FinancialValue rows classified via the
 * Slice-9 tie-out concept classifier.
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, requireAddBackAccess, NotFoundError } from '@/lib/authz'
import { money, moneySum, readMoney, serializeMoney, type Money, type MoneyInput } from '@/lib/money'
import {
  canTransition,
  transitionRequiresReason,
  DASHBOARD_STATUS_ORDER,
  ADJUSTMENT_STATUSES,
  isReviewerQueueStatus,
  type AdjustmentStatus,
} from '@/lib/normalization/statuses'
import { computeBridge, PERIODS, type Period } from '@/lib/normalization/bridge'
import { warningsFor, type AdjustmentWarning } from '@/lib/normalization/warnings'
import { classifyLineItem } from '@/lib/tie-out/concepts'
import { defaultDirectionFor } from '@/lib/normalization/categories'

// ─────────────────────────────────────────────────
// Client shapes
// ─────────────────────────────────────────────────

export interface AdjustmentForClient {
  id:              string
  category:        string
  description:     string
  status:          AdjustmentStatus
  direction:       'ADD' | 'SUBTRACT'
  recurring:       string
  taxTreatment:    string | null
  rationale:       string | null
  amounts:         { year2: string | null; year1: string | null; ttm: string | null }
  proposedBy:      string | null
  reviewedBy:      string | null
  reviewedAt:      Date | null
  statusChangedAt: Date | null
  rejectionReason: string | null
  citationCount:   number
  warnings:        AdjustmentWarning[]
  createdAt:       Date
  updatedAt:       Date
}

export interface WorkbenchData {
  adjustments:     AdjustmentForClient[]
  reportedByPeriod: { year2: string; year1: string; ttm: string }
  bridge: {
    perPeriod: Record<Period, { reported: string; netAdjustment: string; normalized: string; appliedAdjustments: number }>
    totalReported:   string
    totalNormalized: string
    approvedCount:   number
    ignoredCount:    number
  }
  reviewerQueueCount: number
}

const ADJUSTMENT_SELECT = {
  id: true, category: true, description: true,
  status: true, direction: true, recurring: true, taxTreatment: true,
  rationale: true, proposedBy: true, reviewedBy: true, reviewedAt: true,
  statusChangedAt: true, rejectionReason: true,
  year2: true, year1: true, ttm: true,
  year2Decimal: true, year1Decimal: true, ttmDecimal: true,
  createdAt: true, updatedAt: true,
  _count: { select: { citations: true } },
} as const

function shape(row: any): AdjustmentForClient {
  const amounts = {
    year2: readMoney(row, 'year2')?.toString() ?? null,
    year1: readMoney(row, 'year1')?.toString() ?? null,
    ttm:   readMoney(row, 'ttm')?.toString()   ?? null,
  }
  return {
    id: row.id,
    category:        row.category,
    description:     row.description,
    status:          row.status as AdjustmentStatus,
    direction:       (row.direction ?? 'ADD') as 'ADD' | 'SUBTRACT',
    recurring:       row.recurring ?? 'NONRECURRING',
    taxTreatment:    row.taxTreatment,
    rationale:       row.rationale,
    amounts,
    proposedBy:      row.proposedBy,
    reviewedBy:      row.reviewedBy,
    reviewedAt:      row.reviewedAt,
    statusChangedAt: row.statusChangedAt,
    rejectionReason: row.rejectionReason,
    citationCount:   row._count?.citations ?? 0,
    warnings:        warningsFor({
      rationale:      row.rationale,
      citationCount:  row._count?.citations ?? 0,
      amounts:        { year2: amounts.year2, year1: amounts.year1, ttm: amounts.ttm },
      taxTreatment:   row.taxTreatment,
      recurring:      row.recurring,
      status:         row.status,
    }),
    createdAt:       row.createdAt,
    updatedAt:       row.updatedAt,
  }
}

// ─────────────────────────────────────────────────
// Reported EBITDA (Slice 9 classifier + Slice 4 decimals)
// ─────────────────────────────────────────────────

/**
 * Sum FinancialValue rows classified as EBITDA per year label, then
 * return a mapping onto the workbench's `Period` slots.
 *
 * Mapping strategy — pragmatic and documented:
 *   - Latest year → year1
 *   - Second-latest → year2
 *   - Any FinancialValue with `year === 'TTM'` → ttm
 *
 * If the case doesn't have EBITDA rows for a slot, we default to 0 —
 * warnings on the row alert the analyst.
 */
async function getReportedEbitdaByPeriod(caseId: string): Promise<Record<Period, Money>> {
  const values = await prisma.financialValue.findMany({
    where: { caseId },
    select: {
      year: true, lineItem: true, value: true, valueDecimal: true,
    },
  })
  const byYearLabel = new Map<string, Money>()
  for (const v of values) {
    if (classifyLineItem(v.lineItem) !== 'EBITDA') continue
    const amt = readMoney(v as any, 'value') ?? money(0)
    const key = v.year || 'UNSPECIFIED'
    byYearLabel.set(key, (byYearLabel.get(key) ?? money(0)).plus(amt))
  }
  const yearLabels = [...byYearLabel.keys()]
    .filter(y => y !== 'TTM' && /^\d{4}$/.test(y))
    .sort()  // ascending
  const latest       = yearLabels.length >= 1 ? yearLabels[yearLabels.length - 1]! : null
  const secondLatest = yearLabels.length >= 2 ? yearLabels[yearLabels.length - 2]! : null
  return {
    year2: secondLatest ? (byYearLabel.get(secondLatest) ?? money(0)) : money(0),
    year1: latest       ? (byYearLabel.get(latest)       ?? money(0)) : money(0),
    ttm:   byYearLabel.get('TTM') ?? money(0),
  }
}

// ─────────────────────────────────────────────────
// getWorkbench (main read)
// ─────────────────────────────────────────────────

export async function getWorkbenchForCase(caseId: string): Promise<WorkbenchData> {
  await requireCaseAccess(caseId, 'case:read')
  const rows = await prisma.addBack.findMany({
    where: { caseId },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    select: ADJUSTMENT_SELECT,
  })
  const shaped = rows.map(shape)
  shaped.sort((a, b) => {
    const sa = DASHBOARD_STATUS_ORDER[a.status] ?? 99
    const sb = DASHBOARD_STATUS_ORDER[b.status] ?? 99
    if (sa !== sb) return sa - sb
    return b.updatedAt.getTime() - a.updatedAt.getTime()
  })

  const reported = await getReportedEbitdaByPeriod(caseId)

  const bridge = computeBridge(
    { year2: reported.year2, year1: reported.year1, ttm: reported.ttm },
    shaped.map(a => ({
      id: a.id, direction: a.direction, status: a.status,
      amounts: {
        year2: a.amounts.year2 ? money(a.amounts.year2) : null,
        year1: a.amounts.year1 ? money(a.amounts.year1) : null,
        ttm:   a.amounts.ttm   ? money(a.amounts.ttm)   : null,
      },
    })),
  )

  return {
    adjustments: shaped,
    reportedByPeriod: {
      year2: reported.year2.toString(),
      year1: reported.year1.toString(),
      ttm:   reported.ttm.toString(),
    },
    bridge: {
      perPeriod: {
        year2: {
          reported:           bridge.perPeriod.year2.reported.toString(),
          netAdjustment:      bridge.perPeriod.year2.netAdjustment.toString(),
          normalized:         bridge.perPeriod.year2.normalized.toString(),
          appliedAdjustments: bridge.perPeriod.year2.appliedAdjustments,
        },
        year1: {
          reported:           bridge.perPeriod.year1.reported.toString(),
          netAdjustment:      bridge.perPeriod.year1.netAdjustment.toString(),
          normalized:         bridge.perPeriod.year1.normalized.toString(),
          appliedAdjustments: bridge.perPeriod.year1.appliedAdjustments,
        },
        ttm: {
          reported:           bridge.perPeriod.ttm.reported.toString(),
          netAdjustment:      bridge.perPeriod.ttm.netAdjustment.toString(),
          normalized:         bridge.perPeriod.ttm.normalized.toString(),
          appliedAdjustments: bridge.perPeriod.ttm.appliedAdjustments,
        },
      },
      totalReported:   bridge.totalReported.toString(),
      totalNormalized: bridge.totalNormalized.toString(),
      approvedCount:   bridge.approvedCount,
      ignoredCount:    bridge.ignoredCount,
    },
    reviewerQueueCount: shaped.filter(a => isReviewerQueueStatus(a.status)).length,
  }
}

// ─────────────────────────────────────────────────
// createAdjustment
// ─────────────────────────────────────────────────

export interface CreateAdjustmentInput {
  category:      string          // free-form; may be a SUGGESTED_CATEGORIES value
  description:   string
  direction?:    'ADD' | 'SUBTRACT'
  recurring?:    'RECURRING' | 'NONRECURRING' | 'ONE_TIME'
  taxTreatment?: 'PRE_TAX' | 'AFTER_TAX' | 'NOT_APPLICABLE' | null
  rationale?:    string
  amounts?: {
    year2?: MoneyInput | null
    year1?: MoneyInput | null
    ttm?:   MoneyInput | null
  }
}

export async function createAdjustment(caseId: string, input: CreateAdjustmentInput): Promise<{ id: string }> {
  const { session } = await requireCaseAccess(caseId, 'addback:write')

  if (!input.description?.trim()) throw new Error('Description required')
  if (!input.category?.trim())    throw new Error('Category required')

  const now = new Date()
  const direction = input.direction ?? defaultDirectionFor(input.category)
  const y2 = input.amounts?.year2 != null ? money(input.amounts.year2) : null
  const y1 = input.amounts?.year1 != null ? money(input.amounts.year1) : null
  const tm = input.amounts?.ttm   != null ? money(input.amounts.ttm)   : null

  const created = await prisma.addBack.create({
    data: {
      caseId,
      category:     input.category.trim(),
      description:  input.description.trim(),
      direction,
      recurring:    input.recurring ?? 'NONRECURRING',
      taxTreatment: input.taxTreatment ?? null,
      rationale:    input.rationale?.trim() ?? null,
      // Float legacy (kept in sync for Slice-0 readers)
      year2: y2 ? Number(y2.toFixed(4)) : null,
      year1: y1 ? Number(y1.toFixed(4)) : null,
      ttm:   tm ? Number(tm.toFixed(4)) : null,
      // Slice-4 authoritative decimals
      year2Decimal: y2 ?? null,
      year1Decimal: y1 ?? null,
      ttmDecimal:   tm ?? null,
      // Slice-10 workflow
      status:          'DRAFT',
      proposedBy:      session.userId,
      statusChangedAt: now,
      isApproved:      false,
    },
  })
  await logAction({
    userId: session.userId, action: 'CREATE_ADDBACK', caseId,
    targetModel: 'AddBack', targetId: created.id,
    note: `${input.category}: ${input.description}`,
  })
  revalidatePath(`/projects/${caseId}`)
  return { id: created.id }
}

// ─────────────────────────────────────────────────
// updateAdjustment — only allowed while DRAFT / NEEDS_SUPPORT
// ─────────────────────────────────────────────────

export interface UpdateAdjustmentInput {
  category?:     string
  description?:  string
  direction?:    'ADD' | 'SUBTRACT'
  recurring?:    'RECURRING' | 'NONRECURRING' | 'ONE_TIME'
  taxTreatment?: 'PRE_TAX' | 'AFTER_TAX' | 'NOT_APPLICABLE' | null
  rationale?:    string
  amounts?: {
    year2?: MoneyInput | null
    year1?: MoneyInput | null
    ttm?:   MoneyInput | null
  }
}

export async function updateAdjustment(id: string, input: UpdateAdjustmentInput): Promise<void> {
  const { session, addBack } = await requireAddBackAccess(id, 'addback:write')
  const status = (addBack as any).status ?? 'DRAFT'
  if (status !== 'DRAFT' && status !== 'NEEDS_SUPPORT' && status !== 'REJECTED') {
    throw new Error(
      `Cannot edit adjustment in status ${status}. Send it back to DRAFT first.`,
    )
  }

  const data: Record<string, unknown> = {}
  if (input.category    !== undefined) data.category    = input.category.trim()
  if (input.description !== undefined) data.description = input.description.trim()
  if (input.direction   !== undefined) data.direction   = input.direction
  if (input.recurring   !== undefined) data.recurring   = input.recurring
  if (input.taxTreatment !== undefined) data.taxTreatment = input.taxTreatment
  if (input.rationale   !== undefined) data.rationale   = input.rationale?.trim() || null

  if (input.amounts) {
    if ('year2' in input.amounts) {
      const v = input.amounts.year2 == null ? null : money(input.amounts.year2)
      data.year2        = v ? Number(v.toFixed(4)) : null
      data.year2Decimal = v ?? null
    }
    if ('year1' in input.amounts) {
      const v = input.amounts.year1 == null ? null : money(input.amounts.year1)
      data.year1        = v ? Number(v.toFixed(4)) : null
      data.year1Decimal = v ?? null
    }
    if ('ttm' in input.amounts) {
      const v = input.amounts.ttm == null ? null : money(input.amounts.ttm)
      data.ttm        = v ? Number(v.toFixed(4)) : null
      data.ttmDecimal = v ?? null
    }
  }

  const before = {
    year2: addBack.year2, year1: addBack.year1, ttm: addBack.ttm,
    category: addBack.category, description: addBack.description,
  }
  await prisma.addBack.update({ where: { id }, data })
  await logAction({
    userId: session.userId, action: 'UPDATE_ADDBACK', caseId: addBack.caseId,
    targetModel: 'AddBack', targetId: id,
    oldValue: before, newValue: data,
  })
  revalidatePath(`/projects/${addBack.caseId}`)
}

// ─────────────────────────────────────────────────
// changeStatus — the single sanctioned status-transition path
// ─────────────────────────────────────────────────

export async function changeAdjustmentStatus(
  id: string,
  next: AdjustmentStatus,
  reason?: string,
): Promise<void> {
  if (!ADJUSTMENT_STATUSES.includes(next)) {
    throw new Error(`Unknown status: ${next}`)
  }
  const { session, addBack } = await requireAddBackAccess(id, 'addback:approve')
  const from = ((addBack as any).status ?? 'DRAFT') as AdjustmentStatus
  if (from === next) return  // no-op

  if (!canTransition(from, next)) {
    throw new Error(`Invalid transition: ${from} → ${next}`)
  }
  if (transitionRequiresReason(next) && !reason?.trim()) {
    throw new Error(`Transition to ${next} requires a reason`)
  }

  const now = new Date()
  const data: Record<string, unknown> = {
    status:          next,
    statusChangedAt: now,
    isApproved:      next === 'APPROVED',
  }
  if (next === 'APPROVED') {
    data.reviewedBy     = session.userId
    data.reviewedAt     = now
    data.approvedBy     = session.userId
    data.rejectionReason = null
  } else if (next === 'REJECTED') {
    data.reviewedBy     = session.userId
    data.reviewedAt     = now
    data.rejectionReason = reason ?? null
  } else if (next === 'NEEDS_SUPPORT') {
    data.reviewedBy     = session.userId
    data.reviewedAt     = now
    data.rejectionReason = reason ?? null
  } else if (next === 'DRAFT') {
    // A round-trip back to DRAFT clears prior reviewer verdicts so the
    // reviewer sees a clean slate on the next submission.
    data.reviewedBy      = null
    data.reviewedAt      = null
    data.rejectionReason = null
  } else if (next === 'PROPOSED') {
    data.proposedBy = session.userId
    data.rejectionReason = null
  }

  await prisma.addBack.update({ where: { id }, data })
  await logAction({
    userId: session.userId,
    action: next === 'APPROVED' ? 'APPROVE_ADDBACK'
           : next === 'DRAFT' && from === 'APPROVED' ? 'UNAPPROVE_ADDBACK'
           : 'UPDATE_ADDBACK',
    caseId: addBack.caseId,
    targetModel: 'AddBack', targetId: id,
    oldValue: { status: from },
    newValue: { status: next, reason: reason ?? null },
    note: reason?.slice(0, 200),
  })
  revalidatePath(`/projects/${addBack.caseId}`)
}

// ─────────────────────────────────────────────────
// deleteAdjustment — DRAFT only
// ─────────────────────────────────────────────────

export async function deleteAdjustment(id: string): Promise<void> {
  const { session, addBack } = await requireAddBackAccess(id, 'addback:write')
  const status = (addBack as any).status ?? 'DRAFT'
  if (status !== 'DRAFT' && status !== 'REJECTED') {
    throw new Error(`Cannot delete adjustment in status ${status}. Only DRAFT and REJECTED adjustments may be deleted.`)
  }
  await prisma.addBack.delete({ where: { id } })
  await logAction({
    userId: session.userId, action: 'DELETE_ADDBACK', caseId: addBack.caseId,
    targetModel: 'AddBack', targetId: id, note: addBack.description,
  })
  revalidatePath(`/projects/${addBack.caseId}`)
}

// ─────────────────────────────────────────────────
// Reviewer queue
// ─────────────────────────────────────────────────

export interface ReviewerQueueRow {
  id:            string
  caseId:        string
  caseName:      string
  category:      string
  description:   string
  status:        AdjustmentStatus
  proposedBy:    string | null
  totalAmount:   string   // sum of the three period amounts, serialized
  warnings:      AdjustmentWarning[]
  createdAt:     Date
  updatedAt:     Date
}

/** Reviewer queue scoped to a single case. */
export async function getCaseReviewerQueue(caseId: string): Promise<ReviewerQueueRow[]> {
  await requireCaseAccess(caseId, 'case:read')
  const rows = await prisma.addBack.findMany({
    where: { caseId, status: { in: ['PROPOSED', 'NEEDS_SUPPORT'] } },
    orderBy: [{ status: 'asc' }, { updatedAt: 'asc' }],
    include: {
      case: { select: { name: true } },
      _count: { select: { citations: true } },
    },
  })
  return rows.map(rowToQueue)
}

/**
 * Reviewer queue scoped to every case in the caller's org. Ready for a
 * future dashboard; not yet wired to UI in Slice 10.
 */
export async function getOrgReviewerQueue(): Promise<ReviewerQueueRow[]> {
  const { requireOrganization } = await import('@/lib/authz')
  const session = await requireOrganization()
  const rows = await prisma.addBack.findMany({
    where: {
      status: { in: ['PROPOSED', 'NEEDS_SUPPORT'] },
      case: { organizationId: session.organizationId },
    },
    orderBy: [{ status: 'asc' }, { updatedAt: 'asc' }],
    include: {
      case: { select: { name: true } },
      _count: { select: { citations: true } },
    },
  })
  return rows.map(rowToQueue)
}

function rowToQueue(row: any): ReviewerQueueRow {
  const y2 = readMoney(row, 'year2') ?? money(0)
  const y1 = readMoney(row, 'year1') ?? money(0)
  const tm = readMoney(row, 'ttm')   ?? money(0)
  const total = moneySum([y2, y1, tm])
  return {
    id:          row.id,
    caseId:      row.caseId,
    caseName:    row.case?.name ?? 'Unknown case',
    category:    row.category,
    description: row.description,
    status:      row.status,
    proposedBy:  row.proposedBy,
    totalAmount: serializeMoney(total) ?? '0',
    warnings:    warningsFor({
      rationale:     row.rationale,
      citationCount: row._count?.citations ?? 0,
      amounts:       { year2: y2, year1: y1, ttm: tm },
      taxTreatment:  row.taxTreatment,
      recurring:     row.recurring,
      status:        row.status,
    }),
    createdAt:   row.createdAt,
    updatedAt:   row.updatedAt,
  }
}

// Keep the PERIODS export importable from this module for the UI.
export { PERIODS as ADJUSTMENT_PERIODS }
void NotFoundError  // keep import referenced for future extensions
