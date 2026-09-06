import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * SLICE 11 LOAD-BEARING TEST
 *
 * The single invariant we cannot break: **confidential Case A must be
 * inaccessible to non-member Org A users** once the engagement-team
 * flag is set. Cross-org isolation (Slice 1) still applies on top.
 *
 * This file exercises requireCaseAccess directly — every earlier-slice
 * server action inherits its behavior. If this test passes, the whole
 * downstream slice's access surface is sound.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:       { findFirst: vi.fn() },
    caseMember: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { requireCaseAccess, NotFoundError, UnauthorizedError } from '@/lib/authz'

const editorInOrgA   = { userId: 'user-editor',  organizationId: 'org-a', role: 'EDITOR', email: 'e@a', jti: 'j' }
const adminInOrgA    = { userId: 'user-admin',   organizationId: 'org-a', role: 'ADMIN',  email: 'a@a', jti: 'j' }
const editorInOrgB   = { userId: 'user-other',   organizationId: 'org-b', role: 'EDITOR', email: 'x@b', jti: 'j' }
const memberInOrgA   = { userId: 'user-member',  organizationId: 'org-a', role: 'EDITOR', email: 'm@a', jti: 'j' }

const caseOrgA_publicShape  = { id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false }
const caseOrgA_teamedShape  = { id: 'case-a', organizationId: 'org-a', hasEngagementTeam: true  }

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────
// Backward compat: cases without an engagement team behave like Slice 1
// ─────────────────────────────────────────────────

describe('backward compat — Case.hasEngagementTeam === false', () => {
  it('any user in the same org can access', async () => {
    vi.mocked(getSession).mockResolvedValue(editorInOrgA as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue(caseOrgA_publicShape as any)
    const { case: c } = await requireCaseAccess('case-a')
    expect(c.id).toBe('case-a')
    // No caseMember lookup — the gate is short-circuited by the flag.
    expect(prisma.caseMember.findUnique).not.toHaveBeenCalled()
  })

  it('still refuses cross-org', async () => {
    vi.mocked(getSession).mockResolvedValue(editorInOrgB as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue(null)
    await expect(requireCaseAccess('case-a')).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ─────────────────────────────────────────────────
// LOAD-BEARING: engagement team enabled → non-member Org A user refused
// ─────────────────────────────────────────────────

describe('confidential Case A is inaccessible to unauthorized Org A member', () => {
  it('non-member same-org EDITOR gets NotFoundError (indistinguishable from cross-tenant)', async () => {
    vi.mocked(getSession).mockResolvedValue(editorInOrgA as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue(caseOrgA_teamedShape as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValue(null) // NOT a member
    await expect(requireCaseAccess('case-a')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('a removed member (removedAt != null) is also refused', async () => {
    vi.mocked(getSession).mockResolvedValue(memberInOrgA as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue(caseOrgA_teamedShape as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValue({ removedAt: new Date() } as any)
    await expect(requireCaseAccess('case-a')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('active member (removedAt is null) is admitted', async () => {
    vi.mocked(getSession).mockResolvedValue(memberInOrgA as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue(caseOrgA_teamedShape as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValue({ removedAt: null } as any)
    const { case: c } = await requireCaseAccess('case-a')
    expect(c.id).toBe('case-a')
  })

  it('org ADMIN is admitted even without a CaseMember row', async () => {
    vi.mocked(getSession).mockResolvedValue(adminInOrgA as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue(caseOrgA_teamedShape as any)
    const { case: c } = await requireCaseAccess('case-a')
    expect(c.id).toBe('case-a')
    // ADMIN never triggers a member lookup.
    expect(prisma.caseMember.findUnique).not.toHaveBeenCalled()
  })

  it('cross-org attempts still surface as NotFoundError even when engagement team is enabled', async () => {
    vi.mocked(getSession).mockResolvedValue(editorInOrgB as any)
    // Tenant-scoped findFirst returns null because organizationId doesn't match.
    vi.mocked(prisma.case.findFirst).mockResolvedValue(null)
    await expect(requireCaseAccess('case-a')).rejects.toBeInstanceOf(NotFoundError)
    // No membership lookup either — the tenant gate stops us first.
    expect(prisma.caseMember.findUnique).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────
// Session gate still runs first
// ─────────────────────────────────────────────────

describe('unauthenticated caller', () => {
  it('gets UnauthorizedError before any DB lookup', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    await expect(requireCaseAccess('case-a')).rejects.toBeInstanceOf(UnauthorizedError)
    expect(prisma.case.findFirst).not.toHaveBeenCalled()
    expect(prisma.caseMember.findUnique).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────
// Composition with permission checks
// ─────────────────────────────────────────────────

describe('permission composition', () => {
  it('permission failure fires AFTER the engagement-team gate', async () => {
    // A non-member with an inadequate permission still just sees NotFoundError
    // — we never leak that the case exists.
    vi.mocked(getSession).mockResolvedValue({ ...editorInOrgA, role: 'VIEWER' } as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue(caseOrgA_teamedShape as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValue(null)
    await expect(requireCaseAccess('case-a', 'case:create')).rejects.toBeInstanceOf(NotFoundError)
    // Would-be permission (case:create) never gets checked because the membership check throws first.
  })

  it('member with insufficient org permission gets ForbiddenError', async () => {
    vi.mocked(getSession).mockResolvedValue({ ...memberInOrgA, role: 'VIEWER' } as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue(caseOrgA_teamedShape as any)
    vi.mocked(prisma.caseMember.findUnique).mockResolvedValue({ removedAt: null } as any)
    await expect(requireCaseAccess('case-a', 'case:create')).rejects.toThrow(/case:create|Forbidden/)
  })
})
