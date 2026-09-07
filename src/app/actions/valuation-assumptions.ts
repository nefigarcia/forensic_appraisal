'use server'

/**
 * ValuationAssumption + AssumptionEvent server actions.
 *
 * Enforces the Slice-13 invariants:
 *   - state-machine transitions only (see `ALLOWED_ASSUMPTION_TRANSITIONS`)
 *   - `APPROVED` requires a rationale AND a reviewer distinct-from-the
 *     proposer (see rationale)
 *   - approving a new value with the same `key` supersedes any older
 *     APPROVED row atomically
 *   - every transition writes an append-only AssumptionEvent
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError, ForbiddenError } from '@/lib/authz'
import {
  ASSUMPTION_STATUSES, ALLOWED_ASSUMPTION_TRANSITIONS,
  canAssumptionTransition, assumptionTransitionRequiresNote,
  isAssumptionStatus,
  type AssumptionStatus,
} from '@/lib/valuation-v2/statuses'
import {
  writeAssumptionEvent, eventForTransition,
} from '@/lib/valuation-v2/assumption-events'

// ─────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────

export interface AssumptionForClient {
  id:            string
  engagementId:  string
  targetType:    string
  targetId:      string | null
  key:           string
  label:         string
  category:      string | null
  valueString:   string | null
  valueNumeric:  string | null
  unit:          string | null
  source:        string | null
  rationale:     string | null
  status:        AssumptionStatus
  proposedBy:    string | null
  approvedBy:    string | null
  approvedAt:    Date | null
  rejectedBy:    string | null
  rejectedAt:    Date | null
  rejectionNote: string | null
  supersededBy:  string | null
  createdAt:     Date
  updatedAt:     Date
}

export async function getAssumptionsForEngagement(engagementId: string): Promise<AssumptionForClient[]> {
  const eng = await prisma.valuationEngagement.findUnique({
    where: { id: engagementId }, select: { caseId: true },
  })
  if (!eng) throw new NotFoundError()
  await requireCaseAccess(eng.caseId, 'case:read')
  const rows = await prisma.valuationAssumption.findMany({
    where:   { engagementId },
    orderBy: [{ status: 'asc' }, { key: 'asc' }, { createdAt: 'desc' }],
  })
  return rows.map(r => ({
    id: r.id, engagementId: r.engagementId,
    targetType: r.targetType, targetId: r.targetId,
    key: r.key, label: r.label, category: r.category,
    valueString: r.valueString,
    valueNumeric: r.valueNumeric?.toString() ?? null,
    unit: r.unit, source: r.source, rationale: r.rationale,
    status: r.status as AssumptionStatus,
    proposedBy: r.proposedBy, approvedBy: r.approvedBy, approvedAt: r.approvedAt,
    rejectedBy: r.rejectedBy, rejectedAt: r.rejectedAt, rejectionNote: r.rejectionNote,
    supersededBy: r.supersededBy,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  }))
}

// ─────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────

export interface CreateAssumptionInput {
  engagementId: string
  targetType:   string          // ENGAGEMENT | SCENARIO | APPROACH | DCF_YEAR | ...
  targetId?:    string
  key:          string
  label:        string
  category?:    string
  valueString?: string
  valueNumeric?: string        // pass through — Prisma accepts string for Decimal
  unit?:        string
  source?:      string
  rationale?:   string
}

export async function createAssumption(input: CreateAssumptionInput): Promise<{ id: string }> {
  if (!input.key.trim()) throw new Error('key required')
  if (!input.label.trim()) throw new Error('label required')
  const eng = await prisma.valuationEngagement.findUnique({
    where: { id: input.engagementId }, select: { caseId: true },
  })
  if (!eng) throw new NotFoundError()
  const { session } = await requireCaseAccess(eng.caseId, 'valuation:write')

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.valuationAssumption.create({
      data: {
        engagementId: input.engagementId,
        targetType:   input.targetType,
        targetId:     input.targetId ?? null,
        key:          input.key.trim(),
        label:        input.label.trim(),
        category:     input.category ?? null,
        valueString:  input.valueString ?? null,
        valueNumeric: input.valueNumeric ?? null,
        unit:         input.unit ?? null,
        source:       input.source ?? null,
        rationale:    input.rationale ?? null,
        status:       'DRAFT',
        proposedBy:   session.userId,
      },
    })
    await writeAssumptionEvent(tx, {
      assumptionId: row.id, action: 'CREATE', userId: session.userId,
      newValue: {
        value: input.valueString ?? input.valueNumeric ?? null,
        unit:  input.unit ?? null,
      },
    })
    return row
  })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: eng.caseId, targetModel: 'ValuationAssumption', targetId: created.id,
    note: `created assumption: ${input.key}`,
  })
  revalidatePath(`/projects/${eng.caseId}`)
  return { id: created.id }
}

export async function updateAssumptionValue(input: {
  id:            string
  valueString?:  string
  valueNumeric?: string
  unit?:         string
  source?:       string
  rationale?:    string
}): Promise<void> {
  const row = await prisma.valuationAssumption.findUnique({
    where: { id: input.id },
    include: { engagement: { select: { caseId: true } } },
  })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.engagement.caseId, 'valuation:write')
  if (row.status === 'APPROVED' || row.status === 'SUPERSEDED') {
    // Approved rows are frozen — edits require a fresh row (SUPERSEDE
    // pathway). This mirrors GAAP work-paper hygiene.
    throw new Error(
      `Cannot edit assumption in status ${row.status}. Create a new assumption to supersede this one.`,
    )
  }
  await prisma.$transaction(async (tx) => {
    const oldValue = {
      valueString: row.valueString, valueNumeric: row.valueNumeric?.toString() ?? null,
      unit: row.unit, source: row.source, rationale: row.rationale,
    }
    await tx.valuationAssumption.update({
      where: { id: row.id },
      data: {
        valueString:  input.valueString  ?? row.valueString,
        valueNumeric: input.valueNumeric ?? undefined,
        unit:         input.unit         ?? row.unit,
        source:       input.source       ?? row.source,
        rationale:    input.rationale    ?? row.rationale,
      },
    })
    await writeAssumptionEvent(tx, {
      assumptionId: row.id, action: 'UPDATE_VALUE',
      userId: session.userId, oldValue,
      newValue: {
        valueString:  input.valueString  ?? row.valueString,
        valueNumeric: input.valueNumeric ?? (row.valueNumeric?.toString() ?? null),
        unit:         input.unit         ?? row.unit,
      },
    })
  })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: row.engagement.caseId, targetModel: 'ValuationAssumption', targetId: row.id,
    note: 'assumption value updated',
  })
  revalidatePath(`/projects/${row.engagement.caseId}`)
}

export async function changeAssumptionStatus(input: {
  id:   string
  next: string
  note?: string
}): Promise<void> {
  if (!isAssumptionStatus(input.next)) throw new Error(`Unknown status: ${input.next}`)
  const row = await prisma.valuationAssumption.findUnique({
    where: { id: input.id },
    include: { engagement: { select: { caseId: true } } },
  })
  if (!row) throw new NotFoundError()

  const from = row.status as AssumptionStatus
  const to   = input.next as AssumptionStatus
  if (from === to) return
  if (!canAssumptionTransition(from, to)) {
    throw new Error(`Invalid assumption transition: ${from} → ${to}`)
  }
  if (assumptionTransitionRequiresNote(to) && !input.note?.trim()) {
    throw new Error(`Transition to ${to} requires a note`)
  }

  // APPROVED requires:
  //   - rationale non-empty on the row
  //   - value:approve_batch or value:override permission (the tighter of the two
  //     "reviewer" permissions we already gate on for financials)
  //   - reviewer distinct from proposer (Rule 12 — no self-approval).
  if (to === 'APPROVED') {
    if (!row.rationale || row.rationale.trim().length === 0) {
      throw new Error('APPROVE requires a non-empty rationale')
    }
  }
  const { session } = await requireCaseAccess(
    row.engagement.caseId,
    to === 'APPROVED' ? 'value:approve_batch' : 'valuation:write',
  )
  if (to === 'APPROVED' && row.proposedBy && row.proposedBy === session.userId) {
    throw new ForbiddenError(
      'The proposer of an assumption cannot approve it. A separate reviewer must approve.',
    )
  }

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const data: Record<string, unknown> = { status: to }
    if (to === 'APPROVED') {
      data.approvedBy = session.userId
      data.approvedAt = now
      // Automatically supersede any older APPROVED row with the same key.
      const older = await tx.valuationAssumption.findMany({
        where: {
          engagementId: row.engagementId,
          key:          row.key,
          status:       'APPROVED',
          id:           { not: row.id },
        },
        select: { id: true },
      })
      for (const o of older) {
        await tx.valuationAssumption.update({
          where: { id: o.id },
          data:  { status: 'SUPERSEDED', supersededBy: row.id },
        })
        await writeAssumptionEvent(tx, {
          assumptionId: o.id, action: 'SUPERSEDE',
          userId: session.userId, note: `superseded by ${row.id}`,
        })
      }
    } else if (to === 'REJECTED') {
      data.rejectedBy = session.userId
      data.rejectedAt = now
      data.rejectionNote = input.note ?? null
    } else if (to === 'PROPOSED') {
      if (!row.proposedBy) data.proposedBy = session.userId
      data.rejectedBy = null; data.rejectedAt = null; data.rejectionNote = null
    } else if (to === 'DRAFT') {
      // Reopening — clear reviewer verdict.
      data.approvedBy = null; data.approvedAt = null
      data.rejectedBy = null; data.rejectedAt = null; data.rejectionNote = null
    }
    await tx.valuationAssumption.update({ where: { id: row.id }, data })
    await writeAssumptionEvent(tx, {
      assumptionId: row.id,
      action: eventForTransition(from, to),
      userId: session.userId,
      oldValue: { status: from },
      newValue: { status: to },
      note: input.note,
    })
  })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: row.engagement.caseId,
    targetModel: 'ValuationAssumption', targetId: row.id,
    oldValue: { status: from }, newValue: { status: to },
    note: input.note?.slice(0, 200),
  })
  revalidatePath(`/projects/${row.engagement.caseId}`)
}

// ensure ASSUMPTION_STATUSES is a value used somewhere.
void ASSUMPTION_STATUSES
void ALLOWED_ASSUMPTION_TRANSITIONS
