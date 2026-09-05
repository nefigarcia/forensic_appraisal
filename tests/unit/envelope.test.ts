import { describe, it, expect, beforeEach } from 'vitest'
import { encryptString, decryptString } from '@/lib/crypto/envelope'
import { __resetKekProviderForTests } from '@/lib/crypto/kek'

beforeEach(() => { __resetKekProviderForTests() })

describe('envelope encryption (local KEK)', () => {
  it('round-trips a plaintext string', async () => {
    const enc = await encryptString('hello world')
    expect(enc.ciphertext).toBeTypeOf('string')
    expect(enc.dek).toBeTypeOf('string')
    expect(enc.keyVersion).toBe('local-v1')

    const back = await decryptString(enc)
    expect(back).toBe('hello world')
  })

  it('never emits the plaintext substring in either blob', async () => {
    const secret = 'super-secret-oauth-token-abc123'
    const enc = await encryptString(secret)
    expect(enc.ciphertext).not.toContain(secret)
    expect(enc.dek).not.toContain(secret)
  })

  it('produces different ciphertext on repeat calls (non-deterministic)', async () => {
    // Different DEK + different IV each call => different ciphertext even
    // for identical plaintext.
    const a = await encryptString('same')
    const b = await encryptString('same')
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.dek).not.toBe(b.dek)
  })

  it('throws on a tampered ciphertext (AES-GCM auth-tag catches it)', async () => {
    const enc = await encryptString('important')
    // Flip a byte in the middle of the ciphertext
    const bytes = Buffer.from(enc.ciphertext, 'base64')
    bytes[20] = bytes[20]! ^ 0xff
    const tampered = { ...enc, ciphertext: bytes.toString('base64') }
    await expect(decryptString(tampered)).rejects.toThrow()
  })

  it('throws on a tampered wrapped DEK', async () => {
    const enc = await encryptString('important')
    const bytes = Buffer.from(enc.dek, 'base64')
    bytes[5] = bytes[5]! ^ 0xff
    const tampered = { ...enc, dek: bytes.toString('base64') }
    await expect(decryptString(tampered)).rejects.toThrow()
  })

  it('rejects a wrong keyVersion (KEK provider mismatch)', async () => {
    const enc = await encryptString('important')
    await expect(decryptString({ ...enc, keyVersion: 'kms:some-arn' })).rejects.toThrow()
  })

  it('round-trips a wide range of plaintext lengths', async () => {
    for (const len of [0, 1, 15, 16, 17, 63, 64, 65, 1024]) {
      const plaintext = 'x'.repeat(len)
      const back = await decryptString(await encryptString(plaintext))
      expect(back).toBe(plaintext)
    }
  })
})
