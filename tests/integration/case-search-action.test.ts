/**
 * LOAD-BEARING end-to-end test for the Slice-16 search actions.
 *
 * These tests exercise `searchCasesFactual` and `searchCasesWithAI`
 * with real permission-resolver code paths but a mocked DB. The
 * assertions pin the invariants that:
 *   1. The tenant filter is added to the composed WHERE
 *      unconditionally.
 *   2. The `caseId IN (authorizedCaseIds)` clause is added even when
 *      the caller passes no filters.
 *   3. AI-planned search re-runs the whitelist validator on the AI's
 *      proposed filters and refuses invalid ones without querying.
 *   4. `AiCaseSearchRun.returnedCaseIds` is persisted — the audit
 *      log proves which cases were returned to which user.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:              { findMany: vi.fn() },
    caseMember:        { findMany: vi.fn() },
    caseSearchIndex:   { findMany: vi.fn() },
    aiCaseSearchRun:   { create:   vi.fn().mockImplementation(async (args: any) => ({ id: 'run-1', ...args.data })) },
    aiExecution:       { create:   vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))
vi.mock('@/ai/flows/case-search-planner-flow', () => ({
  planCaseSearch: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { planCaseSearch } from '@/ai/flows/case-search-planner-flow'
import { searchCasesFactual, searchCasesWithAI } from '@/app/actions/case-search'

const EDITOR = { userId: 'user-e', organizationId: 'org-1', role: 'EDITOR', email: 'e@x', jti: 'j' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(EDITOR as any)
  vi.mocked(prisma.caseSearchIndex.findMany).mockResolvedValue([])
  vi.mocked(prisma.aiExecution.create).mockResolvedValue({ id: 'exec-1' } as any)
  vi.mocked(prisma.aiExecution.update).mockResolvedValue({} as any)
})

// ─────────────────────────────────────────────────
// Factual — tenant + engagement gate always applied
// ─────────────────────────────────────────────────

describe('searchCasesFactual', () => {
  it('applies the tenant filter + authorized caseIds even when no filters are passed', async () => {
    vi.mocked(prisma.case.findMany).mockResolvedValue([
      { id: 'case-1', hasEngagementTeam: false },
      { id: 'case-2', hasEngagementTeam: true },  // restricted, no membership
    ] as any)
    vi.mocked(prisma.caseMember.findMany).mockResolvedValue([] as any)

    let capturedWhere: any = null
    ;(prisma.caseSearchIndex.findMany as any).mockImplementation(async (args: any) => {
      capturedWhere = args.where
      return [] as any
    })

    await searchCasesFactual({ filters: [] })
    // Tenant clause + caseId IN [case-1] (case-2 is restricted).
    const asJson = JSON.stringify(capturedWhere)
    expect(asJson).toContain('org-1')
    expect(asJson).toContain('case-1')
    expect(asJson).not.toContain('case-2')
  })

  it('rejects an invalid FilterSet BEFORE any DB query', async () => {
    await expect(searchCasesFactual({
      filters: [{ kind: 'string', filter: { field: 'not_a_field' as any, op: 'eq', value: 'x' } }],
    })).rejects.toThrow(/Invalid filter set/)
    expect(prisma.caseSearchIndex.findMany).not.toHaveBeenCalled()
    expect(prisma.case.findMany).not.toHaveBeenCalled()
  })

  it('returns empty when the caller is authorized for zero cases (no DB query needed)', async () => {
    vi.mocked(prisma.case.findMany).mockResolvedValue([] as any)
    const r = await searchCasesFactual({ filters: [] })
    expect(r.rows).toEqual([])
    expect(r.totalAuthorized).toBe(0)
    expect(prisma.caseSearchIndex.findMany).not.toHaveBeenCalled()
  })

  it('drops rows that leak through the composer (defense-in-depth)', async () => {
    vi.mocked(prisma.case.findMany).mockResolvedValue([
      { id: 'case-1', hasEngagementTeam: false },
    ] as any)
    // The composer is supposed to add `caseId IN [case-1]`, but pretend the
    // DB returned a leaked row from case-999.
    vi.mocked(prisma.caseSearchIndex.findMany).mockResolvedValue([
      { caseId: 'case-1',   caseName: 'Safe' },
      { caseId: 'case-999', caseName: 'LEAKED' },
    ] as any)
    const r = await searchCasesFactual({ filters: [] })
    // Post-query filter drops the leaked row.
    expect(r.rows.map(x => x.caseId)).toEqual(['case-1'])
  })
})

// ─────────────────────────────────────────────────
// AI-planned — validator gate + audit trail
// ─────────────────────────────────────────────────

describe('searchCasesWithAI', () => {
  it('runs the query only when the planner produces whitelisted filters', async () => {
    vi.mocked(prisma.case.findMany).mockResolvedValue([
      { id: 'case-1', hasEngagementTeam: false },
    ] as any)
    vi.mocked(planCaseSearch).mockResolvedValue({
      filters: [
        { kind: 'string', filter: { field: 'subjectState', op: 'eq', value: 'CO' } },
      ],
      explanation: 'Interpreted "Colorado" as subjectState = CO.',
      isConfident: true,
    } as any)
    const r = await searchCasesWithAI({ question: 'HVAC valuations in Colorado' })
    expect(r.isConfident).toBe(true)
    expect(prisma.caseSearchIndex.findMany).toHaveBeenCalled()
    // The persisted run row carries the caller's returnedCaseIds — a
    // load-bearing audit hook.
    const createArgs = vi.mocked(prisma.aiCaseSearchRun.create).mock.calls[0]![0] as any
    expect(createArgs.data.returnedCaseIds).toEqual([])
    expect(createArgs.data.userId).toBe('user-e')
  })

  it('refuses to query when the AI proposes a NON-whitelisted field', async () => {
    vi.mocked(prisma.case.findMany).mockResolvedValue([
      { id: 'case-1', hasEngagementTeam: false },
    ] as any)
    vi.mocked(planCaseSearch).mockResolvedValue({
      filters: [
        // The AI tried to smuggle a field. The server-side validator drops it.
        { kind: 'string', filter: { field: 'clientEmail' as any, op: 'eq', value: 'x@y.com' } },
      ],
      explanation: 'Trying to look up by client email.',
      isConfident: true,
    } as any)
    const r = await searchCasesWithAI({ question: 'find cases with client email x@y.com' })
    // Even though the AI was "confident", the validator failed → we mark
    // isConfident=false and DON'T query the index.
    expect(r.isConfident).toBe(false)
    expect(prisma.caseSearchIndex.findMany).not.toHaveBeenCalled()
    // The audit trail records the fallback reason.
    const createArgs = vi.mocked(prisma.aiCaseSearchRun.create).mock.calls[0]![0] as any
    expect(createArgs.data.isConfident).toBe(false)
    expect(String(createArgs.data.fallbackReason)).toMatch(/clientEmail/)
  })

  it('applies the same tenant + engagement gate to AI-planned queries', async () => {
    vi.mocked(prisma.case.findMany).mockResolvedValue([
      { id: 'case-open',       hasEngagementTeam: false },
      { id: 'case-restricted', hasEngagementTeam: true },
    ] as any)
    vi.mocked(prisma.caseMember.findMany).mockResolvedValue([] as any) // no membership
    vi.mocked(planCaseSearch).mockResolvedValue({
      filters: [], explanation: 'no filters', isConfident: true,
    } as any)
    let where: any = null
    ;(prisma.caseSearchIndex.findMany as any).mockImplementation(async (args: any) => {
      where = args.where; return [] as any
    })
    await searchCasesWithAI({ question: 'show me all cases' })
    expect(JSON.stringify(where)).toContain('case-open')
    expect(JSON.stringify(where)).not.toContain('case-restricted')
  })
})
