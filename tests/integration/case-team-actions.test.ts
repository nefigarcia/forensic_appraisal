import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:       { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    caseMember: {
      findMany:   vi.fn(),
      findUnique: vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
      count:      vi.fn(),
    },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: any) => {
      const tx = {
        caseMember: {
          findUnique: vi.mocked(prisma.caseMember.findUnique),
          create:     vi.mocked(prisma.caseMember.create),
          update:     vi.mocked(prisma.caseMember.update),
        },
        case: {
          findUnique: vi.mocked(prisma.case.findUnique),
          update:     vi.mocked(prisma.case.update),
        },
      }
      return fn(tx)
    }),
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import {
  addCaseMember,
  removeCaseMember,
  changeCaseMemberRole,
} from '@/app/actions/case-team'
import { ForbiddenError, NotFoundError } from '@/lib/authz'

const admin  = { userId: 'user-admin',  organizationId: 'org-a', role: 'ADMIN',  email: 'a@a', jti: 'j' }
const editor = { userId: 'user-editor', organizationId: 'org-a', role: 'EDITOR', email: 'e@a', jti: 'j' }

beforeEach(() => { vi.clearAllMocks() })

// ─────────────────────────────────────────────────
// addCaseMember — flips hasEngagementTeam on first add
// ─────────────────────────────────────────────────

describe('addCaseMember', () => {
  it('flips Case.hasEngagementTeam=true when the first member is added', async () => {
    vi.mocked(getSession).mockResolvedValue(admin as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-new', organizationId: 'org-a', email: 'n@a' } as any)
    vi.mocked(prisma.caseMember.findUnique)
      .mockResolvedValueOnce(null)          // no existing membership
    vi.mocked(prisma.caseMember.create).mockResolvedValue({ id: 'mem-1' } as any)
    vi.mocked(prisma.case.findUnique).mockResolvedValue({ hasEngagementTeam: false } as any)
    vi.mocked(prisma.case.update).mockResolvedValue({} as any)

    const res = await addCaseMember({ caseId: 'case-a', userId: 'user-new', caseRole: 'ANALYST' })
    expect(res.flippedEngagementTeam).toBe(true)
    expect(vi.mocked(prisma.case.update).mock.calls[0]![0]!.data).toMatchObject({ hasEngagementTeam: true })
  })

  it('does NOT flip the flag again if it was already true', async () => {
    vi.mocked(getSession).mockResolvedValue(admin as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: true } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-new', organizationId: 'org-a', email: 'n@a' } as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValueOnce(null)
    vi.mocked(prisma.caseMember.create).mockResolvedValue({ id: 'mem-2' } as any)
    vi.mocked(prisma.case.findUnique).mockResolvedValue({ hasEngagementTeam: true } as any)

    const res = await addCaseMember({ caseId: 'case-a', userId: 'user-new', caseRole: 'ANALYST' })
    expect(res.flippedEngagementTeam).toBe(false)
    expect(prisma.case.update).not.toHaveBeenCalled()
  })

  it('reactivates a soft-deleted membership instead of creating a duplicate', async () => {
    vi.mocked(getSession).mockResolvedValue(admin as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: true } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-x', organizationId: 'org-a', email: 'x@a' } as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValueOnce({
      id: 'mem-old', caseId: 'case-a', userId: 'user-x', removedAt: new Date(), caseRole: 'ANALYST',
    } as any)
    vi.mocked(prisma.caseMember.update).mockResolvedValue({ id: 'mem-old' } as any)
    vi.mocked(prisma.case.findUnique).mockResolvedValue({ hasEngagementTeam: true } as any)

    await addCaseMember({ caseId: 'case-a', userId: 'user-x', caseRole: 'MANAGER' })
    const data = vi.mocked(prisma.caseMember.update).mock.calls[0]![0]!.data as any
    expect(data.removedAt).toBeNull()
    expect(data.caseRole).toBe('MANAGER')
    expect(prisma.caseMember.create).not.toHaveBeenCalled()
  })

  it('refuses to add a user from another organization', async () => {
    vi.mocked(getSession).mockResolvedValue(admin as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-outside', organizationId: 'org-b', email: 'y@b' } as any)
    await expect(addCaseMember({ caseId: 'case-a', userId: 'user-outside', caseRole: 'ANALYST' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses an unknown case role', async () => {
    vi.mocked(getSession).mockResolvedValue(admin as any)
    await expect(addCaseMember({ caseId: 'case-a', userId: 'user-x', caseRole: 'ARCHIVIST' })).rejects.toThrow(/Unknown case role/)
  })

  it('non-admin non-partner/manager caller is refused with ForbiddenError', async () => {
    vi.mocked(getSession).mockResolvedValue(editor as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: true } as any)
    vi.mocked(prisma.caseMember.findUnique)
      .mockResolvedValueOnce({ removedAt: null } as any)   // for requireCaseAccess pass-through
      .mockResolvedValueOnce({ caseRole: 'ANALYST', removedAt: null } as any) // for the mgmt-privilege check
    await expect(addCaseMember({ caseId: 'case-a', userId: 'user-new', caseRole: 'ANALYST' })).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ─────────────────────────────────────────────────
// removeCaseMember — refuses to remove the last Engagement Partner
// ─────────────────────────────────────────────────

describe('removeCaseMember', () => {
  it('refuses to remove the last Engagement Partner', async () => {
    vi.mocked(getSession).mockResolvedValue(admin as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: true } as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValueOnce({
      id: 'mem-partner', caseId: 'case-a', userId: 'p1', caseRole: 'ENGAGEMENT_PARTNER',
      removedAt: null, user: { email: 'partner@a' },
    } as any)
    vi.mocked(prisma.caseMember.count).mockResolvedValue(0) // no other active partners
    await expect(removeCaseMember({ caseId: 'case-a', memberId: 'mem-partner' })).rejects.toThrow(/last Engagement Partner/)
    expect(prisma.caseMember.update).not.toHaveBeenCalled()
  })

  it('removes a member (sets removedAt / removedBy) when another partner is present', async () => {
    vi.mocked(getSession).mockResolvedValue(admin as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: true } as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValueOnce({
      id: 'mem-2', caseId: 'case-a', userId: 'user-x', caseRole: 'ANALYST',
      removedAt: null, user: { email: 'x@a' },
    } as any)
    vi.mocked(prisma.caseMember.update).mockResolvedValue({} as any)

    await removeCaseMember({ caseId: 'case-a', memberId: 'mem-2' })
    const data = vi.mocked(prisma.caseMember.update).mock.calls[0]![0]!.data as any
    expect(data.removedAt).toBeInstanceOf(Date)
    expect(data.removedBy).toBe('user-admin')
  })

  it('silent no-op on already-removed member', async () => {
    vi.mocked(getSession).mockResolvedValue(admin as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: true } as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValueOnce({
      id: 'mem-old', caseId: 'case-a', removedAt: new Date(), caseRole: 'ANALYST', user: { email: 'x@a' },
    } as any)
    await removeCaseMember({ caseId: 'case-a', memberId: 'mem-old' })
    expect(prisma.caseMember.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────
// changeCaseMemberRole
// ─────────────────────────────────────────────────

describe('changeCaseMemberRole', () => {
  it('refuses to demote the last Engagement Partner', async () => {
    vi.mocked(getSession).mockResolvedValue(admin as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: true } as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValueOnce({
      id: 'mem-partner', caseId: 'case-a', caseRole: 'ENGAGEMENT_PARTNER', removedAt: null,
    } as any)
    vi.mocked(prisma.caseMember.count).mockResolvedValue(0)
    await expect(changeCaseMemberRole({ caseId: 'case-a', memberId: 'mem-partner', caseRole: 'MANAGER' })).rejects.toThrow(/last Engagement Partner/)
  })

  it('promotes a member happily', async () => {
    vi.mocked(getSession).mockResolvedValue(admin as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: true } as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValueOnce({
      id: 'mem-2', caseId: 'case-a', caseRole: 'ANALYST', removedAt: null,
    } as any)
    vi.mocked(prisma.caseMember.update).mockResolvedValue({} as any)

    await changeCaseMemberRole({ caseId: 'case-a', memberId: 'mem-2', caseRole: 'SENIOR' })
    const data = vi.mocked(prisma.caseMember.update).mock.calls[0]![0]!.data as any
    expect(data.caseRole).toBe('SENIOR')
  })

  it('refuses to modify a removed member', async () => {
    vi.mocked(getSession).mockResolvedValue(admin as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: true } as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValueOnce({
      id: 'mem-gone', caseId: 'case-a', caseRole: 'ANALYST', removedAt: new Date(),
    } as any)
    await expect(changeCaseMemberRole({ caseId: 'case-a', memberId: 'mem-gone', caseRole: 'SENIOR' })).rejects.toThrow(/removed member/)
  })
})
