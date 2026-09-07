/**
 * JWT session encoding/decoding + cookie read.
 *
 * Changes in Slice 2:
 *  - The insecure default `"secret_key_for_prototype_only"` fallback is
 *    gone. The signing key comes from the Zod-validated `env` module,
 *    which throws at boot if `JWT_SECRET` is unset or too short.
 *  - Every token now carries a `jti` (JWT ID) so specific sessions can
 *    be revoked server-side via `src/lib/session.ts::revokeSession`.
 *  - `getSession()` decodes, validates the signature, checks that the
 *    jti has not been revoked, AND checks that the token was issued
 *    after the user's `passwordChangedAt`. Any failure returns `null` —
 *    the caller must handle it the same way it handles "no session".
 */

import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { env } from './env'
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  sessionCookieAttrs,
  isRevoked,
} from './session'
import { prisma } from './prisma'

// Use Web Crypto (available as a global in Node ≥19 and in the Edge runtime)
// instead of Node's `crypto` module so this file is safe to import from
// middleware.ts, which runs in the Edge runtime.
declare const crypto: { randomUUID: () => string }

const key = new TextEncoder().encode(env.JWT_SECRET)

export interface SessionPayload {
  userId: string
  organizationId: string
  role: string
  email: string
  /** Present on tokens issued after Slice 2; runtime tolerates absence
   *  for legacy cookies until they expire naturally. */
  jti?: string
  iat?: number
  exp?: number
}

export type SessionInput = Omit<SessionPayload, 'jti' | 'iat' | 'exp'>

/**
 * Sign a new session JWT. Returns the token, its jti (so callers can
 * later revoke it), and the absolute expiry.
 */
export async function createSessionToken(
  payload: SessionInput,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setJti(jti)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key)
  return { token, jti, expiresAt }
}

/** Verify signature and expiry; throws on failure. */
export async function decrypt(input: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(input, key, { algorithms: ['HS256'] })
  return payload as unknown as SessionPayload
}

/**
 * Read + verify the session cookie. Returns null if any of:
 *   - the cookie is absent
 *   - the JWT signature/expiry is invalid
 *   - the jti has been revoked
 *   - the token was issued before the user's `passwordChangedAt`
 */
export async function getSession(): Promise<SessionPayload | null> {
  const raw = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  if (!raw) return null
  let payload: SessionPayload
  try {
    payload = await decrypt(raw)
  } catch {
    return null
  }
  if (!payload?.userId || !payload?.organizationId) return null

  // Per-token revocation.
  if (payload.jti) {
    try {
      if (await isRevoked(payload.jti)) return null
    } catch {
      // If the revocation store is unreachable we fail closed by treating
      // the session as invalid — better to force a re-login than to trust
      // a possibly-revoked token.
      return null
    }
  }

  // Per-user invalidation via password change. Only compare when we have
  // both an `iat` claim and a `passwordChangedAt` on the user row.
  if (payload.iat) {
    try {
      const u = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { passwordChangedAt: true },
      })
      const pca = u?.passwordChangedAt
      if (pca && pca.getTime() / 1000 > payload.iat) return null
    } catch {
      return null
    }
  }

  return payload
}

/**
 * Middleware helper: re-issues the cookie with a fresh absolute expiry.
 * Kept for API compatibility with the original module; not currently
 * called from middleware.ts.
 */
export async function updateSession(request: NextRequest) {
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!raw) return
  let payload: SessionPayload
  try {
    payload = await decrypt(raw)
  } catch {
    return
  }
  const { token, expiresAt } = await createSessionToken({
    userId:         payload.userId,
    organizationId: payload.organizationId,
    role:           payload.role,
    email:          payload.email,
  })
  const res = NextResponse.next()
  res.cookies.set(sessionCookieAttrs(token, expiresAt))
  return res
}
