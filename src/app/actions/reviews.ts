'use server'

/**
 * ReviewItem + ReviewComment server actions.
 *
 * Every action inherits Slice-11 engagement-team gating via
 * requireCaseAccess — a non-member of a case with hasEngagementTeam
 * cannot even see review items for that case.
 *
 * ReviewComments are append-only at the app layer. No `updateComment`
 * or `deleteComment` action exists on purpose — the review record is
 * part of the audit trail.
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError } from '@/lib/authz'
import {
  REVIEW_STATUSES,
  ALLOWED_REVIEW_TRANSITIONS,
  canReviewTransition,
  transitionRequiresNote,
  REVIEW_STATUS_ORDER,
  REVIEW_STATUS_LABEL,
  type ReviewStatus,
} from '@/lib/reviews/statuses'
import {
  isReviewTargetType,
  REVIEW_TARGET_LABEL,
  type ReviewTargetType,
} from '@/lib/reviews/targets'

// ─────────────────────────────────────────────────
// Client shapes
// ─────────────────────────────────────────────────

export interface ReviewCommentForClient {
  id:         string
  authorId:   string
  authorName: string | null
  body:       string
  createdAt:  Date
}

export interface ReviewItemForClient {
  id:                   string
  caseId:               string
  targetType:           ReviewTargetType
  targetTypeLabel:      string
  targetId:             string
  status:               ReviewStatus
  statusLabel:          string
  title:                string
  description:          string | null
  createdBy:            string
  assignedTo:           string | null
  approvedBy:           string | null
  approvedAt:           Date | null
  changesRequestedBy:   string | null
  changesRequestedAt:   Date | null
  changesRequestedNote: string | null
  comments:             ReviewCommentForClient[]
  createdAt:            Date
  updatedAt:            Date
}

function commentToClient(c: any): ReviewCommentForClient {
  return {
    id:         c.id,
    authorId:   c.authorId,
    authorName: c.author?.name ?? null,
    body:       c.body,
    createdAt:  c.createdAt,
  }
}

function itemToClient(row: any): ReviewItemForClient {
  return {
    id:                   row.id,
    caseId:               row.caseId,
    targetType:           row.targetType as ReviewTargetType,
    targetTypeLabel:      REVIEW_TARGET_LABEL[row.targetType as ReviewTargetType] ?? row.targetType,
    targetId:             row.targetId,
    status:               row.status as ReviewStatus,
    statusLabel:          REVIEW_STATUS_LABEL[row.status as ReviewStatus] ?? row.status,
    title:                row.title,
    description:          row.description,
    createdBy:            row.createdBy,
    assignedTo:           row.assignedTo,
    approvedBy:           row.approvedBy,
    approvedAt:           row.approvedAt,
    changesRequestedBy:   row.changesRequestedBy,
    changesRequestedAt:   row.changesRequestedAt,
    changesRequestedNote: row.changesRequestedNote,
    comments:             (row.comments ?? []).map(commentToClient),
    createdAt:            row.createdAt,
    updatedAt:            row.updatedAt,
  }
}

// ─────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────

export async function getReviewItemsForCase(caseId: string): Promise<ReviewItemForClient[]> {
  await requireCaseAccess(caseId, 'case:read')
  const rows = await prisma.reviewItem.findMany({
    where:   { caseId },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    include: {
      comments: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { name: true } } },
      },
    },
  })
  const shaped = rows.map(itemToClient)
  shaped.sort((a, b) => {
    const sa = REVIEW_STATUS_ORDER[a.status] ?? 99
    const sb = REVIEW_STATUS_ORDER[b.status] ?? 99
    if (sa !== sb) return sa - sb
    return b.updatedAt.getTime() - a.updatedAt.getTime()
  })
  return shaped
}

// ─────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────

export interface CreateReviewItemInput {
  caseId:      string
  targetType:  string
  targetId:    string
  title:       string
  description?: string
  assignedTo?: string
}

export async function createReviewItem(input: CreateReviewItemInput): Promise<{ id: string }> {
  if (!isReviewTargetType(input.targetType)) throw new Error(`Unknown targetType: ${input.targetType}`)
  if (!input.title?.trim()) throw new Error('Title required')
  const { session } = await requireCaseAccess(input.caseId, 'value:accept')

  // If assignedTo is set, it must be a member of the case (or an ADMIN).
  if (input.assignedTo) {
    const assignedUser = await prisma.user.findUnique({
      where: { id: input.assignedTo },
      select: { organizationId: true, role: true },
    })
    if (!assignedUser || assignedUser.organizationId !== session.organizationId) {
      throw new Error('Assignee is not in this organization')
    }
  }

  try {
    const created = await prisma.reviewItem.create({
      data: {
        caseId:      input.caseId,
        targetType:  input.targetType,
        targetId:    input.targetId,
        status:      'DRAFT',
        title:       input.title.trim(),
        description: input.description?.trim() ?? null,
        createdBy:   session.userId,
        assignedTo:  input.assignedTo ?? null,
      },
    })
    await logAction({
      userId: session.userId, action: 'UPDATE_CASE',
      caseId: input.caseId,
      targetModel: 'ReviewItem', targetId: created.id,
      note: `review item created: ${input.title.slice(0, 100)}`,
    })
    revalidatePath(`/projects/${input.caseId}`)
    return { id: created.id }
  } catch (e: any) {
    if (e?.code === 'P2002') {
      // Unique constraint on (caseId, targetType, targetId) — a review item
      // already exists for this target. Return it instead of failing.
      const existing = await prisma.reviewItem.findUnique({
        where: {
          ReviewItem_case_target: {
            caseId: input.caseId, targetType: input.targetType, targetId: input.targetId,
          },
        },
        select: { id: true },
      })
      if (existing) return existing
    }
    throw e
  }
}

export async function changeReviewStatus(
  id: string,
  next: string,
  note?: string,
): Promise<void> {
  if (!REVIEW_STATUSES.includes(next as ReviewStatus)) {
    throw new Error(`Unknown review status: ${next}`)
  }
  const row = await prisma.reviewItem.findUnique({ where: { id } })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.caseId, 'value:accept')

  const from = row.status as ReviewStatus
  const to   = next as ReviewStatus
  if (from === to) return

  if (!canReviewTransition(from, to)) {
    throw new Error(`Invalid review transition: ${from} → ${to}`)
  }
  if (transitionRequiresNote(to) && !note?.trim()) {
    throw new Error(`Transition to ${to} requires a note`)
  }

  const now = new Date()
  const data: Record<string, unknown> = { status: to }
  if (to === 'APPROVED') {
    data.approvedBy = session.userId
    data.approvedAt = now
    data.changesRequestedBy = null
    data.changesRequestedAt = null
    data.changesRequestedNote = null
  } else if (to === 'CHANGES_REQUESTED') {
    data.changesRequestedBy = session.userId
    data.changesRequestedAt = now
    data.changesRequestedNote = note ?? null
  } else if (to === 'READY_FOR_REVIEW') {
    // Fresh submission — clear the previous reviewer verdict.
    if (from === 'CHANGES_REQUESTED' || from === 'APPROVED') {
      data.approvedBy = null
      data.approvedAt = null
    }
  } else if (to === 'DRAFT') {
    data.approvedBy = null
    data.approvedAt = null
    data.changesRequestedBy = null
    data.changesRequestedAt = null
    data.changesRequestedNote = null
  }

  await prisma.reviewItem.update({ where: { id }, data })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: row.caseId, targetModel: 'ReviewItem', targetId: id,
    oldValue: { status: from }, newValue: { status: to, note: note ?? null },
    note: note?.slice(0, 200),
  })
  revalidatePath(`/projects/${row.caseId}`)
}

export async function addReviewComment(input: {
  reviewItemId: string
  body:         string
}): Promise<{ id: string }> {
  if (!input.body?.trim()) throw new Error('Comment body required')
  const row = await prisma.reviewItem.findUnique({
    where: { id: input.reviewItemId }, select: { caseId: true },
  })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.caseId, 'case:read')

  const created = await prisma.reviewComment.create({
    data: {
      reviewItemId: input.reviewItemId,
      authorId:     session.userId,
      body:         input.body.trim(),
    },
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: row.caseId,
    targetModel: 'ReviewComment', targetId: created.id,
    note: input.body.slice(0, 200),
  })
  revalidatePath(`/projects/${row.caseId}`)
  return { id: created.id }
}
