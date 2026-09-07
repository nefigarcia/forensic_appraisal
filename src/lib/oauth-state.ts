/**
 * OAuth `state` binding for CSRF protection.
 *
 * The previous Microsoft OAuth route hard-coded `state=forensic_valuvault`.
 * A hard-coded state is not a state — it is a constant. An attacker on the
 * same host can forge callbacks because the client cannot distinguish a
 * genuine round trip from a replayed one.
 *
 * Fix: generate 32 random bytes per authorization request. Store the state
 * in an HttpOnly cookie scoped to this browser. The callback compares the
 * `state` query parameter against the cookie value in constant time. Any
 * mismatch, missing cookie, or expired cookie is rejected.
 *
 * Cookie policy matches the session cookie: `httpOnly`, `sameSite=lax`,
 * `secure` in production, `path=/`, TTL 10 minutes.
 */

import { randomBytes, timingSafeEqual } from 'crypto'
import { env } from '@/lib/env'

export const OAUTH_STATE_COOKIE = 'oauth_state'
export const OAUTH_STATE_TTL_SECONDS = 10 * 60 // 10 minutes

export function generateOAuthState(): string {
  // base64url, no padding — safe as a URL query parameter and as a cookie value.
  return randomBytes(32).toString('base64url')
}

/** Cookie attributes for a fresh OAuth state token. */
export function oauthStateCookieAttrs(state: string) {
  return {
    name: OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: OAUTH_STATE_TTL_SECONDS,
  }
}

/** Cookie attributes to clear the state cookie once verified. */
export function clearedOauthStateCookieAttrs() {
  return {
    name: OAUTH_STATE_COOKIE,
    value: '',
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: new Date(0),
  }
}

/**
 * Constant-time comparison of the state parameter presented by the OAuth
 * provider against the value we stored in the cookie at redirect time.
 *
 * Returns `true` only if:
 *   - both values are non-empty strings
 *   - they have identical length (otherwise timingSafeEqual throws)
 *   - they match byte-for-byte
 */
export function verifyOAuthState(
  presented: string | null | undefined,
  cookieValue: string | null | undefined,
): boolean {
  if (!presented || !cookieValue)         return false
  if (presented.length !== cookieValue.length) return false
  try {
    return timingSafeEqual(
      Buffer.from(presented,   'utf8'),
      Buffer.from(cookieValue, 'utf8'),
    )
  } catch {
    return false
  }
}
