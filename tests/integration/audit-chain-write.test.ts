import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Chained-write integration. We don't hit a real DB; we mock Prisma at
 * the transaction boundary and inspect the row payload we'd insert. That
 *'s enough to prove:
 *   - logAction reads the tail, computes sequence + previousHash
 *   - the eventHash in the persisted row matches computeEventHash of the
 *     canonical payload we intended to hash
 *   - a P2002 collision triggers a retry
 *   - a final failure falls back to an unchained insert (event is not lost)
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => {
      // Simulate a transaction: pass an object with the same mocks.
      const tx = {
        auditLog: {
          findFirst: (prisma.auditLog.findFirst as any),
          create:    (prisma.auditLog.create as any),
        },
      }
      return fn(tx)
    }),
  },
}))

import { prisma } from '@/lib/prisma'
import { logAction } from '@/lib/audit'
import { computeEventHash, chainKeyForOrg } from '@/lib/audit-chain'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('logAction — first event in a chain (genesis)', () => {
  it('reads no tail, writes sequence=1 and previousHash=null', async () => {
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    await logAction({
      userId: 'user-1',
      organizationId: 'org-1',
      action: 'ACCEPT_VALUE',
      caseId: 'case-1',
      targetModel: 'FinancialValue',
      targetId: 'fv-1',
    })

    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.auditLog.create).toHaveBeenCalledOnce()
    const data = vi.mocked(prisma.auditLog.create).mock.calls[0]![0]!.data as any
    expect(data.chainKey).toBe(chainKeyForOrg('org-1'))
    expect(data.sequence).toBe(1)
    expect(data.previousHash).toBeNull()
    expect(data.hashVersion).toBe('v1')
    // eventHash is exactly what recomputing the canonical payload would produce.
    expect(data.eventHash).toBe(computeEventHash({
      id: data.id,
      createdAt: data.createdAt,
      chainKey: data.chainKey,
      sequence: data.sequence,
      hashVersion: data.hashVersion,
      action: data.action,
      userId: data.userId,
      caseId: data.caseId,
      targetModel: data.targetModel,
      targetId: data.targetId,
      oldValue: data.oldValue ?? null,
      newValue: data.newValue ?? null,
      note: data.note ?? null,
      ipAddress: data.ipAddress ?? null,
      previousHash: data.previousHash,
    }))
  })
})

describe('logAction — Nth event', () => {
  it('reads the tail and links via previousHash', async () => {
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue({
      sequence: 42,
      eventHash: 'a'.repeat(64),
    } as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    await logAction({
      userId: 'user-1',
      organizationId: 'org-1',
      action: 'OVERRIDE_VALUE',
    })

    const data = vi.mocked(prisma.auditLog.create).mock.calls[0]![0]!.data as any
    expect(data.sequence).toBe(43)
    expect(data.previousHash).toBe('a'.repeat(64))
  })
})

describe('logAction — chain-key resolution', () => {
  it('infers chainKey from caseId → Case.organizationId when organizationId is absent', async () => {
    vi.mocked(prisma.case.findUnique).mockResolvedValue({ organizationId: 'org-inferred' } as any)
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    await logAction({ userId: 'u1', action: 'SAVE_VALUATION', caseId: 'case-x' })

    const data = vi.mocked(prisma.auditLog.create).mock.calls[0]![0]!.data as any
    expect(data.chainKey).toBe(chainKeyForOrg('org-inferred'))
  })

  it('infers from userId when there is no caseId', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ organizationId: 'org-user' } as any)
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    await logAction({ userId: 'u1', action: 'LOGOUT' })

    const data = vi.mocked(prisma.auditLog.create).mock.calls[0]![0]!.data as any
    expect(data.chainKey).toBe(chainKeyForOrg('org-user'))
  })

  it('falls back to global:anon when neither user nor case is available', async () => {
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    await logAction({ userId: null, action: 'LOGIN_RATE_LIMITED', note: 'stranger@x.com' })

    const data = vi.mocked(prisma.auditLog.create).mock.calls[0]![0]!.data as any
    expect(data.chainKey).toBe('global:anon')
  })
})

describe('logAction — race handling', () => {
  it('retries on P2002 and succeeds on the second attempt', async () => {
    // First attempt: tail is null, sequence=1. But the create throws P2002 (someone else got 1 first).
    // Second attempt: tail sequence=1, sequence=2, success.
    vi.mocked(prisma.auditLog.findFirst)
      .mockResolvedValueOnce(null)                                              // attempt 1
      .mockResolvedValueOnce({ sequence: 1, eventHash: 'b'.repeat(64) } as any) // attempt 2

    const p2002 = Object.assign(new Error('unique constraint'), { code: 'P2002' })
    vi.mocked(prisma.auditLog.create)
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({} as any)

    await logAction({ userId: 'u1', organizationId: 'org-1', action: 'ACCEPT_VALUE' })

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2)
    const finalArgs = vi.mocked(prisma.auditLog.create).mock.calls[1]![0]!.data as any
    expect(finalArgs.sequence).toBe(2)
    expect(finalArgs.previousHash).toBe('b'.repeat(64))
  })

  it('falls back to an unchained insert after exhausting retries — the event is not lost', async () => {
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null)
    const p2002 = Object.assign(new Error('unique constraint'), { code: 'P2002' })
    vi.mocked(prisma.auditLog.create)
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({} as any) // unchained fallback

    await logAction({ userId: 'u1', organizationId: 'org-1', action: 'ACCEPT_VALUE' })
    // 3 chained attempts + 1 unchained fallback = 4 create calls.
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(4)
    const fallbackArgs = vi.mocked(prisma.auditLog.create).mock.calls[3]![0]!.data as any
    // The fallback insert has NO chain fields.
    expect(fallbackArgs.chainKey).toBeUndefined()
    expect(fallbackArgs.sequence).toBeUndefined()
    expect(fallbackArgs.eventHash).toBeUndefined()
  })
})
