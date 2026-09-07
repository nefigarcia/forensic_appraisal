/**
 * LOAD-BEARING: portal isolation.
 *
 * These tests prove the invariant of the Slice-12 design:
 *
 *   1. A caller with a raw portal token sees ONLY the RequestList that
 *      token was issued for. They never see:
 *        - other RequestLists in the same case,
 *        - other cases in the same firm,
 *        - firm-internal fields on the item they can see,
 *        - a firm session.
 *
 *   2. An expired, revoked, closed-list, or malformed token is
 *      indistinguishable from "no such token" — NotFoundError.
 *
 *   3. A portal upload can only touch a RequestItem whose parent
 *      RequestList matches the token's scope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    portalAccess:        { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    requestList:         { findUnique: vi.fn(), update: vi.fn() },
    requestItem:         { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    requestItemDocument: { create: vi.fn() },
    document:            { create: vi.fn(), update: vi.fn() },
    documentVersion:     { create: vi.fn(), findFirst: vi.fn() },
    clientContact:       { findUnique: vi.fn() },
    reminderEvent:       { create: vi.fn(), findFirst: vi.fn() },
    // portal-side actions must never depend on these — the mocks are here
    // to fail loudly if the code path ever regresses and touches them.
    case:                { findFirst: vi.fn().mockRejectedValue(new Error('portal must not call case.findFirst')) },
    user:                { findUnique: vi.fn().mockRejectedValue(new Error('portal must not call user.findUnique')) },
    caseMember:          { findUnique: vi.fn().mockRejectedValue(new Error('portal must not call caseMember.findUnique')) },
    $transaction:        vi.fn(async (fn: any) => fn({
      requestList:         { update: vi.fn() },
      requestItem:         { update: vi.fn(), updateMany: vi.fn() },
      requestItemDocument: { create: vi.fn() },
      document:            { create: vi.fn(), update: vi.fn() },
      documentVersion:     { create: vi.fn() },
    })),
  },
}))
vi.mock('@/lib/audit',    () => ({ logAction: vi.fn() }))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn().mockResolvedValue(null) }))
vi.mock('next/cache',     () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/s3-client', () => ({
  s3Client:   { send: vi.fn().mockResolvedValue({}) },
  BUCKET_NAME: 'test-bucket',
}))
vi.mock('@/lib/documents/scanner', () => ({
  scanner: () => ({ scanAsync: vi.fn().mockResolvedValue({ status: 'CLEAN' }) }),
}))

import { prisma } from '@/lib/prisma'
import { resolvePortalAccess } from '@/lib/portal/session'
import { generatePortalToken, hashPortalToken } from '@/lib/portal/tokens'
import { getPortalRequestList, uploadToRequestItem } from '@/app/actions/portal'
import { NotFoundError } from '@/lib/authz'

const FUTURE = new Date(Date.now() + 60_000)
const PAST   = new Date(Date.now() - 60_000)

function primeAccess(overrides: any = {}) {
  vi.mocked(prisma.portalAccess.findUnique).mockResolvedValue({
    tokenHash:       overrides.tokenHash ?? 'hash-abc',
    clientContactId: 'contact-1',
    requestListId:   'list-1',
    caseId:          'case-1',
    invitedBy:       'user-firm',
    invitedAt:       new Date(),
    expiresAt:       overrides.expiresAt ?? FUTURE,
    revokedAt:       overrides.revokedAt ?? null,
    lastUsedAt:      null,
    usageCount:      0,
    lastUsedIp:      null,
    clientContact: {
      id: 'contact-1', name: 'Client Person', email: 'client@example.com',
      isActive: overrides.contactActive ?? true,
    },
    requestList:   { id: 'list-1', status: overrides.listStatus ?? 'SENT', caseId: 'case-1' },
    case:          { id: 'case-1', organizationId: 'org-1' },
  } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────
// resolvePortalAccess — the load-bearing gate
// ─────────────────────────────────────────────────

describe('resolvePortalAccess', () => {
  it('accepts a well-formed unexpired unrevoked token', async () => {
    primeAccess()
    const scope = await resolvePortalAccess(generatePortalToken().token)
    expect(scope.requestListId).toBe('list-1')
    expect(scope.caseId).toBe('case-1')
    expect(scope.organizationId).toBe('org-1')
  })

  it('throws NotFoundError for a malformed token BEFORE any DB query', async () => {
    await expect(resolvePortalAccess('too-short')).rejects.toBeInstanceOf(NotFoundError)
    // No lookup should have happened — cheap-shape rejection.
    expect(prisma.portalAccess.findUnique).not.toHaveBeenCalled()
  })

  it('throws NotFoundError when the token has no matching row', async () => {
    vi.mocked(prisma.portalAccess.findUnique).mockResolvedValue(null as any)
    await expect(resolvePortalAccess(generatePortalToken().token))
      .rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when the token is revoked', async () => {
    primeAccess({ revokedAt: new Date() })
    await expect(resolvePortalAccess(generatePortalToken().token))
      .rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when the token is expired', async () => {
    primeAccess({ expiresAt: PAST })
    await expect(resolvePortalAccess(generatePortalToken().token))
      .rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when the parent list is CLOSED', async () => {
    primeAccess({ listStatus: 'CLOSED' })
    await expect(resolvePortalAccess(generatePortalToken().token))
      .rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when the client contact is deactivated', async () => {
    primeAccess({ contactActive: false })
    await expect(resolvePortalAccess(generatePortalToken().token))
      .rejects.toBeInstanceOf(NotFoundError)
  })
})

// ─────────────────────────────────────────────────
// Portal-side helpers must NOT touch firm-side infra
// ─────────────────────────────────────────────────

describe('portal actions are isolated from firm-side auth', () => {
  it('getPortalRequestList never calls case.findFirst / user.findUnique / caseMember.findUnique', async () => {
    primeAccess()
    vi.mocked(prisma.portalAccess.update).mockResolvedValue({} as any)
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({
      id: 'list-1', title: 'PBC', description: null,
      items: [
        {
          id: 'i-1', title: 'Tax returns', description: null,
          category: 'TAX', requestedFrom: null, dueDate: null,
          priority: 'NORMAL', status: 'REQUESTED', displayOrder: 0,
          clarificationNote: null, notes: 'firm-internal — NEVER RETURN',
          aiCompleteness: 'AUTO_COMPLETE', aiCompletenessConfident: true, aiCompletenessNote: null,
          assignedToUserId: 'user-firm-x', reviewerUserId: 'user-firm-y',
          documents: [],
        },
      ],
    } as any)
    const token = generatePortalToken().token
    const view = await getPortalRequestList(token)
    expect(view.items[0]!.title).toBe('Tax returns')
    // The firm-internal `notes` must never appear on the portal DTO.
    expect(JSON.stringify(view)).not.toContain('firm-internal')
    // The firm-internal assignedTo/reviewerUserId must not leak either.
    expect(JSON.stringify(view)).not.toContain('user-firm-x')
    expect(JSON.stringify(view)).not.toContain('user-firm-y')
    // We MUST NOT have hit any firm-side helper.
    expect(prisma.case.findFirst).not.toHaveBeenCalled()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.caseMember.findUnique).not.toHaveBeenCalled()
  })

  it('getPortalRequestList hides NOT_REQUESTED items from the client', async () => {
    primeAccess()
    vi.mocked(prisma.portalAccess.update).mockResolvedValue({} as any)
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({
      id: 'list-1', title: 'PBC', description: null, items: [],
    } as any)
    await getPortalRequestList(generatePortalToken().token)
    // The prisma call MUST include `status: { not: 'NOT_REQUESTED' }`.
    const call = vi.mocked(prisma.requestList.findUnique).mock.calls[0]![0] as any
    expect(call.include.items.where.status).toEqual({ not: 'NOT_REQUESTED' })
  })
})

// ─────────────────────────────────────────────────
// Cross-list upload attempt
// ─────────────────────────────────────────────────

describe('uploadToRequestItem — scope enforcement', () => {
  it('refuses when the requestItem belongs to a DIFFERENT list than the token', async () => {
    primeAccess()   // scope: list-1
    vi.mocked(prisma.requestItem.findUnique).mockResolvedValue({
      id: 'i-99', requestListId: 'DIFFERENT-list', caseId: 'case-1', status: 'REQUESTED',
    } as any)
    const fakeFile = new File([new Uint8Array([1, 2, 3])], 'evil.pdf', { type: 'application/pdf' })
    await expect(uploadToRequestItem({
      rawToken: generatePortalToken().token,
      requestItemId: 'i-99',
      file: fakeFile,
    })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses a fresh upload to a NOT_APPLICABLE item', async () => {
    primeAccess()
    vi.mocked(prisma.requestItem.findUnique).mockResolvedValue({
      id: 'i-1', requestListId: 'list-1', caseId: 'case-1', status: 'NOT_APPLICABLE',
    } as any)
    const fakeFile = new File([new Uint8Array([1, 2, 3])], 'x.pdf', { type: 'application/pdf' })
    await expect(uploadToRequestItem({
      rawToken: generatePortalToken().token, requestItemId: 'i-1', file: fakeFile,
    })).rejects.toThrow(/not applicable/)
  })
})

// ─────────────────────────────────────────────────
// The DB stores the HASH, never the raw token
// ─────────────────────────────────────────────────

describe('portal token storage', () => {
  it('resolvePortalAccess looks up by SHA-256(rawToken), not the raw value', async () => {
    primeAccess()
    const { token } = generatePortalToken()
    await resolvePortalAccess(token)
    const arg = vi.mocked(prisma.portalAccess.findUnique).mock.calls[0]![0] as any
    expect(arg.where.tokenHash).toBe(hashPortalToken(token))
    expect(arg.where.tokenHash).not.toBe(token)
  })
})
