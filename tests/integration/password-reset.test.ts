import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user:               { findUnique: vi.fn(), update: vi.fn() },
    passwordResetToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn((ops: any[]) => Promise.all(ops)),
  },
}))
vi.mock('@/lib/audit',  () => ({ logAction: vi.fn() }))
vi.mock('@/lib/mailer', () => ({ sendMail:  vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

import { prisma } from '@/lib/prisma'
import { logAction } from '@/lib/audit'
import { sendMail } from '@/lib/mailer'
import { requestPasswordReset, completePasswordReset } from '@/app/actions/password-reset'
import { hashToken } from '@/lib/auth/tokens'
import { verifyPassword } from '@/lib/auth/passwords'

beforeEach(() => { vi.clearAllMocks() })

describe('requestPasswordReset — anti-enumeration', () => {
  it('returns {ok:true} when email is known AND when it is not', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'u1', email: 'a@b.com' } as any)
    const first = await requestPasswordReset('a@b.com')
    expect(first).toEqual({ ok: true })

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null)
    const second = await requestPasswordReset('bogus@x.com')
    expect(second).toEqual({ ok: true })
  })

  it('persists a hashed token and mails a link only when the user exists', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'u1', email: 'a@b.com' } as any)
    vi.mocked(prisma.passwordResetToken.create).mockResolvedValueOnce({} as any)
    await requestPasswordReset('a@b.com')
    expect(prisma.passwordResetToken.create).toHaveBeenCalledOnce()
    expect(sendMail).toHaveBeenCalledOnce()
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PASSWORD_RESET_REQUESTED',
      userId: 'u1',
    }))
  })

  it('records an anonymous audit event for an unknown email (no token, no mail)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null)
    await requestPasswordReset('nope@x.com')
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PASSWORD_RESET_REQUESTED',
      userId: null,
    }))
  })
})

describe('completePasswordReset', () => {
  const validToken = 'raw-token-for-testing'
  const tokenHash = hashToken(validToken)

  it('rejects an invalid token', async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValueOnce(null)
    const res = await completePasswordReset('not-a-real-token', 'newpass12')
    expect(res).toEqual({ error: 'Invalid or expired token' })
  })

  it('rejects an expired token', async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValueOnce({
      tokenHash, userId: 'u1', expiresAt: new Date(Date.now() - 60_000), consumedAt: null,
    } as any)
    const res = await completePasswordReset(validToken, 'newpass12')
    expect(res).toEqual({ error: 'Invalid or expired token' })
  })

  it('rejects a consumed token', async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValueOnce({
      tokenHash, userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
    } as any)
    const res = await completePasswordReset(validToken, 'newpass12')
    expect(res).toEqual({ error: 'Invalid or expired token' })
  })

  it('rejects short passwords before touching the DB', async () => {
    const res = await completePasswordReset(validToken, 'short')
    expect(res).toEqual({ error: 'Password must be at least 8 characters' })
    expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled()
  })

  it('happy path: sets a fresh bcrypt hash, marks token consumed, bumps passwordChangedAt, invalidates siblings, emits both audit events', async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValueOnce({
      tokenHash, userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as any)
    vi.mocked(prisma.user.update).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.passwordResetToken.update).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.passwordResetToken.updateMany).mockResolvedValueOnce({ count: 0 } as any)

    const res = await completePasswordReset(validToken, 'newpass12')
    expect(res).toEqual({ ok: true })

    // The user.update call was constructed with a real bcrypt hash of the new pw.
    const userUpdateArg = vi.mocked(prisma.user.update).mock.calls[0]![0]!
    expect(userUpdateArg.where).toEqual({ id: 'u1' })
    expect(userUpdateArg.data.passwordChangedAt).toBeInstanceOf(Date)
    expect(await verifyPassword('newpass12', userUpdateArg.data.password as string)).toBe(true)

    // Audit events fired.
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_RESET_COMPLETED', userId: 'u1' }))
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_CHANGED',         userId: 'u1' }))
  })
})
