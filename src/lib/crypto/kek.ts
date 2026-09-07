/**
 * Key-Encrypting-Key (KEK) providers.
 *
 * A KEK does not encrypt payload directly. It wraps per-payload Data
 * Encryption Keys (DEKs) produced elsewhere. This module exposes a small
 * interface with two implementations:
 *
 *   1. `KmsKekProvider` — production. Uses AWS KMS `Encrypt`/`Decrypt`.
 *   2. `LocalKekProvider` — dev/test. Uses AES-256-GCM with a 32-byte key
 *      supplied via `CONNECTOR_KEK_B64`.
 *
 * Selection is automatic:
 *   - `AWS_KMS_KEY_ID` set  → KMS
 *   - production and no KMS → hard fail at boot
 *   - dev/test              → local (or a random ephemeral key with a loud
 *                             warning if `CONNECTOR_KEK_B64` is also unset)
 *
 * The provider factory is memoized, so KMS clients aren't recreated.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { env } from '@/lib/env'

export interface WrappedDek {
  ciphertext: Buffer
  keyVersion: string
}

export interface KekProvider {
  /** Wrap the given DEK plaintext with the KEK. Returns opaque ciphertext + a version tag. */
  wrap(dekPlaintext: Buffer): Promise<WrappedDek>
  /** Recover the original DEK plaintext. `keyVersion` selects the concrete algorithm. */
  unwrap(ciphertext: Buffer, keyVersion: string): Promise<Buffer>
}

// ─────────────────────────────────────────────────
// Local KEK (dev/test)
// ─────────────────────────────────────────────────

export class LocalKekProvider implements KekProvider {
  static VERSION = 'local-v1'
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error(`[LocalKekProvider] key must be 32 bytes, got ${key.length}`)
    }
  }
  async wrap(dek: Buffer): Promise<WrappedDek> {
    const iv     = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ct     = Buffer.concat([cipher.update(dek), cipher.final()])
    const tag    = cipher.getAuthTag()
    // Concatenate iv||ct||tag so callers only track one blob.
    return { ciphertext: Buffer.concat([iv, ct, tag]), keyVersion: LocalKekProvider.VERSION }
  }
  async unwrap(ciphertext: Buffer, keyVersion: string): Promise<Buffer> {
    if (!keyVersion.startsWith('local-')) {
      throw new Error(`[LocalKekProvider] cannot unwrap keyVersion '${keyVersion}'`)
    }
    const iv       = ciphertext.subarray(0, 12)
    const tag      = ciphertext.subarray(ciphertext.length - 16)
    const ct       = ciphertext.subarray(12, ciphertext.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()])
  }
}

// ─────────────────────────────────────────────────
// KMS KEK (production)
// ─────────────────────────────────────────────────

export class KmsKekProvider implements KekProvider {
  constructor(private readonly keyId: string, private readonly region: string) {}

  private async client() {
    // Lazy-load the SDK so `next dev` / tests don't pay the import cost
    // unless we actually reach production code.
    const { KMSClient } = await import('@aws-sdk/client-kms')
    return new KMSClient({ region: this.region })
  }

  async wrap(dek: Buffer): Promise<WrappedDek> {
    const { EncryptCommand } = await import('@aws-sdk/client-kms')
    const c = await this.client()
    const res = await c.send(new EncryptCommand({ KeyId: this.keyId, Plaintext: dek }))
    if (!res.CiphertextBlob) throw new Error('[KmsKekProvider] KMS returned no ciphertext')
    return {
      ciphertext: Buffer.from(res.CiphertextBlob),
      // Encode the key id so a later `unwrap` can tell which key produced the
      // wrap. KMS's `Decrypt` doesn't need us to specify the key (the blob
      // identifies it), but we still record it for rotation queries.
      keyVersion: `kms:${this.keyId}`,
    }
  }

  async unwrap(ciphertext: Buffer, keyVersion: string): Promise<Buffer> {
    if (!keyVersion.startsWith('kms:')) {
      throw new Error(`[KmsKekProvider] cannot unwrap keyVersion '${keyVersion}'`)
    }
    const { DecryptCommand } = await import('@aws-sdk/client-kms')
    const c = await this.client()
    const res = await c.send(new DecryptCommand({ CiphertextBlob: ciphertext }))
    if (!res.Plaintext) throw new Error('[KmsKekProvider] KMS returned no plaintext')
    return Buffer.from(res.Plaintext)
  }
}

// ─────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────

let cached: KekProvider | null = null

/**
 * Test hook — clears the memoized provider so a subsequent call picks up
 * changed env vars. Not exported from the barrel; production code should
 * not call it.
 */
export function __resetKekProviderForTests(): void { cached = null }

export function kekProvider(): KekProvider {
  if (cached) return cached

  if (env.AWS_KMS_KEY_ID) {
    cached = new KmsKekProvider(env.AWS_KMS_KEY_ID, env.AWS_REGION)
    return cached
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      '[kek] AWS_KMS_KEY_ID is required in production. ' +
      'Refuse to boot rather than encrypt connector secrets with a local KEK.'
    )
  }

  // Dev / test — local KEK
  if (env.CONNECTOR_KEK_B64) {
    const key = Buffer.from(env.CONNECTOR_KEK_B64, 'base64')
    if (key.length !== 32) {
      throw new Error('[kek] CONNECTOR_KEK_B64 must decode to exactly 32 bytes')
    }
    cached = new LocalKekProvider(key)
    return cached
  }

  // No KEK material configured at all — generate one in memory. Anything
  // encrypted with this key is unreadable after restart. Loud warning so
  // it doesn't sneak into a config that any operator relies on.
  console.warn(
    '[kek] WARNING: no AWS_KMS_KEY_ID and no CONNECTOR_KEK_B64 set. ' +
    'Using an ephemeral in-memory KEK — connector secrets will be ' +
    'unreadable after process restart. This is safe for local dev only.'
  )
  cached = new LocalKekProvider(randomBytes(32))
  return cached
}
