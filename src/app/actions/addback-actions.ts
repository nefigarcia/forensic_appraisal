'use server'

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { guardAction } from '@/lib/rbac'
import { logAction } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

export async function getAddBacks(caseId: string) {
  const session = await getSession()
  guardAction(session, 'case:read')
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
  const session = await getSession()
  guardAction(session, 'addback:write')

  const record = await prisma.addBack.create({
    data: {
      caseId,
      category:    data.category,
      description: data.description,
      year2:       data.year2 ?? null,
      year1:       data.year1 ?? null,
      ttm:         data.ttm  ?? null,
      rationale:   data.rationale ?? null,
      aiSuggested: data.aiSuggested ?? false,
      confidence:  data.confidence  ?? null,
    },
  })
  await logAction({
    userId: session!.userId, action: 'CREATE_ADDBACK', caseId,
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
  const session = await getSession()
  guardAction(session, 'addback:write')

  const before = await prisma.addBack.findUnique({ where: { id } })
  const updated = await prisma.addBack.update({
    where: { id },
    data: {
      category:    data.category    ?? undefined,
      description: data.description ?? undefined,
      year2:       data.year2,
      year1:       data.year1,
      ttm:         data.ttm,
      rationale:   data.rationale   ?? undefined,
    },
  })
  await logAction({
    userId: session!.userId, action: 'UPDATE_ADDBACK', caseId: before?.caseId,
    targetModel: 'AddBack', targetId: id,
    oldValue: { year2: before?.year2, year1: before?.year1, ttm: before?.ttm },
    newValue: { year2: data.year2, year1: data.year1, ttm: data.ttm },
  })
  revalidatePath(`/projects/${before?.caseId}`)
  return updated
}

export async function deleteAddBack(id: string) {
  const session = await getSession()
  guardAction(session, 'addback:write')

  const record = await prisma.addBack.findUnique({ where: { id } })
  await prisma.addBack.delete({ where: { id } })
  await logAction({
    userId: session!.userId, action: 'DELETE_ADDBACK', caseId: record?.caseId,
    targetModel: 'AddBack', targetId: id,
    note: record?.description,
  })
  revalidatePath(`/projects/${record?.caseId}`)
}

export async function approveAddBack(id: string) {
  const session = await getSession()
  guardAction(session, 'addback:approve')

  const record = await prisma.addBack.findUnique({ where: { id } })
  const updated = await prisma.addBack.update({
    where: { id },
    data: { isApproved: !record?.isApproved, approvedBy: session!.userId },
  })
  await logAction({
    userId: session!.userId,
    action: updated.isApproved ? 'APPROVE_ADDBACK' : 'UNAPPROVE_ADDBACK',
    caseId: record?.caseId,
    targetModel: 'AddBack', targetId: id,
    note: record?.description,
  })
  revalidatePath(`/projects/${record?.caseId}`)
  return updated
}
