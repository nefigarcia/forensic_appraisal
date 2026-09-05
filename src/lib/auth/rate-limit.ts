/**
 * Login rate limiting.
 *
 * Design: a `LoginAttempt` row is written for each real login attempt
 * (success or failure). Before accepting a new attempt we count the failed
 * rows for the target email in the last WINDOW_MINUTES minutes and reject
 * once the count reaches THRESHOLD. Rejected attempts do NOT write a new
 * LoginAttempt row (would let an attacker flood the table); the audit log
 * captures them as `LOGIN_RATE_LIMITED`.
 *
 * This is a database-backed limiter — works with a single-instance deploy
 * and with horizontal scale (the DB is the shared state). If read/write
 * pressure ever becomes a concern, swap in Redis / Memcache without
 * changing the callers.
 */

import { prisma } from '@/lib/prisma'

export const WINDOW_MINUTES = 15
export const THRESHOLD      = 5

export class RateLimitedError extends Error {
  constructor(message = 'Too many login attempts. Try again in 15 minutes.') {
    super(message)
    this.name = 'RateLimitedError'
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Throw RateLimitedError if the caller has exceeded the threshold. */
export async function assertNotRateLimited(email: string): Promise<void> {
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000)
  const fails = await prisma.loginAttempt.count({
    where: {
      email:     normalizeEmail(email),
      ok:        false,
      createdAt: { gte: windowStart },
    },
  })
  if (fails >= THRESHOLD) throw new RateLimitedError()
}

/** Persist an attempt (success or failure) for future rate-limit checks. */
export async function recordLoginAttempt(
  email:     string,
  ipAddress: string | null,
  ok:        boolean,
  reason?:   'BAD_PASSWORD' | 'UNKNOWN_USER' | 'MFA_FAIL' | null,
): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      email:     normalizeEmail(email),
      ipAddress,
      ok,
      reason:    reason ?? null,
    },
  })
}
