/**
 * LOAD-BEARING: cross-tenant + engagement-team leakage defense.
 *
 * `resolveAuthorizedCaseIds` is the ONLY module producing the caseId
 * shortlist the search sees. These tests prove:
 *
 *   1. A user in Org A can never resolve a caseId from Org B.
 *   2. A non-ADMIN, non-member of an engagement-team case is refused
 *      that case, even if it belongs to their org.
 *   3. An ADMIN sees every case in their org (Slice-11 spec).
 *   4. `filterResultsToAuthorized` catches any leaked row that
 *      somehow makes it past the composer — the post-query
 *      defense-in-depth pass.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:       { findMany: vi.fn() },
    caseMember: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  resolveAuthorizedCaseIds, filterResultsToAuthorized,
} from '@/lib/search/permissions'

const EDITOR_A = { userId: 'user-a', organizationId: 'org-A', role: 'EDITOR', email: 'a@x', jti: 'j' }
const ADMIN_A  = { userId: 'admin-a', organizationId: 'org-A', role: 'ADMIN',  email: 'ad@x', jti: 'j' }

beforeEach(() => vi.clearAllMocks())

// ─────────────────────────────────────────────────
// Cross-tenant isolation (Slice-1)
// ─────────────────────────────────────────────────

describe('resolveAuthorizedCaseIds — cross-tenant', () => {
  it('never returns a case whose organizationId differs from the session', async () => {
    // The Prisma findMany call is passed a `where: { organizationId }`.
    // We snapshot the arg so we can prove the tenant filter is in
    // place BEFORE any application logic sees the rows.
    let capturedWhere: any = null
    ;(prisma.case.findMany as any).mockImplementation(async (args: any) => {
      capturedWhere = args.where
      return [
        { id: 'case-1', hasEngagementTeam: false },
        { id: 'case-2', hasEngagementTeam: false },
      ] as any
    })
    const r = await resolveAuthorizedCaseIds(EDITOR_A as any)
    expect(r.authorizedCaseIds).toEqual(['case-1', 'case-2'])
    expect(capturedWhere?.organizationId).toBe('org-A')
    // We must NEVER have fetched every case; the `where` clause is the tenant boundary.
    expect(capturedWhere).toEqual({ organizationId: 'org-A' })
  })
})

// ─────────────────────────────────────────────────
// Engagement-team gate (Slice-11)
// ─────────────────────────────────────────────────

describe('resolveAuthorizedCaseIds — engagement-team gate', () => {
  it('non-ADMIN sees whole-org cases but is REFUSED gated cases they are not a member of', async () => {
    vi.mocked(prisma.case.findMany).mockResolvedValue([
      { id: 'case-open',       hasEngagementTeam: false },
      { id: 'case-restricted', hasEngagementTeam: true  },
    ] as any)
    vi.mocked(prisma.caseMember.findMany).mockResolvedValue([] as any)  // user has no membership
    const r = await resolveAuthorizedCaseIds(EDITOR_A as any)
    expect(r.authorizedCaseIds).toEqual(['case-open'])
    expect(r.restrictedCaseIds).toEqual(['case-restricted'])
  })

  it('non-ADMIN with an active membership IS granted the restricted case', async () => {
    vi.mocked(prisma.case.findMany).mockResolvedValue([
      { id: 'case-open',       hasEngagementTeam: false },
      { id: 'case-restricted', hasEngagementTeam: true  },
    ] as any)
    vi.mocked(prisma.caseMember.findMany).mockResolvedValue([
      { caseId: 'case-restricted' },
    ] as any)
    const r = await resolveAuthorizedCaseIds(EDITOR_A as any)
    expect(r.authorizedCaseIds).toContain('case-restricted')
    expect(r.restrictedCaseIds).toEqual([])
  })

  it('ADMIN sees every case in the org — no membership query needed', async () => {
    vi.mocked(prisma.case.findMany).mockResolvedValue([
      { id: 'case-a', hasEngagementTeam: false },
      { id: 'case-b', hasEngagementTeam: true  },
      { id: 'case-c', hasEngagementTeam: true  },
    ] as any)
    const r = await resolveAuthorizedCaseIds(ADMIN_A as any)
    expect(r.authorizedCaseIds.sort()).toEqual(['case-a', 'case-b', 'case-c'])
    // Membership query should not have run.
    expect(prisma.caseMember.findMany).not.toHaveBeenCalled()
  })

  it('the membership query is scoped to userId + non-removed + restricted subset', async () => {
    vi.mocked(prisma.case.findMany).mockResolvedValue([
      { id: 'case-restricted-1', hasEngagementTeam: true },
      { id: 'case-restricted-2', hasEngagementTeam: true },
    ] as any)
    let capturedMemberWhere: any = null
    ;(prisma.caseMember.findMany as any).mockImplementation(async (args: any) => {
      capturedMemberWhere = args.where
      return [] as any
    })
    await resolveAuthorizedCaseIds(EDITOR_A as any)
    expect(capturedMemberWhere.userId).toBe('user-a')
    expect(capturedMemberWhere.removedAt).toBe(null)
    // caseId IN list scoped to the restricted subset — never all cases.
    expect(capturedMemberWhere.caseId.in.sort()).toEqual(
      ['case-restricted-1', 'case-restricted-2'].sort(),
    )
  })
})

// ─────────────────────────────────────────────────
// filterResultsToAuthorized — defense-in-depth pass
// ─────────────────────────────────────────────────

describe('filterResultsToAuthorized', () => {
  it('drops rows whose caseId is not in the authorized list', () => {
    const rows = [
      { caseId: 'case-1', name: 'safe' },
      { caseId: 'case-99', name: 'LEAKED' },
      { caseId: 'case-2', name: 'safe' },
    ]
    const r = filterResultsToAuthorized(rows, ['case-1', 'case-2'])
    expect(r.rows.map(x => x.caseId).sort()).toEqual(['case-1', 'case-2'])
    expect(r.leakedCaseIds).toEqual(['case-99'])
  })

  it('empty authorized list drops everything (returns [])', () => {
    const r = filterResultsToAuthorized([{ caseId: 'case-1' }], [])
    expect(r.rows).toEqual([])
    expect(r.leakedCaseIds).toEqual(['case-1'])
  })
})
