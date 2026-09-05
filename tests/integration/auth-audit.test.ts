import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user:              { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    organization:      { create: vi.fn() },
    loginAttempt:      { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({}) },
    sessionRevocation: { upsert: vi.fn(), findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation',  () => ({
  redirect: (path: string) => { throw new Error(`__REDIRECT__:${path}`) },
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: vi.fn(), get: vi.fn().mockReturnValue(undefined), delete: vi.fn() }),
  headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }),
}))

import { prisma } from '@/lib/prisma'
import { logAction } from '@/lib/audit'
import * as auth from '@/app/actions/auth'
import { hashPassword } from '@/lib/auth/passwords'
import { RateLimitedError } from '@/lib/auth/rate-limit'

beforeEach(() => { vi.clearAllMocks() })

async function makeFormData(fields: Record<string, string>): Promise<FormData> {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('login auditing', () => {
  it('emits LOGIN_FAIL with userId=null for an unknown email', async () => {
    vi.mocked(prisma.loginAttempt.count).mockResolvedValue(0)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    const res = await auth.login(await makeFormData({ email: 'nobody@x.com', password: 'zzz' }))
    expect(res).toEqual({ error: 'Invalid credentials' })
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LOGIN_FAIL', userId: null,
    }))
  })

  it('emits LOGIN_FAIL with the userId when the password is wrong', async () => {
    vi.mocked(prisma.loginAttempt.count).mockResolvedValue(0)
    const hash = await hashPassword('rightpass')
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', email: 'a@b.com', password: hash, role: 'ADMIN', organizationId: 'org1',
    } as any)
    const res = await auth.login(await makeFormData({ email: 'a@b.com', password: 'wrongpass' }))
    expect(res).toEqual({ error: 'Invalid credentials' })
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LOGIN_FAIL', userId: 'u1',
    }))
  })

  it('emits LOGIN_RATE_LIMITED without recording a new LoginAttempt row', async () => {
    vi.mocked(prisma.loginAttempt.count).mockResolvedValue(999) // above threshold
    const res = await auth.login(await makeFormData({ email: 'a@b.com', password: 'x' }))
    expect(res).toEqual({ error: 'Too many login attempts. Try again in 15 minutes.' })
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LOGIN_RATE_LIMITED', userId: null,
    }))
    // A rate-limited attempt does NOT write a LoginAttempt row (otherwise
    // an attacker can flood the table).
    expect(prisma.loginAttempt.create).not.toHaveBeenCalled()
  })

  it('emits LOGIN_SUCCESS on happy path', async () => {
    vi.mocked(prisma.loginAttempt.count).mockResolvedValue(0)
    const hash = await hashPassword('rightpass')
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', email: 'a@b.com', password: hash, role: 'ADMIN', organizationId: 'org1',
    } as any)

    // login() calls redirect() which we stubbed to throw a sentinel error.
    await expect(auth.login(await makeFormData({ email: 'a@b.com', password: 'rightpass' })))
      .rejects.toThrow(/__REDIRECT__:\/dashboard/)

    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LOGIN_SUCCESS', userId: 'u1',
    }))
    expect(prisma.loginAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'a@b.com', ok: true }),
    }))
  })

  it('rejects an unsafe returnTo and falls back to /dashboard', async () => {
    vi.mocked(prisma.loginAttempt.count).mockResolvedValue(0)
    const hash = await hashPassword('rightpass')
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', email: 'a@b.com', password: hash, role: 'ADMIN', organizationId: 'org1',
    } as any)
    await expect(auth.login(await makeFormData({
      email: 'a@b.com',
      password: 'rightpass',
      returnTo: 'https://evil.com/steal',
    }))).rejects.toThrow(/__REDIRECT__:\/dashboard/)
  })

  it('accepts a same-origin returnTo', async () => {
    vi.mocked(prisma.loginAttempt.count).mockResolvedValue(0)
    const hash = await hashPassword('rightpass')
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', email: 'a@b.com', password: hash, role: 'ADMIN', organizationId: 'org1',
    } as any)
    await expect(auth.login(await makeFormData({
      email: 'a@b.com',
      password: 'rightpass',
      returnTo: '/projects/xyz',
    }))).rejects.toThrow(/__REDIRECT__:\/projects\/xyz/)
  })
})

describe('signup auditing', () => {
  it('emits SIGNUP + LOGIN_SUCCESS', async () => {
    vi.mocked(prisma.organization.create).mockResolvedValue({ id: 'org1', name: 'Alpha Firm' } as any)
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'u1', email: 'a@b.com', role: 'ADMIN',
    } as any)
    await expect(auth.signup(await makeFormData({
      email: 'a@b.com', password: 'newpassword', name: 'Al', orgName: 'Alpha Firm',
    }))).rejects.toThrow(/__REDIRECT__:\/dashboard/)
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'SIGNUP',        userId: 'u1' }))
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN_SUCCESS', userId: 'u1' }))
  })
})
