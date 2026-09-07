'use server'

/**
 * Email verification (send + verify).
 *
 * Not enforced anywhere in Slice 2 — signup still logs the user in and
 * routes to /dashboard as before. This slice provides the architecture
 * (schema, actions, verify route). A later slice may gate specific
 * capabilities on `User.emailVerifiedAt`.
 */

import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { generateToken, hashToken } from '@/lib/auth/tokens'
import { sendMail } from '@/lib/mailer'
import { logAction } from '@/lib/audit'
import { requireSession } from '@/lib/authz'

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Send (or resend) the verification email to the current user. */
export async function sendEmailVerification(): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession()
  const user = await prisma.user.findUnique({ where: { id: session.userId } })
  if (!user) return { error: 'User not found' }
  if (user.emailVerifiedAt) return { ok: true } // idempotent

  const { token, tokenHash } = generateToken()
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS)
  await prisma.emailVerificationToken.create({
    data: { tokenHash, userId: user.id, expiresAt },
  })
  const url = `${env.NEXT_PUBLIC_APP_URL}/api/verify-email/${token}`
  await sendMail({
    to:       user.email,
    subject:  'Verify your ValuVault email address',
    category: 'email-verification',
    text:
      `Please verify your email address by visiting:\n\n${url}\n\n` +
      `This link is valid for 24 hours.`,
  })
  await logAction({ userId: user.id, action: 'EMAIL_VERIFICATION_SENT' })
  return { ok: true }
}

/** Consume a verification token. Returns the userId on success. */
export async function verifyEmailToken(rawToken: string): Promise<{ userId: string } | { error: string }> {
  const tokenHash = hashToken(rawToken)
  const row = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } })
  if (!row)                       return { error: 'Invalid or expired token' }
  if (row.consumedAt)             return { error: 'Invalid or expired token' }
  if (row.expiresAt < new Date()) return { error: 'Invalid or expired token' }

  const now = new Date()
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data:  { emailVerifiedAt: now },
    }),
    prisma.emailVerificationToken.update({
      where: { tokenHash },
      data:  { consumedAt: now },
    }),
  ])
  await logAction({ userId: row.userId, action: 'EMAIL_VERIFIED' })
  return { userId: row.userId }
}
