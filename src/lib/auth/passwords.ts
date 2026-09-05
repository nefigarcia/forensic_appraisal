/**
 * Password hashing with bcrypt + opportunistic cost upgrade on login.
 *
 * The existing user base was hashed at cost 10. Bcrypt encodes its cost
 * in the hash itself (`$2a$10$…` vs `$2a$12$…`), so we can transparently
 * upgrade an old hash the next time the owner logs in successfully —
 * without a schema change and without forcing a password reset.
 */

import bcrypt from 'bcryptjs'

/** New hashes use cost 12 (OWASP 2023 recommendation). */
export const BCRYPT_COST = 12

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST)
}

export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash)
}

/**
 * Returns true if the given hash was produced with a cost below the current
 * target. Callers should re-hash the plaintext (already verified) and
 * persist the new hash. Bcrypt hashes look like:
 *     $2a$<cost>$<22-char-salt><31-char-hash>
 */
export function needsRehash(hash: string): boolean {
  const match = /^\$2[abxy]\$(\d{2})\$/.exec(hash)
  if (!match) return true // unknown format → rehash to safe format
  const cost = Number.parseInt(match[1]!, 10)
  return Number.isNaN(cost) || cost < BCRYPT_COST
}
