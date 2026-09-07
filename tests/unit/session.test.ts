import { describe, it, expect } from 'vitest'
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  sessionCookieAttrs,
  clearedSessionCookieAttrs,
} from '@/lib/session'

describe('session cookie policy', () => {
  it('exposes stable constants', () => {
    expect(SESSION_COOKIE_NAME).toBe('session')
    expect(SESSION_TTL_SECONDS).toBe(2 * 60 * 60)
  })

  it('sessionCookieAttrs sets httpOnly, sameSite=lax, path=/, and passed expiry', () => {
    const exp = new Date(Date.now() + 60_000)
    const attrs = sessionCookieAttrs('tok', exp)
    expect(attrs.name).toBe('session')
    expect(attrs.value).toBe('tok')
    expect(attrs.httpOnly).toBe(true)
    expect(attrs.sameSite).toBe('lax')
    expect(attrs.path).toBe('/')
    expect(attrs.expires).toBe(exp)
    // In dev/test we do not require secure; production is enforced by env
    expect(typeof attrs.secure).toBe('boolean')
  })

  it('clearedSessionCookieAttrs sets an epoch expiry with matching flags', () => {
    const attrs = clearedSessionCookieAttrs()
    expect(attrs.name).toBe('session')
    expect(attrs.value).toBe('')
    expect(attrs.httpOnly).toBe(true)
    expect(attrs.sameSite).toBe('lax')
    expect(attrs.path).toBe('/')
    expect(attrs.expires.getTime()).toBe(0)
  })
})
