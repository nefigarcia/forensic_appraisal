import { describe, it, expect } from 'vitest'
import { generateToken, hashToken, timingSafeHashEqual } from '@/lib/auth/tokens'

describe('one-time tokens', () => {
  it('generateToken returns a raw string and its sha256 hex hash', () => {
    const { token, tokenHash } = generateToken()
    expect(token.length).toBeGreaterThan(30)
    expect(/^[a-f0-9]{64}$/.test(tokenHash)).toBe(true)
    // Determinism: hashing the raw token again yields the stored hash.
    expect(hashToken(token)).toBe(tokenHash)
  })

  it('two generated tokens are extremely unlikely to collide', () => {
    const a = generateToken().token
    const b = generateToken().token
    expect(a).not.toBe(b)
  })

  it('timingSafeHashEqual compares equal hashes', () => {
    const { tokenHash } = generateToken()
    expect(timingSafeHashEqual(tokenHash, tokenHash)).toBe(true)
  })

  it('timingSafeHashEqual rejects unequal hashes', () => {
    const a = generateToken().tokenHash
    const b = generateToken().tokenHash
    expect(timingSafeHashEqual(a, b)).toBe(false)
  })

  it('timingSafeHashEqual returns false on length mismatch (no throw)', () => {
    expect(timingSafeHashEqual('abcd', 'ab')).toBe(false)
  })
})
