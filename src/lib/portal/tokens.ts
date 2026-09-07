/**
 * Opaque portal-access tokens.
 *
 * The raw token exists exclusively in the URL that we email a client
 * contact. Only its SHA-256 hex hash lands in the database (see
 * `PortalAccess.tokenHash`). A DB dump therefore never leaks a usable
 * portal link.
 *
 * A portal token is NOT a JWT. That is intentional:
 *   - JWTs would embed an org/user identity in a signed claim; a
 *     client-side leak of the signing key would let an attacker mint
 *     tokens for any org. The opaque scheme requires a DB write per
 *     issued token, so revocation is a real, per-token capability.
 *   - Portal callers never receive a firm session cookie. Every portal
 *     request re-verifies the raw token against the DB — no ambient
 *     ambient auth that could leak into other tabs / origins.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto'

// 32 bytes = 256 bits of entropy; base64url-encoded ≈ 43 chars.
const TOKEN_BYTES = 32

/** Default lifetime for a fresh portal invite. */
export const PORTAL_TOKEN_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export function generatePortalToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  return { token, tokenHash: hashPortalToken(token) }
}

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison of two hex-encoded SHA-256 hashes. */
export function timingSafeHashEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  // Reject empty inputs even if both are equal-length — a zero-length
  // "hash" is never a legitimate comparison target.
  if (a.length === 0 || b.length === 0) return false
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/** Cheap shape sanity — reject obviously-invalid strings before hashing. */
export function looksLikePortalToken(raw: unknown): raw is string {
  return typeof raw === 'string'
    && raw.length >= 40
    && raw.length <= 200
    && /^[A-Za-z0-9_-]+$/.test(raw)
}
