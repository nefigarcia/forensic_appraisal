import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  LocalKekProvider,
  KmsKekProvider,
  kekProvider,
  __resetKekProviderForTests,
} from '@/lib/crypto/kek'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  __resetKekProviderForTests()
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k]
  }
  Object.assign(process.env, ORIGINAL_ENV)
  vi.resetModules()
})

describe('LocalKekProvider', () => {
  it('wraps and unwraps a 32-byte payload', async () => {
    const key = Buffer.alloc(32, 7)
    const p = new LocalKekProvider(key)
    const dek = Buffer.from('a'.repeat(32))
    const wrapped = await p.wrap(dek)
    expect(wrapped.keyVersion).toBe('local-v1')
    const back = await p.unwrap(wrapped.ciphertext, wrapped.keyVersion)
    expect(back.equals(dek)).toBe(true)
  })

  it('refuses a key of the wrong length', () => {
    expect(() => new LocalKekProvider(Buffer.alloc(16))).toThrow(/32 bytes/)
  })

  it('refuses to unwrap a keyVersion it does not own', async () => {
    const p = new LocalKekProvider(Buffer.alloc(32))
    await expect(p.unwrap(Buffer.alloc(32), 'kms:something')).rejects.toThrow(/local/i)
  })
})

describe('KmsKekProvider', () => {
  // We do not want to actually reach AWS in tests. The class itself is
  // small; we validate its interface without invoking the network by
  // asserting the class shape.
  it('exposes wrap/unwrap and a keyVersion prefixed with kms:', async () => {
    const p = new KmsKekProvider('alias/valuvault', 'us-east-1')
    expect(typeof p.wrap).toBe('function')
    expect(typeof p.unwrap).toBe('function')
    // Refuses to unwrap a local blob:
    await expect(p.unwrap(Buffer.alloc(32), 'local-v1')).rejects.toThrow(/kms/i)
  })
})

describe('kekProvider() selection', () => {
  it('picks LocalKekProvider in dev when CONNECTOR_KEK_B64 is set', async () => {
    delete process.env.AWS_KMS_KEY_ID
    // Setup file already provides a valid CONNECTOR_KEK_B64.
    const p = kekProvider()
    expect(p).toBeInstanceOf(LocalKekProvider)
  })

  it('picks KmsKekProvider whenever AWS_KMS_KEY_ID is set', async () => {
    process.env.AWS_KMS_KEY_ID = 'alias/whatever'
    vi.resetModules()
    // Re-import env + kek so they see the new AWS_KMS_KEY_ID.
    const { __resetKekProviderForTests: reset, kekProvider: pick, KmsKekProvider: Kms } =
      await import('@/lib/crypto/kek')
    reset()
    const p = pick()
    expect(p).toBeInstanceOf(Kms)
  })

  it('fails closed in production if no AWS_KMS_KEY_ID is present', async () => {
    // vi.stubEnv works around @types/node's readonly NODE_ENV declaration.
    vi.stubEnv('AWS_KMS_KEY_ID', '')
    vi.stubEnv('CONNECTOR_KEK_B64', '')
    vi.stubEnv('NODE_ENV', 'production')
    vi.resetModules()
    const { __resetKekProviderForTests: reset, kekProvider: pick } =
      await import('@/lib/crypto/kek')
    reset()
    expect(() => pick()).toThrow(/required in production/i)
    vi.unstubAllEnvs()
  })
})
