/**
 * MFA (TOTP) architecture — schema + skeleton helpers.
 *
 * Slice 2 lands the storage model and the flow contract but NOT a working
 * TOTP verifier. Enrollment records a random base32 secret and the login
 * flow will branch on `User.mfaEnabled`; a future slice will pull in a
 * TOTP library (e.g. `otplib`) and replace the stubs below.
 *
 * The public surface of this module is intentionally stable so callers
 * — the login action, an enrollment page, an account settings page —
 * can be built against it now and remain source-compatible when the
 * real implementation lands.
 */

import { randomBytes, createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

export class MfaNotImplementedError extends Error {
  constructor(message = 'MFA verification is not yet implemented') {
    super(message)
    this.name = 'MfaNotImplementedError'
  }
}

/** RFC-3548 base32 alphabet (no padding). */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Produce a fresh 20-byte TOTP secret encoded as base32 (32 chars). */
export function generateBase32Secret(bytes = 20): string {
  const buf = randomBytes(bytes)
  let bits = ''
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0')
    out += BASE32_ALPHABET[Number.parseInt(chunk, 2)]
  }
  return out
}

/** Produce a set of 10 single-use backup codes and their hashes. */
export function generateBackupCodes(count = 10): { code: string; codeHash: string }[] {
  const rows: { code: string; codeHash: string }[] = []
  for (let i = 0; i < count; i++) {
    // 5 bytes → 8 base32 chars; user-friendly to type as `XXXX-XXXX`.
    const raw = generateBase32Secret(5)
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`
    const codeHash = createHash('sha256').update(code).digest('hex')
    rows.push({ code, codeHash })
  }
  return rows
}

/**
 * Begin enrollment: create/overwrite the pending secret for a user. Returns
 * the base32 secret and a `otpauth://` provisioning URI suitable for a QR.
 * Caller must persist the returned raw secret before showing it to the user.
 */
export async function beginMfaEnrollment(
  userId: string,
  accountLabel: string,
  issuer = 'ValuVault',
): Promise<{ secret: string; provisioningUri: string }> {
  const secret = generateBase32Secret()
  await prisma.mfaSecret.upsert({
    where:  { userId },
    update: { secret, verifiedAt: null },
    create: { userId, secret },
  })
  const label = encodeURIComponent(`${issuer}:${accountLabel}`)
  const provisioningUri =
    `otpauth://totp/${label}?secret=${secret}` +
    `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
  return { secret, provisioningUri }
}

/**
 * Finalize enrollment: check that the user can produce a valid TOTP for
 * the pending secret. Slice 2 does not yet ship the verifier — a future
 * slice must implement RFC 6238 with a ±1 window.
 */
export async function verifyMfaEnrollment(_userId: string, _code: string): Promise<boolean> {
  throw new MfaNotImplementedError()
}

/** Verify a TOTP presented during login. Future work. */
export async function verifyMfaLogin(_userId: string, _code: string): Promise<boolean> {
  throw new MfaNotImplementedError()
}

/** Consume a backup code exactly once. */
export async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const codeHash = createHash('sha256').update(code).digest('hex')
  const row = await prisma.mfaBackupCode.findFirst({
    where: { userId, codeHash, usedAt: null },
  })
  if (!row) return false
  await prisma.mfaBackupCode.update({
    where: { id: row.id },
    data:  { usedAt: new Date() },
  })
  return true
}
