import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * env.ts parses process.env at module load. To test failure modes we
 * mutate env vars and use vi.resetModules() so each expectation
 * exercises a fresh parse.
 */

const ORIGINAL = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL)) delete process.env[k]
  }
  Object.assign(process.env, ORIGINAL)
})

describe('env parsing', () => {
  it('happy path — valid values load without throwing', async () => {
    const { env } = await import('@/lib/env')
    expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(16)
    expect(env.DATABASE_URL).toBeTruthy()
  })

  it('rejects a too-short JWT_SECRET at boot', async () => {
    process.env.JWT_SECRET = 'too-short'
    await expect(import('@/lib/env')).rejects.toThrow(/JWT_SECRET/)
  })

  it('rejects a missing DATABASE_URL at boot', async () => {
    delete process.env.DATABASE_URL
    await expect(import('@/lib/env')).rejects.toThrow(/DATABASE_URL/)
  })

  it('rejects a missing JWT_SECRET at boot', async () => {
    delete process.env.JWT_SECRET
    await expect(import('@/lib/env')).rejects.toThrow(/JWT_SECRET/)
  })

  it('requireEnv throws when the requested optional var is unset', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    const { requireEnv } = await import('@/lib/env')
    expect(() => requireEnv('STRIPE_WEBHOOK_SECRET')).toThrow(/required/)
  })
})
