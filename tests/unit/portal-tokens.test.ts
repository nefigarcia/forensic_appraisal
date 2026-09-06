import { describe, it, expect } from 'vitest'
import {
  generatePortalToken,
  hashPortalToken,
  timingSafeHashEqual,
  looksLikePortalToken,
  PORTAL_TOKEN_DEFAULT_TTL_MS,
} from '@/lib/portal/tokens'

describe('portal tokens', () => {
  it('generates a URL-safe token and a hex hash of that token', () => {
    const { token, tokenHash } = generatePortalToken()
    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
    // The hash matches what hashPortalToken produces standalone.
    expect(hashPortalToken(token)).toBe(tokenHash)
  })

  it('produces different tokens each call (256-bit entropy)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const { token } = generatePortalToken()
      seen.add(token)
    }
    expect(seen.size).toBe(100)
  })

  it('hashPortalToken is deterministic', () => {
    const t = 'a-fixed-string-for-hashing'
    expect(hashPortalToken(t)).toBe(hashPortalToken(t))
  })

  it('timingSafeHashEqual compares only equal-length hex hashes', () => {
    const a = hashPortalToken('one')
    const b = hashPortalToken('one')
    const c = hashPortalToken('two')
    expect(timingSafeHashEqual(a, b)).toBe(true)
    expect(timingSafeHashEqual(a, c)).toBe(false)
    // Different lengths return false without throwing.
    expect(timingSafeHashEqual(a, a.slice(0, 10))).toBe(false)
    expect(timingSafeHashEqual('', '')).toBe(false)   // empty rejected (still guard)
    // Wrong types return false, not throw.
    // @ts-expect-error — testing runtime guard.
    expect(timingSafeHashEqual(null, a)).toBe(false)
  })

  it('looksLikePortalToken rejects obviously invalid strings before hashing', () => {
    expect(looksLikePortalToken(undefined)).toBe(false)
    expect(looksLikePortalToken(null)).toBe(false)
    expect(looksLikePortalToken('')).toBe(false)
    expect(looksLikePortalToken('short')).toBe(false)
    expect(looksLikePortalToken('a'.repeat(300))).toBe(false)
    expect(looksLikePortalToken('has space!!!!  bad'.repeat(3))).toBe(false)
    expect(looksLikePortalToken(generatePortalToken().token)).toBe(true)
  })

  it('default TTL is 30 days', () => {
    expect(PORTAL_TOKEN_DEFAULT_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })
})
