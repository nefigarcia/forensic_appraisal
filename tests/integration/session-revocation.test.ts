import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sessionRevocation: {
      upsert:      vi.fn().mockResolvedValue({}),
      findUnique:  vi.fn(),
      deleteMany:  vi.fn().mockResolvedValue({ count: 3 }),
    },
    user: { findUnique: vi.fn() },
  },
}))

let cookieStore: Record<string, string> = {}
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore[name] ? { value: cookieStore[name] } : undefined),
    set: (attrs: any) => { cookieStore[attrs.name] = attrs.value },
  }),
}))

import { prisma } from '@/lib/prisma'
import { createSessionToken, getSession } from '@/lib/auth-utils'
import {
  revokeSession,
  isRevoked,
  pruneExpiredRevocations,
} from '@/lib/session'

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) — we need to drain any queued
  // mockResolvedValueOnce implementations that a prior test's early-return
  // path left behind. Otherwise later tests see stale values. Reset wipes
  // factory defaults too, so we re-establish them here.
  vi.resetAllMocks()
  vi.mocked(prisma.sessionRevocation.upsert).mockResolvedValue({} as any)
  vi.mocked(prisma.sessionRevocation.deleteMany).mockResolvedValue({ count: 3 } as any)
  cookieStore = {}
})

describe('session revocation lifecycle', () => {
  it('createSessionToken embeds a jti and returns it', async () => {
    const { token, jti, expiresAt } = await createSessionToken({
      userId: 'u1', organizationId: 'org1', role: 'ADMIN', email: 'a@b.com',
    })
    expect(token.split('.').length).toBe(3)     // header.payload.sig
    expect(jti).toMatch(/^[0-9a-f-]{36}$/i)     // UUID
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('revokeSession upserts by jti so a duplicate call is a no-op', async () => {
    await revokeSession('some-jti', 'u1', 'LOGOUT', new Date(Date.now() + 60_000))
    expect(prisma.sessionRevocation.upsert).toHaveBeenCalledWith({
      where:  { jti: 'some-jti' },
      update: {},
      create: expect.objectContaining({ jti: 'some-jti', userId: 'u1', reason: 'LOGOUT' }),
    })
  })

  it('isRevoked reflects the persisted row', async () => {
    vi.mocked(prisma.sessionRevocation.findUnique).mockResolvedValueOnce(null)
    expect(await isRevoked('x')).toBe(false)
    vi.mocked(prisma.sessionRevocation.findUnique).mockResolvedValueOnce({ jti: 'x' } as any)
    expect(await isRevoked('x')).toBe(true)
  })

  it('getSession returns null when the jti has been revoked (even if signature is valid)', async () => {
    const { token, jti } = await createSessionToken({
      userId: 'u1', organizationId: 'org1', role: 'ADMIN', email: 'a@b.com',
    })
    cookieStore['session'] = token
    vi.mocked(prisma.sessionRevocation.findUnique).mockResolvedValueOnce({ jti } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ passwordChangedAt: null } as any)
    const result = await getSession()
    expect(result).toBeNull()
  })

  it('getSession returns the payload when nothing is revoked and password has not changed since issuance', async () => {
    const { token, jti } = await createSessionToken({
      userId: 'u1', organizationId: 'org1', role: 'ADMIN', email: 'a@b.com',
    })
    cookieStore['session'] = token
    vi.mocked(prisma.sessionRevocation.findUnique).mockResolvedValueOnce(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ passwordChangedAt: null } as any)
    const result = await getSession()
    expect(result?.jti).toBe(jti)
    expect(result?.userId).toBe('u1')
  })

  it('getSession returns null when the token predates User.passwordChangedAt', async () => {
    const { token } = await createSessionToken({
      userId: 'u1', organizationId: 'org1', role: 'ADMIN', email: 'a@b.com',
    })
    cookieStore['session'] = token
    vi.mocked(prisma.sessionRevocation.findUnique).mockResolvedValueOnce(null)
    // Password was rotated one second in the future — token.iat is behind it.
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      passwordChangedAt: new Date(Date.now() + 1000),
    } as any)
    const result = await getSession()
    expect(result).toBeNull()
  })

  it('getSession returns null on a malformed cookie', async () => {
    cookieStore['session'] = 'not.a.jwt'
    const result = await getSession()
    expect(result).toBeNull()
  })

  it('pruneExpiredRevocations calls deleteMany with expiresAt < now', async () => {
    const count = await pruneExpiredRevocations()
    expect(count).toBe(3)
    const arg = vi.mocked(prisma.sessionRevocation.deleteMany).mock.calls[0]![0]!
    const where = arg.where!
    expect(where.expiresAt).toHaveProperty('lt')
    expect((where.expiresAt as { lt: Date }).lt).toBeInstanceOf(Date)
  })
})
