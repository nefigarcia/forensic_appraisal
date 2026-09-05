/**
 * One-time-use random tokens for password reset and email verification.
 *
 * Design: generate a 32-byte cryptographically random token, return it to
 * the caller as a URL-safe base64 string, and store ONLY its SHA-256 hash
 * in the database. Verification hashes the incoming token and looks up by
 * hash. This means a DB dump does not leak usable tokens.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto'

/** Length of the raw token in bytes (256 bits of entropy). */
const TOKEN_BYTES = 32

export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const tokenHash = hashToken(token)
  return { token, tokenHash }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison of two hex-encoded hashes of equal length. */
export function timingSafeHashEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}
