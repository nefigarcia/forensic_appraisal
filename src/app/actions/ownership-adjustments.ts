'use server'

/**
 * OwnershipAdjustment (DLOC / DLOM / others) server actions.
 *
 * Slice-13 invariant: **discounts NEVER auto-apply**. Approval requires
 *   - explicit professional input (rationale non-empty),
 *   - a documented source,
 *   - `value:approve_batch` permission on the case,
 *   - a reviewer distinct from the proposer.
 * These are enforced here at the action layer AND at the math-library
 * boundary (`applyOwnershipDiscounts` throws on any non-APPROVED row).
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError, ForbiddenError } from '@/lib/authz'
import {
  isAssumptionStatus,
  isOwnershipAdjustmentKind,
  OWNERSHIP_KIND_LABEL,
  type AssumptionStatus,
  type OwnershipAdjustmentKind,
} from '@/lib/valuation-v2/statuses'

export interface OwnershipAdjustmentForClient {
  id:               string
  engagementId:     string
  kind:             OwnershipAdjustmentKind
  kindLabel:        string
  label:            string | null
  percent:          string
  ownershipPercent: string | null
  source:           string | null
  rationale:        string | null
  status:           AssumptionStatus
  proposedBy:       string | null
  approvedBy:       string | null
  approvedAt:       Date | null
  rejectedBy:       string | null
  rejectedAt:       Date | null
  rejectionNote:    string | null
  supersededBy:     string | null
  createdAt:        Date
  updatedAt:        Date
}

export async function getOwnershipAdjustments(engagementId: string): Promise<OwnershipAdjustmentForClient[]> {
  const eng = await prisma.valuationEngagement.findUnique({
    where: { id: engagementId }, select: { caseId: true },
  })
  if (!eng) throw new NotFoundError()
  await requireCaseAccess(eng.caseId, 'case:read')
  const rows = await prisma.ownershipAdjustment.findMany({
    where:   { engagementId },
    orderBy: [{ status: 'asc' }, { kind: 'asc' }, { createdAt: 'desc' }],
  })
  return rows.map(r => ({
    id: r.id, engagementId: r.engagementId,
    kind: r.kind as OwnershipAdjustmentKind,
    kindLabel: OWNERSHIP_KIND_LABEL[r.kind as OwnershipAdjustmentKind] ?? r.kind,
    label: r.label,
    percent: r.percent.toString(),
    ownershipPercent: r.ownershipPercent?.toString() ?? null,
    source: r.source, rationale: r.rationale,
    status: r.status as AssumptionStatus,
    proposedBy: r.proposedBy, approvedBy: r.approvedBy, approvedAt: r.approvedAt,
    rejectedBy: r.rejectedBy, rejectedAt: r.rejectedAt, rejectionNote: r.rejectionNote,
    supersededBy: r.supersededBy,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  }))
}

export async function createOwnershipAdjustment(input: {
  engagementId:     string
  kind:             string
  label?:           string
  percent:          string      // '0.30' for 30 %
  ownershipPercent?: string
  source?:          string
  rationale?:       string
}): Promise<{ id: string }> {
  if (!isOwnershipAdjustmentKind(input.kind)) throw new Error(`Unknown ownership kind: ${input.kind}`)
  const eng = await prisma.valuationEngagement.findUnique({
    where: { id: input.engagementId }, select: { caseId: true },
  })
  if (!eng) throw new NotFoundError()
  const { session } = await requireCaseAccess(eng.caseId, 'valuation:write')

  const created = await prisma.ownershipAdjustment.create({
    data: {
      engagementId: input.engagementId,
      kind:         input.kind,
      label:        input.label?.trim() ?? null,
      percent:      input.percent,
      ownershipPercent: input.ownershipPercent ?? null,
      source:       input.source?.trim() ?? null,
      rationale:    input.rationale?.trim() ?? null,
      status:       'DRAFT',
      proposedBy:   session.userId,
    },
  })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: eng.caseId, targetModel: 'OwnershipAdjustment', targetId: created.id,
    note: `created ${input.kind} adjustment`,
  })
  revalidatePath(`/projects/${eng.caseId}`)
  return { id: created.id }
}

export async function updateOwnershipAdjustment(input: {
  id:        string
  label?:    string
  percent?:  string
  ownershipPercent?: string | null
  source?:   string
  rationale?: string
}): Promise<void> {
  const row = await prisma.ownershipAdjustment.findUnique({
    where: { id: input.id },
    include: { engagement: { select: { caseId: true } } },
  })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.engagement.caseId, 'valuation:write')
  if (row.status === 'APPROVED' || row.status === 'SUPERSEDED') {
    throw new Error(`Cannot edit ownership adjustment in status ${row.status}. Supersede it with a new row.`)
  }
  const data: Record<string, unknown> = {}
  if (input.label     !== undefined) data.label = input.label
  if (input.percent   !== undefined) data.percent = input.percent
  if (input.ownershipPercent !== undefined) data.ownershipPercent = input.ownershipPercent
  if (input.source    !== undefined) data.source = input.source
  if (input.rationale !== undefined) data.rationale = input.rationale
  await prisma.ownershipAdjustment.update({ where: { id: row.id }, data })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: row.engagement.caseId,
    targetModel: 'OwnershipAdjustment', targetId: row.id,
    note: 'ownership adjustment updated',
  })
  revalidatePath(`/projects/${row.engagement.caseId}`)
}

export async function changeOwnershipAdjustmentStatus(input: {
  id:   string
  next: string
  note?: string
}): Promise<void> {
  if (!isAssumptionStatus(input.next)) throw new Error(`Unknown status: ${input.next}`)
  const row = await prisma.ownershipAdjustment.findUnique({
    where: { id: input.id },
    include: { engagement: { select: { caseId: true } } },
  })
  if (!row) throw new NotFoundError()

  const from = row.status as AssumptionStatus
  const to   = input.next as AssumptionStatus
  if (from === to) return

  // Reuse the assumption state machine — DLOC/DLOM lifecycle matches.
  const { ALLOWED_ASSUMPTION_TRANSITIONS, assumptionTransitionRequiresNote } = await import('@/lib/valuation-v2/statuses')
  if (!ALLOWED_ASSUMPTION_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid ownership adjustment transition: ${from} → ${to}`)
  }
  if (assumptionTransitionRequiresNote(to) && !input.note?.trim()) {
    throw new Error(`Transition to ${to} requires a note`)
  }

  if (to === 'APPROVED') {
    if (!row.rationale || row.rationale.trim().length === 0) {
      throw new Error('APPROVE requires a non-empty rationale')
    }
    if (!row.source || row.source.trim().length === 0) {
      throw new Error('APPROVE requires a documented source (Rev. Rul. 59-60, Mandelbaum, restricted-stock study, etc.)')
    }
  }

  const { session } = await requireCaseAccess(
    row.engagement.caseId,
    to === 'APPROVED' ? 'value:approve_batch' : 'valuation:write',
  )
  if (to === 'APPROVED' && row.proposedBy && row.proposedBy === session.userId) {
    throw new ForbiddenError(
      'The proposer of an ownership discount cannot approve it. A separate reviewer must approve.',
    )
  }

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const data: Record<string, unknown> = { status: to }
    if (to === 'APPROVED') {
      data.approvedBy = session.userId
      data.approvedAt = now
      // Auto-supersede any older APPROVED row with the same kind.
      const older = await tx.ownershipAdjustment.findMany({
        where: {
          engagementId: row.engagementId,
          kind:         row.kind,
          status:       'APPROVED',
          id:           { not: row.id },
        },
        select: { id: true },
      })
      for (const o of older) {
        await tx.ownershipAdjustment.update({
          where: { id: o.id },
          data:  { status: 'SUPERSEDED', supersededBy: row.id },
        })
      }
    } else if (to === 'REJECTED') {
      data.rejectedBy = session.userId; data.rejectedAt = now
      data.rejectionNote = input.note ?? null
    } else if (to === 'DRAFT') {
      data.approvedBy = null; data.approvedAt = null
      data.rejectedBy = null; data.rejectedAt = null; data.rejectionNote = null
    }
    await tx.ownershipAdjustment.update({ where: { id: row.id }, data })
  })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: row.engagement.caseId,
    targetModel: 'OwnershipAdjustment', targetId: row.id,
    oldValue: { status: from }, newValue: { status: to },
    note: input.note?.slice(0, 200),
  })
  revalidatePath(`/projects/${row.engagement.caseId}`)
}
