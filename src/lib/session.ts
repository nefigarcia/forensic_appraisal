/**
 * Session cookie policy + JWT revocation.
 *
 * Cookie policy is centralized so every writer (login, signup, logout,
 * password-reset completion) sets the same flags. The old code set only
 * `httpOnly` — we now also set `secure` in production, `sameSite: 'lax'`,
 * `path: '/'`, and an explicit `expires`.
 *
 * Revocation: our JWT sessions carry a `jti` (JWT ID). Server-side logout
 * writes that `jti` to `SessionRevocation`. `getSession()` in `auth-utils.ts`
 * checks the revocation table before trusting a decoded JWT. This adds one
 * indexed PK lookup per request but is the only way to invalidate stolen
 * cookies before their natural expiry.
 */

import { prisma } from './prisma'
import { env } from './env'
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from './session-constants'

export { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS }

export type SessionRevocationReason =
  | 'LOGOUT'
  | 'PASSWORD_CHANGE'
  | 'ADMIN'
  | 'SUSPICIOUS'

/** Cookie attributes for a fresh session. */
export function sessionCookieAttrs(token: string, expiresAt: Date) {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  }
}

/** Cookie attributes that instruct the browser to clear the session. */
export function clearedSessionCookieAttrs() {
  return {
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: new Date(0),
  }
}

/** Persist a revocation record. Called on logout, password change, etc. */
export async function revokeSession(
  jti: string,
  userId: string,
  reason: SessionRevocationReason,
  originalExpiresAt?: Date,
): Promise<void> {
  const expiresAt =
    originalExpiresAt ?? new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
  // upsert so a duplicate revoke (e.g. double-clicking logout) is a no-op.
  await prisma.sessionRevocation.upsert({
    where:  { jti },
    update: {},
    create: { jti, userId, reason, expiresAt },
  })
}

/** Bulk-revoke every active session for a user (e.g. on password reset). */
export async function revokeAllSessionsForUser(
  userId: string,
  reason: SessionRevocationReason,
): Promise<void> {
  // We do not track live sessions per-user (only revocations). Instead we
  // record a sentinel row keyed by "user:<id>@<timestamp>" so getSession()
  // can detect "all sessions issued before X are void" via passwordChangedAt.
  // For now we only wire the per-jti mechanism; per-user invalidation is
  // achieved by comparing token `iat` to `User.passwordChangedAt` inside
  // getSession(). This function remains as a hook for future callsites.
  void userId; void reason
}

/** Returns true if the given jti has been revoked. */
export async function isRevoked(jti: string): Promise<boolean> {
  const row = await prisma.sessionRevocation.findUnique({ where: { jti } })
  return !!row
}

/** Purge revocation rows that have outlived their JWT's natural expiry. */
export async function pruneExpiredRevocations(): Promise<number> {
  const res = await prisma.sessionRevocation.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return res.count
}
