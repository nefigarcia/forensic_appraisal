import { describe, it, expect } from 'vitest'
import {
  generateOAuthState,
  oauthStateCookieAttrs,
  clearedOauthStateCookieAttrs,
  verifyOAuthState,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
} from '@/lib/oauth-state'

describe('generateOAuthState', () => {
  it('emits a 32-byte URL-safe base64 string', () => {
    const s = generateOAuthState()
    expect(s.length).toBeGreaterThan(30)
    expect(/^[A-Za-z0-9_-]+$/.test(s)).toBe(true) // base64url alphabet
  })

  it('is non-deterministic — two calls differ', () => {
    expect(generateOAuthState()).not.toBe(generateOAuthState())
  })
})

describe('cookie attrs', () => {
  it('names the cookie oauth_state with httpOnly, sameSite=lax, path=/', () => {
    const attrs = oauthStateCookieAttrs('abcd')
    expect(attrs.name).toBe('oauth_state')
    expect(attrs.name).toBe(OAUTH_STATE_COOKIE)
    expect(attrs.httpOnly).toBe(true)
    expect(attrs.sameSite).toBe('lax')
    expect(attrs.path).toBe('/')
    expect(attrs.maxAge).toBe(OAUTH_STATE_TTL_SECONDS)
    expect(attrs.value).toBe('abcd')
  })

  it('cleared attrs sets epoch expiry with matching flags', () => {
    const c = clearedOauthStateCookieAttrs()
    expect(c.name).toBe(OAUTH_STATE_COOKIE)
    expect(c.value).toBe('')
    expect(c.httpOnly).toBe(true)
    expect(c.sameSite).toBe('lax')
    expect(c.expires.getTime()).toBe(0)
  })
})

describe('verifyOAuthState', () => {
  it('accepts a matching pair', () => {
    const s = generateOAuthState()
    expect(verifyOAuthState(s, s)).toBe(true)
  })

  it('rejects a mismatched pair of the same length', () => {
    const a = generateOAuthState()
    const b = generateOAuthState()
    expect(a.length).toBe(b.length)
    expect(verifyOAuthState(a, b)).toBe(false)
  })

  it('rejects a length mismatch without throwing', () => {
    expect(verifyOAuthState('short', 'longer-value-here')).toBe(false)
  })

  it.each([
    [null,     'abc'],
    ['abc',    null],
    [undefined, 'abc'],
    ['',       ''],
    [null,     null],
  ])('rejects missing input (%s, %s)', (a, b) => {
    expect(verifyOAuthState(a as any, b as any)).toBe(false)
  })
})
