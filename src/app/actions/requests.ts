'use server'

/**
 * Firm-side server actions for the client-request workflow.
 *
 * Every action inherits Slice-1 tenant scoping and (if the case has
 * `hasEngagementTeam=true`) the Slice-11 engagement gate via
 * `requireCaseAccess`. Portal-side actions live in
 * `src/app/actions/portal.ts` and NEVER share a code path with these —
 * that separation is the load-bearing invariant of the portal design.
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError } from '@/lib/authz'
import {
  REQUEST_ITEM_STATUSES,
  ALLOWED_REQUEST_ITEM_TRANSITIONS,
  canRequestItemTransition,
  requestItemTransitionRequiresNote,
  classifyForDashboard,
  REQUEST_ITEM_SORT_ORDER,
  REQUEST_ITEM_STATUS_LABEL,
  isRequestListStatus,
  type RequestItemStatus,
} from '@/lib/requests/statuses'
import {
  isRequestItemCategory,
  isRequestItemPriority,
  REQUEST_ITEM_CATEGORY_LABEL,
  type RequestItemCategory,
  type RequestItemPriority,
} from '@/lib/requests/categories'
import { SEED_TEMPLATES, findSeedTemplate } from '@/lib/requests/templates-seed'

// ─────────────────────────────────────────────────
// Client shapes
// ─────────────────────────────────────────────────

export interface RequestItemForClient {
  id:               string
  requestListId:    string
  caseId:           string
  title:            string
  description:      string | null
  category:         RequestItemCategory | null
  categoryLabel:    string | null
  requestedFrom:    string | null
  dueDate:          Date | null
  priority:         RequestItemPriority
  status:           RequestItemStatus
  statusLabel:      string
  assignedToUserId: string | null
  reviewerUserId:   string | null
  notes:            string | null
  clarificationNote:string | null
  aiCompleteness:   string | null
  aiCompletenessConfident: boolean
  aiCompletenessNote: string | null
  documentCount:    number
  displayOrder:     number
  createdAt:        Date
  updatedAt:        Date
}

export interface RequestListForClient {
  id:          string
  caseId:      string
  title:       string
  description: string | null
  status:      'DRAFT' | 'SENT' | 'CLOSED'
  createdBy:   string
  templateId:  string | null
  sentAt:      Date | null
  closedAt:    Date | null
  createdAt:   Date
  updatedAt:   Date
  itemCount:   number
}

export interface RequestListDashboard {
  received:      number
  clarification: number
  outstanding:   number
  totalTracked:  number   // received + clarification + outstanding (excludes NOT_REQUESTED/NOT_APPLICABLE)
  notApplicable: number
  notRequested:  number
}

// ─────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────

export async function getRequestListsForCase(caseId: string): Promise<RequestListForClient[]> {
  await requireCaseAccess(caseId, 'case:read')
  const rows = await prisma.requestList.findMany({
    where:   { caseId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { items: true } } },
  })
  return rows.map((r): RequestListForClient => ({
    id:          r.id,
    caseId:      r.caseId,
    title:       r.title,
    description: r.description,
    status:      r.status as 'DRAFT' | 'SENT' | 'CLOSED',
    createdBy:   r.createdBy,
    templateId:  r.templateId,
    sentAt:      r.sentAt,
    closedAt:    r.closedAt,
    createdAt:   r.createdAt,
    updatedAt:   r.updatedAt,
    itemCount:   r._count.items,
  }))
}

export async function getRequestItems(requestListId: string): Promise<RequestItemForClient[]> {
  const list = await prisma.requestList.findUnique({
    where: { id: requestListId }, select: { caseId: true },
  })
  if (!list) throw new NotFoundError()
  await requireCaseAccess(list.caseId, 'case:read')

  const rows = await prisma.requestItem.findMany({
    where: { requestListId },
    include: { _count: { select: { documents: true } } },
  })
  const shaped: RequestItemForClient[] = rows.map(r => ({
    id:               r.id,
    requestListId:    r.requestListId,
    caseId:           r.caseId,
    title:            r.title,
    description:      r.description,
    category:         (r.category ?? null) as RequestItemCategory | null,
    categoryLabel:    r.category ? (REQUEST_ITEM_CATEGORY_LABEL[r.category as RequestItemCategory] ?? r.category) : null,
    requestedFrom:    r.requestedFrom,
    dueDate:          r.dueDate,
    priority:         r.priority as RequestItemPriority,
    status:           r.status as RequestItemStatus,
    statusLabel:      REQUEST_ITEM_STATUS_LABEL[r.status as RequestItemStatus] ?? r.status,
    assignedToUserId: r.assignedToUserId,
    reviewerUserId:   r.reviewerUserId,
    notes:            r.notes,
    clarificationNote:r.clarificationNote,
    aiCompleteness:   r.aiCompleteness,
    aiCompletenessConfident: r.aiCompletenessConfident,
    aiCompletenessNote: r.aiCompletenessNote,
    documentCount:    r._count.documents,
    displayOrder:     r.displayOrder,
    createdAt:        r.createdAt,
    updatedAt:        r.updatedAt,
  }))
  shaped.sort((a, b) => {
    const sa = REQUEST_ITEM_SORT_ORDER[a.status] ?? 99
    const sb = REQUEST_ITEM_SORT_ORDER[b.status] ?? 99
    if (sa !== sb) return sa - sb
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
  return shaped
}

export async function getRequestDashboard(caseId: string): Promise<RequestListDashboard> {
  await requireCaseAccess(caseId, 'case:read')
  const rows = await prisma.requestItem.groupBy({
    by:      ['status'],
    where:   { caseId },
    _count:  { _all: true },
  })
  const out: RequestListDashboard = {
    received: 0, clarification: 0, outstanding: 0,
    totalTracked: 0, notApplicable: 0, notRequested: 0,
  }
  for (const row of rows) {
    const bucket = classifyForDashboard(row.status as RequestItemStatus)
    const n = row._count._all
    if (bucket === 'received')       out.received      += n
    else if (bucket === 'clarification') out.clarification += n
    else if (bucket === 'outstanding')   out.outstanding   += n
    else if (row.status === 'NOT_APPLICABLE') out.notApplicable += n
    else if (row.status === 'NOT_REQUESTED')  out.notRequested  += n
  }
  out.totalTracked = out.received + out.clarification + out.outstanding
  return out
}

// ─────────────────────────────────────────────────
// Mutations — RequestList
// ─────────────────────────────────────────────────

export async function createRequestList(input: {
  caseId:      string
  title:       string
  description?: string
  templateId?: string    // firm-owned RequestTemplate id
  seedKey?:    string    // built-in seed template key
}): Promise<{ id: string; itemCount: number }> {
  const title = input.title?.trim()
  if (!title) throw new Error('Title required')
  const { session } = await requireCaseAccess(input.caseId, 'value:accept')

  let templateId: string | null = null
  let itemsData: Array<{
    title: string; description: string | null; category: string | null;
    priority: string; displayOrder: number;
  }> = []

  if (input.templateId) {
    const tmpl = await prisma.requestTemplate.findFirst({
      where: { id: input.templateId, organizationId: session.organizationId },
      include: { items: { orderBy: { displayOrder: 'asc' } } },
    })
    if (!tmpl) throw new NotFoundError()
    templateId = tmpl.id
    itemsData  = tmpl.items.map((it, i) => ({
      title: it.title, description: it.description ?? null,
      category: it.category, priority: it.priority, displayOrder: it.displayOrder || i,
    }))
  } else if (input.seedKey) {
    const seed = findSeedTemplate(input.seedKey)
    if (!seed) throw new NotFoundError()
    itemsData = seed.items.map((it, i) => ({
      title: it.title, description: it.description ?? null,
      category: it.category, priority: it.priority, displayOrder: i,
    }))
  }

  const created = await prisma.$transaction(async (tx) => {
    const list = await tx.requestList.create({
      data: {
        caseId:      input.caseId,
        title,
        description: input.description?.trim() ?? null,
        status:      'DRAFT',
        createdBy:   session.userId,
        templateId,
      },
    })
    if (itemsData.length > 0) {
      await tx.requestItem.createMany({
        data: itemsData.map(i => ({
          requestListId: list.id,
          caseId:        input.caseId,
          title:         i.title,
          description:   i.description,
          category:      i.category,
          priority:      i.priority,
          displayOrder:  i.displayOrder,
          status:        'NOT_REQUESTED',
        })),
      })
    }
    return { id: list.id, count: itemsData.length }
  })

  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: input.caseId,
    targetModel: 'RequestList', targetId: created.id,
    note: `created request list: ${title.slice(0, 100)}`,
  })
  revalidatePath(`/projects/${input.caseId}`)
  return { id: created.id, itemCount: created.count }
}

export async function markRequestListSent(input: { requestListId: string }): Promise<void> {
  const list = await prisma.requestList.findUnique({
    where: { id: input.requestListId }, select: { id: true, caseId: true, status: true },
  })
  if (!list) throw new NotFoundError()
  const { session } = await requireCaseAccess(list.caseId, 'value:accept')
  if (list.status === 'CLOSED') throw new Error('List is closed')

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.requestList.update({
      where: { id: list.id },
      data:  { status: 'SENT', sentAt: list.status === 'DRAFT' ? now : undefined },
    })
    // Any items still NOT_REQUESTED become REQUESTED — clients see them
    // as soon as the list is sent.
    await tx.requestItem.updateMany({
      where: { requestListId: list.id, status: 'NOT_REQUESTED' },
      data:  { status: 'REQUESTED', statusChangedAt: now },
    })
  })

  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: list.caseId, targetModel: 'RequestList', targetId: list.id,
    note: 'request list marked SENT',
  })
  revalidatePath(`/projects/${list.caseId}`)
}

export async function closeRequestList(input: { requestListId: string }): Promise<void> {
  const list = await prisma.requestList.findUnique({
    where: { id: input.requestListId }, select: { id: true, caseId: true },
  })
  if (!list) throw new NotFoundError()
  const { session } = await requireCaseAccess(list.caseId, 'value:accept')
  await prisma.requestList.update({
    where: { id: list.id },
    data:  { status: 'CLOSED', closedAt: new Date() },
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: list.caseId, targetModel: 'RequestList', targetId: list.id,
    note: 'request list closed',
  })
  revalidatePath(`/projects/${list.caseId}`)
}

// ─────────────────────────────────────────────────
// Mutations — RequestItem
// ─────────────────────────────────────────────────

export async function addRequestItem(input: {
  requestListId: string
  title:         string
  description?:  string
  category?:     string
  requestedFrom?: string
  dueDate?:      Date | null
  priority?:     string
  assignedToUserId?: string
  reviewerUserId?:   string
}): Promise<{ id: string }> {
  const title = input.title?.trim()
  if (!title) throw new Error('Title required')
  if (input.category != null && !isRequestItemCategory(input.category)) {
    throw new Error(`Unknown category: ${input.category}`)
  }
  const priority = input.priority ?? 'NORMAL'
  if (!isRequestItemPriority(priority)) {
    throw new Error(`Unknown priority: ${priority}`)
  }
  const list = await prisma.requestList.findUnique({
    where: { id: input.requestListId },
    select: { id: true, caseId: true, status: true },
  })
  if (!list) throw new NotFoundError()
  const { session } = await requireCaseAccess(list.caseId, 'value:accept')

  const initialStatus: RequestItemStatus = list.status === 'DRAFT' ? 'NOT_REQUESTED' : 'REQUESTED'
  const now = new Date()

  const created = await prisma.requestItem.create({
    data: {
      requestListId: list.id,
      caseId:        list.caseId,
      title,
      description:   input.description?.trim() ?? null,
      category:      input.category ?? null,
      requestedFrom: input.requestedFrom?.trim() ?? null,
      dueDate:       input.dueDate ?? null,
      priority,
      status:        initialStatus,
      assignedToUserId: input.assignedToUserId ?? null,
      reviewerUserId:   input.reviewerUserId ?? null,
      statusChangedAt: initialStatus === 'REQUESTED' ? now : null,
    },
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: list.caseId,
    targetModel: 'RequestItem', targetId: created.id,
    note: `added request item: ${title.slice(0, 100)}`,
  })
  revalidatePath(`/projects/${list.caseId}`)
  return { id: created.id }
}

export async function updateRequestItem(input: {
  id:             string
  title?:         string
  description?:   string | null
  category?:      string | null
  requestedFrom?: string | null
  dueDate?:       Date | null
  priority?:      string
  assignedToUserId?: string | null
  reviewerUserId?:   string | null
  notes?:         string | null
}): Promise<void> {
  const row = await prisma.requestItem.findUnique({ where: { id: input.id } })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.caseId, 'value:accept')

  if (input.category != null && !isRequestItemCategory(input.category)) {
    throw new Error(`Unknown category: ${input.category}`)
  }
  if (input.priority != null && !isRequestItemPriority(input.priority)) {
    throw new Error(`Unknown priority: ${input.priority}`)
  }

  const data: Record<string, unknown> = {}
  if (input.title != null)         data.title = input.title.trim()
  if (input.description !== undefined) data.description = input.description
  if (input.category !== undefined)    data.category = input.category
  if (input.requestedFrom !== undefined) data.requestedFrom = input.requestedFrom
  if (input.dueDate !== undefined)     data.dueDate = input.dueDate
  if (input.priority != null)          data.priority = input.priority
  if (input.assignedToUserId !== undefined) data.assignedToUserId = input.assignedToUserId
  if (input.reviewerUserId   !== undefined) data.reviewerUserId   = input.reviewerUserId
  if (input.notes            !== undefined) data.notes            = input.notes

  await prisma.requestItem.update({ where: { id: input.id }, data })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: row.caseId, targetModel: 'RequestItem', targetId: input.id,
    note: 'request item updated',
  })
  revalidatePath(`/projects/${row.caseId}`)
}

export async function changeRequestItemStatus(input: {
  id:   string
  next: string
  note?: string
}): Promise<void> {
  if (!(REQUEST_ITEM_STATUSES as readonly string[]).includes(input.next)) {
    throw new Error(`Unknown status: ${input.next}`)
  }
  const row = await prisma.requestItem.findUnique({ where: { id: input.id } })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.caseId, 'value:accept')

  const from = row.status as RequestItemStatus
  const to   = input.next as RequestItemStatus
  if (from === to) return
  if (!canRequestItemTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`)
  }
  if (requestItemTransitionRequiresNote(to) && !input.note?.trim()) {
    throw new Error(`Transition to ${to} requires a note`)
  }

  const now  = new Date()
  const data: Record<string, unknown> = {
    status: to,
    statusChangedAt: now,
  }
  if (to === 'NEEDS_CLARIFICATION') {
    data.clarificationNote = input.note?.trim() ?? null
  }

  await prisma.requestItem.update({ where: { id: input.id }, data })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: row.caseId, targetModel: 'RequestItem', targetId: input.id,
    oldValue: { status: from }, newValue: { status: to, note: input.note ?? null },
    note: input.note?.slice(0, 200),
  })

  // Log a ReminderEvent for CLARIFICATION so the client-portal timeline
  // knows to surface this to the client on next visit (or by future
  // real email transport).
  if (to === 'NEEDS_CLARIFICATION') {
    await prisma.reminderEvent.create({
      data: {
        caseId:        row.caseId,
        requestListId: row.requestListId,
        requestItemId: row.id,
        kind:          'CLARIFICATION',
        channel:       'INAPP',
        sentBy:        session.userId,
      },
    })
  }
  revalidatePath(`/projects/${row.caseId}`)
}

export async function deleteRequestItem(input: { id: string }): Promise<void> {
  const row = await prisma.requestItem.findUnique({ where: { id: input.id } })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.caseId, 'value:accept')
  await prisma.requestItem.delete({ where: { id: input.id } })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: row.caseId, targetModel: 'RequestItem', targetId: input.id,
    note: `deleted request item: ${row.title.slice(0, 100)}`,
  })
  revalidatePath(`/projects/${row.caseId}`)
}

// ─────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────

export interface RequestTemplateForClient {
  id:             string
  name:           string
  description:    string | null
  engagementType: string | null
  isSystem:       boolean
  itemCount:      number
  createdAt:      Date
  updatedAt:      Date
}

export async function listSeedTemplates() {
  // Returned to any authenticated firm user — no case scoping needed.
  return SEED_TEMPLATES.map(t => ({
    key:            t.key,
    name:           t.name,
    description:    t.description,
    engagementType: t.engagementType,
    itemCount:      t.items.length,
  }))
}

export async function listRequestTemplates(): Promise<RequestTemplateForClient[]> {
  const { session } = await requireCaseAccessForOrgListing()
  const rows = await prisma.requestTemplate.findMany({
    where: { organizationId: session.organizationId },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { items: true } } },
  })
  return rows.map(r => ({
    id: r.id, name: r.name, description: r.description,
    engagementType: r.engagementType, isSystem: r.isSystem,
    itemCount: r._count.items, createdAt: r.createdAt, updatedAt: r.updatedAt,
  }))
}

/**
 * Small helper — org-scoped listings don't fit `requireCaseAccess`, so
 * we call `requireSession` via a tiny wrapper. Kept local so this file
 * doesn't leak a general-purpose session helper.
 */
async function requireCaseAccessForOrgListing() {
  const { requireSession } = await import('@/lib/authz')
  const session = await requireSession()
  return { session }
}

export async function cloneSeedTemplate(input: { seedKey: string; nameOverride?: string }): Promise<{ id: string }> {
  const seed = findSeedTemplate(input.seedKey)
  if (!seed) throw new NotFoundError()
  const { session } = await requireCaseAccessForOrgListing()
  const created = await prisma.$transaction(async (tx) => {
    const tmpl = await tx.requestTemplate.create({
      data: {
        organizationId: session.organizationId,
        name:           input.nameOverride?.trim() || seed.name,
        description:    seed.description,
        engagementType: seed.engagementType,
        isSystem:       false,
        createdBy:      session.userId,
      },
    })
    await tx.requestTemplateItem.createMany({
      data: seed.items.map((it, i) => ({
        templateId:   tmpl.id,
        title:        it.title,
        description:  it.description ?? null,
        category:     it.category,
        priority:     it.priority,
        displayOrder: i,
      })),
    })
    return tmpl
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    targetModel: 'RequestTemplate', targetId: created.id,
    note: `cloned seed template ${seed.key}`,
  })
  return { id: created.id }
}

export async function createRequestTemplate(input: {
  name: string; description?: string; engagementType?: string
}): Promise<{ id: string }> {
  const name = input.name?.trim()
  if (!name) throw new Error('Name required')
  const { session } = await requireCaseAccessForOrgListing()
  const created = await prisma.requestTemplate.create({
    data: {
      organizationId: session.organizationId,
      name, description: input.description?.trim() ?? null,
      engagementType: input.engagementType?.trim() ?? null,
      isSystem: false,
      createdBy: session.userId,
    },
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    targetModel: 'RequestTemplate', targetId: created.id,
    note: `created request template: ${name.slice(0, 100)}`,
  })
  return { id: created.id }
}

export async function addRequestTemplateItem(input: {
  templateId: string
  title:      string
  description?: string
  category?:  string
  priority?:  string
}): Promise<{ id: string }> {
  const title = input.title?.trim()
  if (!title) throw new Error('Title required')
  if (input.category != null && !isRequestItemCategory(input.category)) {
    throw new Error(`Unknown category: ${input.category}`)
  }
  const priority = input.priority ?? 'NORMAL'
  if (!isRequestItemPriority(priority)) {
    throw new Error(`Unknown priority: ${priority}`)
  }
  const { session } = await requireCaseAccessForOrgListing()
  const tmpl = await prisma.requestTemplate.findFirst({
    where: { id: input.templateId, organizationId: session.organizationId },
    select: { id: true, isSystem: true },
  })
  if (!tmpl) throw new NotFoundError()
  if (tmpl.isSystem) throw new Error('Cannot edit a system template — clone it first')

  const count = await prisma.requestTemplateItem.count({ where: { templateId: tmpl.id } })
  const created = await prisma.requestTemplateItem.create({
    data: {
      templateId:  tmpl.id,
      title,
      description: input.description?.trim() ?? null,
      category:    input.category ?? null,
      priority,
      displayOrder: count,
    },
  })
  return { id: created.id }
}

export async function deleteRequestTemplate(input: { id: string }): Promise<void> {
  const { session } = await requireCaseAccessForOrgListing()
  const tmpl = await prisma.requestTemplate.findFirst({
    where: { id: input.id, organizationId: session.organizationId },
    select: { id: true, isSystem: true },
  })
  if (!tmpl) throw new NotFoundError()
  if (tmpl.isSystem) throw new Error('Cannot delete a system template')
  await prisma.requestTemplate.delete({ where: { id: tmpl.id } })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    targetModel: 'RequestTemplate', targetId: tmpl.id,
    note: 'template deleted',
  })
}

// keep the enum of transitions exported for the UI dropdown.
export async function getAllowedRequestItemTransitions(from: string): Promise<string[]> {
  if (!(REQUEST_ITEM_STATUSES as readonly string[]).includes(from)) return []
  return [...(ALLOWED_REQUEST_ITEM_TRANSITIONS[from as RequestItemStatus] ?? [])]
}

// ensure isRequestListStatus is used somewhere (kept for wider surface).
void isRequestListStatus
