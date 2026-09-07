'use server'

/**
 * Password-reset flow (request + complete).
 *
 * Anti-enumeration: `requestPasswordReset` returns the same shape whether
 * or not the email exists. The AuditLog records the outcome server-side.
 *
 * Token: 32 bytes of crypto-random, returned to the caller as a URL-safe
 * base64 string. Only its SHA-256 hash is stored. Tokens are valid for
 * 1 hour and are single-use (`consumedAt` gates re-use).
 *
 * On successful completion: bump `User.passwordChangedAt` so every session
 * JWT issued before that timestamp is treated as revoked by `getSession()`.
 */

import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { generateToken, hashToken } from '@/lib/auth/tokens'
import { hashPassword } from '@/lib/auth/passwords'
import { sendMail } from '@/lib/mailer'
import { logAction } from '@/lib/audit'
import { headers } from 'next/headers'

const RESET_TTL_MS = 60 * 60 * 1000 // 1 hour

async function clientIp(): Promise<string | null> {
  try {
    const h = await headers()
    return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip')
  } catch { return null }
}

export async function requestPasswordReset(rawEmail: string): Promise<{ ok: true }> {
  const email = (rawEmail ?? '').trim().toLowerCase()
  const ip = await clientIp()

  // Never leak whether the address exists.
  const user = await prisma.user.findUnique({ where: { email } })
  if (user) {
    const { token, tokenHash } = generateToken()
    const expiresAt = new Date(Date.now() + RESET_TTL_MS)
    await prisma.passwordResetToken.create({
      data: { tokenHash, userId: user.id, expiresAt },
    })
    const url = `${env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`
    await sendMail({
      to:       user.email,
      subject:  'Reset your ValuVault password',
      category: 'password-reset',
      text:
        `A password reset was requested for your ValuVault account.\n\n` +
        `Reset link (valid for 1 hour): ${url}\n\n` +
        `If you did not request this, you can safely ignore this email.`,
    })
    await logAction({
      userId: user.id, action: 'PASSWORD_RESET_REQUESTED',
      ipAddress: ip ?? undefined,
    })
  } else {
    // Log the miss anonymously so operators can see enum attempts.
    await logAction({
      userId: null, action: 'PASSWORD_RESET_REQUESTED',
      note: `unknown-email`, ipAddress: ip ?? undefined,
    })
  }
  return { ok: true }
}

export async function completePasswordReset(
  rawToken: string,
  newPassword: string,
): Promise<{ ok: true } | { error: string }> {
  if (!rawToken || !newPassword) return { error: 'Missing token or password' }
  if (newPassword.length < 8)    return { error: 'Password must be at least 8 characters' }

  const tokenHash = hashToken(rawToken)
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } })
  if (!row)                       return { error: 'Invalid or expired token' }
  if (row.consumedAt)             return { error: 'Invalid or expired token' }
  if (row.expiresAt < new Date()) return { error: 'Invalid or expired token' }

  const hashed = await hashPassword(newPassword)
  const now = new Date()

  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data:  { password: hashed, passwordChangedAt: now },
    }),
    prisma.passwordResetToken.update({
      where: { tokenHash },
      data:  { consumedAt: now },
    }),
    // Invalidate every other outstanding reset token for this user in one shot.
    prisma.passwordResetToken.updateMany({
      where: { userId: row.userId, consumedAt: null, tokenHash: { not: tokenHash } },
      data:  { consumedAt: now },
    }),
  ])

  const ip = await clientIp()
  await logAction({
    userId: row.userId, action: 'PASSWORD_RESET_COMPLETED',
    ipAddress: ip ?? undefined,
  })
  await logAction({
    userId: row.userId, action: 'PASSWORD_CHANGED',
    note: 'via-reset', ipAddress: ip ?? undefined,
  })

  return { ok: true }
}
