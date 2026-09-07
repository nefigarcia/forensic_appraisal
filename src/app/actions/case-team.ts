'use server'

/**
 * Case-team management server actions.
 *
 * Every action goes through Slice-1 tenant scoping via requireCaseAccess.
 * Team-management operations (add / remove / change-role) require either
 * an org ADMIN OR a case member with role ENGAGEMENT_PARTNER / MANAGER.
 *
 * Adding the first member flips Case.hasEngagementTeam to true. From that
 * point on, only active members + org ADMINs can reach the case. The
 * flag is monotonic — deleting the last member does NOT flip it back.
 * That would be a footgun (whole org suddenly regains access).
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError, ForbiddenError } from '@/lib/authz'
import {
  isCaseRole, canManageTeam, CASE_ROLE_LABEL, type CaseRole,
} from '@/lib/case-team/roles'

export interface CaseMemberForClient {
  id:        string
  userId:    string
  userEmail: string | null
  userName:  string | null
  caseRole:  CaseRole
  caseRoleLabel: string
  addedAt:   Date
  addedBy:   string | null
  removedAt: Date | null
}

// ─────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────

/** List every active + removed member. Sorts by role rank, then addedAt. */
export async function getCaseMembers(caseId: string): Promise<CaseMemberForClient[]> {
  await requireCaseAccess(caseId, 'case:read')
  const rows = await prisma.caseMember.findMany({
    where: { caseId },
    orderBy: { addedAt: 'asc' },
    include: { user: { select: { email: true, name: true } } },
  })
  return rows.map((r): CaseMemberForClient => ({
    id:        r.id,
    userId:    r.userId,
    userEmail: r.user?.email ?? null,
    userName:  r.user?.name  ?? null,
    caseRole:  r.caseRole as CaseRole,
    caseRoleLabel: CASE_ROLE_LABEL[r.caseRole as CaseRole] ?? r.caseRole,
    addedAt:   r.addedAt,
    addedBy:   r.addedBy,
    removedAt: r.removedAt,
  }))
}

// ─────────────────────────────────────────────────
// Authorization helper for team-management writes
// ─────────────────────────────────────────────────

/**
 * Team management is stricter than case access: caller must be an org
 * ADMIN OR an active CaseMember with role Partner/Manager.
 */
async function assertCanManageTeam(caseId: string) {
  const { session, case: c } = await requireCaseAccess(caseId, 'case:read')
  if (session.role === 'ADMIN') return { session, case: c }
  const member = await prisma.caseMember.findUnique({
    where: { CaseMember_case_user: { caseId, userId: session.userId } },
    select: { caseRole: true, removedAt: true },
  })
  if (!member || member.removedAt || !canManageTeam(member.caseRole)) {
    throw new ForbiddenError('Only Engagement Partner / Manager may manage the team')
  }
  return { session, case: c }
}

// ─────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────

export async function addCaseMember(input: {
  caseId: string
  userId: string
  caseRole: string
}): Promise<{ id: string; flippedEngagementTeam: boolean }> {
  if (!isCaseRole(input.caseRole)) throw new Error(`Unknown case role: ${input.caseRole}`)
  const { session } = await assertCanManageTeam(input.caseId)

  // Must be adding a user from the same org.
  const target = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, organizationId: true, email: true },
  })
  if (!target || target.organizationId !== session.organizationId) {
    throw new NotFoundError()
  }

  const now = new Date()
  const result = await prisma.$transaction(async (tx) => {
    // Upsert: reactivate a soft-deleted membership rather than creating a
    // duplicate row.
    const existing = await tx.caseMember.findUnique({
      where: { CaseMember_case_user: { caseId: input.caseId, userId: input.userId } },
    })
    let row
    if (existing) {
      row = await tx.caseMember.update({
        where: { id: existing.id },
        data: {
          caseRole:  input.caseRole,
          addedBy:   session.userId,
          addedAt:   now,
          removedAt: null,
          removedBy: null,
        },
      })
    } else {
      row = await tx.caseMember.create({
        data: {
          caseId:   input.caseId,
          userId:   input.userId,
          caseRole: input.caseRole,
          addedBy:  session.userId,
        },
      })
    }

    // Flip the engagement-team gate on first add. Monotonic — never
    // flipped back to false.
    const c = await tx.case.findUnique({ where: { id: input.caseId }, select: { hasEngagementTeam: true } })
    let flipped = false
    if (c && !c.hasEngagementTeam) {
      await tx.case.update({ where: { id: input.caseId }, data: { hasEngagementTeam: true } })
      flipped = true
    }
    return { id: row.id, flipped }
  })

  await logAction({
    userId: session.userId,
    action: 'UPDATE_CASE',
    caseId: input.caseId,
    targetModel: 'CaseMember', targetId: result.id,
    note: `added ${target.email} as ${input.caseRole}${result.flipped ? ' (engagement team activated)' : ''}`,
  })
  revalidatePath(`/projects/${input.caseId}`)
  return { id: result.id, flippedEngagementTeam: result.flipped }
}

export async function removeCaseMember(input: {
  caseId: string
  memberId: string
}): Promise<void> {
  const { session } = await assertCanManageTeam(input.caseId)
  const row = await prisma.caseMember.findUnique({
    where: { id: input.memberId },
    include: { user: { select: { email: true } } },
  })
  if (!row || row.caseId !== input.caseId) throw new NotFoundError()
  if (row.removedAt) return  // already removed — silent no-op

  // Guardrail: refuse to remove the last Engagement Partner.
  if (row.caseRole === 'ENGAGEMENT_PARTNER') {
    const others = await prisma.caseMember.count({
      where: {
        caseId: input.caseId,
        caseRole: 'ENGAGEMENT_PARTNER',
        removedAt: null,
        id: { not: row.id },
      },
    })
    if (others === 0) {
      throw new Error(
        'Refusing to remove the last Engagement Partner. Assign another partner first.',
      )
    }
  }

  await prisma.caseMember.update({
    where: { id: input.memberId },
    data:  { removedAt: new Date(), removedBy: session.userId },
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: input.caseId,
    targetModel: 'CaseMember', targetId: input.memberId,
    note: `removed ${row.user?.email ?? row.userId} from engagement team`,
  })
  revalidatePath(`/projects/${input.caseId}`)
}

export async function changeCaseMemberRole(input: {
  caseId: string
  memberId: string
  caseRole: string
}): Promise<void> {
  if (!isCaseRole(input.caseRole)) throw new Error(`Unknown case role: ${input.caseRole}`)
  const { session } = await assertCanManageTeam(input.caseId)
  const row = await prisma.caseMember.findUnique({ where: { id: input.memberId } })
  if (!row || row.caseId !== input.caseId) throw new NotFoundError()
  if (row.removedAt) throw new Error('Cannot change role of a removed member; re-add them instead.')

  // If demoting the last Engagement Partner, refuse — same rule as remove.
  if (row.caseRole === 'ENGAGEMENT_PARTNER' && input.caseRole !== 'ENGAGEMENT_PARTNER') {
    const others = await prisma.caseMember.count({
      where: {
        caseId: input.caseId, caseRole: 'ENGAGEMENT_PARTNER',
        removedAt: null, id: { not: row.id },
      },
    })
    if (others === 0) {
      throw new Error('Refusing to demote the last Engagement Partner.')
    }
  }

  await prisma.caseMember.update({
    where: { id: input.memberId },
    data:  { caseRole: input.caseRole },
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: input.caseId, targetModel: 'CaseMember', targetId: input.memberId,
    note: `role changed to ${input.caseRole}`,
  })
  revalidatePath(`/projects/${input.caseId}`)
}
