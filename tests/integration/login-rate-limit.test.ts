import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    loginAttempt: { count: vi.fn(), create: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  assertNotRateLimited,
  recordLoginAttempt,
  RateLimitedError,
  WINDOW_MINUTES,
  THRESHOLD,
} from '@/lib/auth/rate-limit'

beforeEach(() => {
  vi.mocked(prisma.loginAttempt.count).mockReset()
  vi.mocked(prisma.loginAttempt.create).mockReset()
})

describe('login rate limiter', () => {
  it('counts failed attempts within a 15-minute window scoped by email', async () => {
    vi.mocked(prisma.loginAttempt.count).mockResolvedValue(0)
    await assertNotRateLimited('user@example.com')
    const call = vi.mocked(prisma.loginAttempt.count).mock.calls[0]![0]!
    expect(call.where).toMatchObject({
      email: 'user@example.com',
      ok: false,
    })
    expect(call.where!.createdAt).toEqual({
      gte: expect.any(Date),
    })
    const gte = (call.where!.createdAt as { gte: Date }).gte
    const windowMs = WINDOW_MINUTES * 60_000
    const now = Date.now()
    expect(now - gte.getTime()).toBeGreaterThanOrEqual(windowMs - 100)
    expect(now - gte.getTime()).toBeLessThanOrEqual(windowMs + 100)
  })

  it('permits a fresh caller under the threshold', async () => {
    vi.mocked(prisma.loginAttempt.count).mockResolvedValue(THRESHOLD - 1)
    await expect(assertNotRateLimited('u@x.com')).resolves.toBeUndefined()
  })

  it('rejects a caller at the threshold', async () => {
    vi.mocked(prisma.loginAttempt.count).mockResolvedValue(THRESHOLD)
    await expect(assertNotRateLimited('u@x.com')).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('rejects a caller past the threshold', async () => {
    vi.mocked(prisma.loginAttempt.count).mockResolvedValue(THRESHOLD + 5)
    await expect(assertNotRateLimited('u@x.com')).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('normalizes email to lowercase before counting', async () => {
    vi.mocked(prisma.loginAttempt.count).mockResolvedValue(0)
    await assertNotRateLimited('  User@Example.COM  ')
    const call = vi.mocked(prisma.loginAttempt.count).mock.calls[0]![0]!
    expect(call.where!.email).toBe('user@example.com')
  })

  it('recordLoginAttempt persists a row scoped to the normalized email', async () => {
    vi.mocked(prisma.loginAttempt.create).mockResolvedValue({} as any)
    await recordLoginAttempt(' A@B.COM ', '1.2.3.4', false, 'BAD_PASSWORD')
    expect(prisma.loginAttempt.create).toHaveBeenCalledWith({
      data: {
        email: 'a@b.com',
        ipAddress: '1.2.3.4',
        ok: false,
        reason: 'BAD_PASSWORD',
      },
    })
  })
})
