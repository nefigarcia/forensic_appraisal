import { describe, it, expect } from 'vitest'
import {
  scrubbedCanonicalize,
  hashScrubbed,
  categorizeError,
  sanitizeErrorMessage,
} from '@/lib/ai/execution'

// ─────────────────────────────────────────────────
// Scrubbing — never persist secrets, never duplicate doc bytes
// ─────────────────────────────────────────────────

describe('scrubbedCanonicalize — Rules 2 and 3', () => {
  it('drops known secret keys from objects (accessToken, refreshToken, etc.)', () => {
    const s = scrubbedCanonicalize({
      accessToken:  'sk_live_supersecret',
      refreshToken: 'rt_supersecret',
      password:     'not-a-secret-but-treated-as-one',
      apiKey:       'key-1234',
      authorization: 'Bearer supersecret',
      note: 'ok',
    })
    for (const banned of ['sk_live', 'rt_super', 'supersecret', 'key-1234', 'Bearer']) {
      expect(s).not.toContain(banned)
    }
    expect(s).toContain('note')
  })

  it('replaces data URIs with a length tag (Rule 3 — no duplicate bytes)', () => {
    const uri = 'data:application/pdf;base64,' + 'A'.repeat(10_000)
    const s   = scrubbedCanonicalize({ documentDataUri: uri, other: 'x' })
    expect(s).not.toContain('AAAA')
    expect(s).toMatch(/\[data-uri:\d+\]/)
  })

  it('two different data URIs produce different hashes even after scrubbing', () => {
    // The length differs → the length tag differs → the hash differs.
    const a = hashScrubbed({ documentDataUri: 'data:x;base64,' + 'A'.repeat(100) })
    const b = hashScrubbed({ documentDataUri: 'data:x;base64,' + 'A'.repeat(200) })
    expect(a).not.toBe(b)
  })

  it('is deterministic — key ordering does not affect the hash', () => {
    const a = hashScrubbed({ z: 1, a: 2, b: [3, 4] })
    const b = hashScrubbed({ a: 2, b: [3, 4], z: 1 })
    expect(a).toBe(b)
  })

  it('handles nested arrays and objects', () => {
    const s = scrubbedCanonicalize({ a: [{ z: 1, x: 0 }, { b: 2, a: 1 }], k: 'v' })
    expect(s).toBe('{"a":[{"x":0,"z":1},{"a":1,"b":2}],"k":"v"}')
  })

  it('normalizes Dates to ISO strings and non-finite Numbers to null', () => {
    const s = scrubbedCanonicalize({ at: new Date('2026-09-05T00:00:00.000Z'), n: NaN })
    expect(s).toBe('{"at":"2026-09-05T00:00:00.000Z","n":null}')
  })
})

// ─────────────────────────────────────────────────
// Error categorization
// ─────────────────────────────────────────────────

describe('categorizeError', () => {
  it.each([
    [{ name: 'ZodError', message: 'Invalid schema' }, 'SCHEMA_VALIDATION'],
    [{ message: 'Request timed out after 30s' },       'MODEL_TIMEOUT'],
    [{ message: 'timeout' },                           'MODEL_TIMEOUT'],
    [{ status: 429, message: 'quota exceeded' },       'RATE_LIMIT'],
    [{ status: 429, message: 'rate limit' },           'RATE_LIMIT'],
    [{ message: 'The model refused: safety filter' },  'REFUSED'],
    [{ message: 'blocked by policy' },                 'REFUSED'],
    [{ code: 'ECONNRESET' },                           'INFRA'],
    [{ code: 'ENOTFOUND' },                            'INFRA'],
    [{ status: 500, message: 'oops' },                 'INFRA'],
    [{ message: 'something random' },                  'UNKNOWN'],
    [null,                                             'UNKNOWN'],
  ])('classifies %o as %s', (err, expected) => {
    expect(categorizeError(err)).toBe(expected)
  })
})

// ─────────────────────────────────────────────────
// Error-message sanitization
// ─────────────────────────────────────────────────

describe('sanitizeErrorMessage', () => {
  it('redacts stripe-style secret keys', () => {
    const out = sanitizeErrorMessage(new Error('billing failed with sk_live_abcdefghijklmnopqr'))
    expect(out).toContain('[stripe-key]')
    expect(out).not.toContain('sk_live_abcdefghijklmnopqr')
  })

  it('redacts Bearer tokens', () => {
    const out = sanitizeErrorMessage(new Error('403 forbidden: Bearer abc123.def456'))
    expect(out).toContain('Bearer [redacted]')
    expect(out).not.toContain('abc123.def456')
  })

  it('redacts JWT-shaped strings', () => {
    const out = sanitizeErrorMessage(new Error('bad session: eyJhbGciOiJIUzI1NiJ9.foo.bar'))
    expect(out).toContain('[jwt]')
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9')
  })

  it('caps output at 500 chars and collapses whitespace', () => {
    const out = sanitizeErrorMessage(new Error('x\n\n\ty'.repeat(200)))
    expect(out.length).toBeLessThanOrEqual(500)
    expect(out).not.toContain('\n')
    expect(out).not.toContain('\t')
  })

  it('handles non-Error input', () => {
    expect(sanitizeErrorMessage(null)).toBe('null')
    expect(sanitizeErrorMessage('plain string')).toBe('plain string')
  })
})
