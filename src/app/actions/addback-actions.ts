'use server'

import { prisma } from '@/lib/prisma'
import { logAction } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { requireCaseAccess, requireAddBackAccess } from '@/lib/authz'
import { money } from '@/lib/money'

export async function getAddBacks(caseId: string) {
  await requireCaseAccess(caseId, 'case:read')
  return prisma.addBack.findMany({
    where: { caseId },
    orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
  })
}

export async function createAddBack(caseId: string, data: {
  category: string
  description: string
  year2?: number | null
  year1?: number | null
  ttm?: number | null
  rationale?: string
  aiSuggested?: boolean
  confidence?: number
}) {
  const { session } = await requireCaseAccess(caseId, 'addback:write')

  const record = await prisma.addBack.create({
    data: {
      caseId,
      category:    data.category,
      description: data.description,
      // Float legacy columns (kept for UI display during migration)
      year2:       data.year2 ?? null,
      year1:       data.year1 ?? null,
      ttm:         data.ttm  ?? null,
      // Slice 4 authoritative decimals
      year2Decimal: data.year2 != null ? money(data.year2) : null,
      year1Decimal: data.year1 != null ? money(data.year1) : null,
      ttmDecimal:   data.ttm   != null ? money(data.ttm)   : null,
      rationale:   data.rationale ?? null,
      aiSuggested: data.aiSuggested ?? false,
      confidence:  data.confidence  ?? null,
    },
  })
  await logAction({
    userId: session.userId, action: 'CREATE_ADDBACK', caseId,
    targetModel: 'AddBack', targetId: record.id,
    note: `${data.category}: ${data.description}`,
  })
  revalidatePath(`/projects/${caseId}`)
  return record
}

export async function updateAddBack(id: string, data: {
  category?: string
  description?: string
  year2?: number | null
  year1?: number | null
  ttm?: number | null
  rationale?: string
}) {
  const { session, addBack: before } = await requireAddBackAccess(id, 'addback:write')

  const updated = await prisma.addBack.update({
    where: { id },
    data: {
      category:    data.category    ?? undefined,
      description: data.description ?? undefined,
      // Float legacy — undefined leaves the column unchanged; explicit null clears it.
      year2:       data.year2,
      year1:       data.year1,
      ttm:         data.ttm,
      // Slice 4 authoritative decimal mirrors — same tri-state semantics.
      year2Decimal: data.year2 === undefined ? undefined : (data.year2 === null ? null : money(data.year2)),
      year1Decimal: data.year1 === undefined ? undefined : (data.year1 === null ? null : money(data.year1)),
      ttmDecimal:   data.ttm   === undefined ? undefined : (data.ttm   === null ? null : money(data.ttm)),
      rationale:   data.rationale   ?? undefined,
    },
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_ADDBACK', caseId: before.caseId,
    targetModel: 'AddBack', targetId: id,
    oldValue: { year2: before.year2, year1: before.year1, ttm: before.ttm },
    newValue: { year2: data.year2, year1: data.year1, ttm: data.ttm },
  })
  revalidatePath(`/projects/${before.caseId}`)
  return updated
}

export async function deleteAddBack(id: string) {
  const { session, addBack: record } = await requireAddBackAccess(id, 'addback:write')

  await prisma.addBack.delete({ where: { id } })
  await logAction({
    userId: session.userId, action: 'DELETE_ADDBACK', caseId: record.caseId,
    targetModel: 'AddBack', targetId: id,
    note: record.description,
  })
  revalidatePath(`/projects/${record.caseId}`)
}

export async function approveAddBack(id: string) {
  const { session, addBack: record } = await requireAddBackAccess(id, 'addback:approve')

  // Slice 10 backward-compat: this legacy toggle sits alongside the
  // workbench's status machine. Both columns are updated together so
  // any reader (old or new) sees a consistent view.
  const nextApproved = !record.isApproved
  const now = new Date()
  const updated = await prisma.addBack.update({
    where: { id },
    data: {
      isApproved: nextApproved,
      approvedBy: session.userId,
      status:          nextApproved ? 'APPROVED' : 'DRAFT',
      reviewedBy:      nextApproved ? session.userId : null,
      reviewedAt:      nextApproved ? now            : null,
      statusChangedAt: now,
    },
  })
  await logAction({
    userId: session.userId,
    action: updated.isApproved ? 'APPROVE_ADDBACK' : 'UNAPPROVE_ADDBACK',
    caseId: record.caseId,
    targetModel: 'AddBack', targetId: id,
    note: record.description,
  })
  revalidatePath(`/projects/${record.caseId}`)
  return updated
}
