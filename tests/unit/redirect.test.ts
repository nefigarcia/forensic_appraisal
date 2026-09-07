import { describe, it, expect } from 'vitest'
import { isSafeRedirectPath, safeRedirectPath } from '@/lib/auth/redirect'

describe('safeRedirectPath — open-redirect guard', () => {
  it.each([
    '/dashboard',
    '/projects/123',
    '/projects/abc?tab=review',
    '/settings/billing?success=1',
  ])('accepts same-origin path %s', (p) => {
    expect(isSafeRedirectPath(p)).toBe(true)
    expect(safeRedirectPath(p, '/dashboard')).toBe(p)
  })

  it.each([
    'https://evil.com/steal',
    'http://evil.com',
    '//evil.com/steal',           // protocol-relative
    '/\\evil.com',                // \\-prefix, some browsers hijack this
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'evil.com/steal',             // no leading slash
    '',
  ])('rejects unsafe target %s and returns the fallback', (bad) => {
    expect(isSafeRedirectPath(bad)).toBe(false)
    expect(safeRedirectPath(bad, '/dashboard')).toBe('/dashboard')
  })

  it('rejects non-string inputs', () => {
    expect(isSafeRedirectPath(undefined)).toBe(false)
    expect(isSafeRedirectPath(null)).toBe(false)
    expect(isSafeRedirectPath(42)).toBe(false)
  })

  it('refuses an unsafe fallback (config bug)', () => {
    expect(() => safeRedirectPath('/dashboard', 'https://evil.com')).toThrow(/fallback/)
  })

  it('rejects CR/LF injection in path', () => {
    expect(isSafeRedirectPath('/dashboard\r\nSet-Cookie: x=y')).toBe(false)
  })
})
