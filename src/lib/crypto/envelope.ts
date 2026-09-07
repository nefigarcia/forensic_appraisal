/**
 * Envelope encryption for arbitrary UTF-8 strings.
 *
 * Design:
 *  1. Generate a fresh 32-byte DEK.
 *  2. Encrypt the plaintext with the DEK using AES-256-GCM.
 *  3. Wrap the DEK with the KEK (KMS or local) via `kekProvider().wrap(dek)`.
 *  4. Emit `{ ciphertext, dek, keyVersion }` — the ciphertext is
 *     `base64(iv||ct||tag)`, the dek is `base64(wrapped)`, keyVersion is a
 *     rotation tag ('kms:<arn>' or 'local-v1').
 *
 * Decryption reverses: unwrap the DEK, then AES-GCM-decrypt the payload.
 *
 * This module does NOT know about connectors; it operates on strings.
 * Higher-level helpers (see `connector-secrets.ts`) map to the DB shape.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { kekProvider } from './kek'

export interface EnvelopedSecret {
  /** base64( iv || aes-gcm-ciphertext || tag ) */
  ciphertext: string
  /** base64( KEK-wrapped DEK ) */
  dek: string
  /** Which KEK produced the wrap — used at decrypt time and by rotation queries. */
  keyVersion: string
}

const IV_BYTES  = 12
const TAG_BYTES = 16

export async function encryptString(plaintext: string): Promise<EnvelopedSecret> {
  const kek = kekProvider()
  const dek = randomBytes(32)
  const wrapped = await kek.wrap(dek)

  const iv     = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', dek, iv)
  const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()

  return {
    ciphertext: Buffer.concat([iv, ct, tag]).toString('base64'),
    dek:        wrapped.ciphertext.toString('base64'),
    keyVersion: wrapped.keyVersion,
  }
}

export async function decryptString(enc: EnvelopedSecret): Promise<string> {
  const kek     = kekProvider()
  const dek     = await kek.unwrap(Buffer.from(enc.dek, 'base64'), enc.keyVersion)
  const payload = Buffer.from(enc.ciphertext, 'base64')
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new Error('[envelope] payload too short')
  }
  const iv       = payload.subarray(0, IV_BYTES)
  const tag      = payload.subarray(payload.length - TAG_BYTES)
  const ct       = payload.subarray(IV_BYTES, payload.length - TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', dek, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
