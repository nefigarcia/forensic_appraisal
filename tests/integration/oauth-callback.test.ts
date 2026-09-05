import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── module mocks ───────────────────────────────────────────────────
// env is parsed once at module load — we mock it so the callback route
// sees the values we need without depending on process.env timing.
vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long',
    DATABASE_URL: 'mysql://test/test',
    NEXT_PUBLIC_APP_URL: 'http://localhost:9002',
    AWS_REGION: 'us-east-1',
    CONNECTOR_KEK_B64: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
    MICROSOFT_CLIENT_ID:     'client-id',
    MICROSOFT_CLIENT_SECRET: 'client-secret',
    MICROSOFT_REDIRECT_URI:  'https://app.example.com/api/connect/microsoft/callback',
  },
  requireEnv: (n: string) => (process.env as any)[n] ?? '',
}))

vi.mock('@/app/actions/connectors', () => ({
  saveOAuthToken: vi.fn().mockResolvedValue(undefined),
}))

let cookieStore: Record<string, string> = {}
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get:    (n: string) => (cookieStore[n] ? { value: cookieStore[n] } : undefined),
    set:    (attrs: any) => { cookieStore[attrs.name] = attrs.value },
    delete: (n: string) => { delete cookieStore[n] },
  }),
}))

import { GET as callbackGet } from '@/app/api/connect/microsoft/callback/route'
import { OAUTH_STATE_COOKIE } from '@/lib/oauth-state'
import { NextRequest } from 'next/server'
import { saveOAuthToken } from '@/app/actions/connectors'

function req(query: Record<string, string>): NextRequest {
  const url = new URL('https://app.example.com/api/connect/microsoft/callback')
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

beforeEach(() => {
  cookieStore = {}
  vi.clearAllMocks()
})

describe('Microsoft OAuth callback — CSRF state binding', () => {
  it('rejects when the state cookie is missing', async () => {
    const res = await callbackGet(req({ code: 'abc', state: 'presented' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=state_mismatch')
    expect(saveOAuthToken).not.toHaveBeenCalled()
  })

  it('rejects when the presented state does not match the cookie', async () => {
    cookieStore[OAUTH_STATE_COOKIE] = 'cookie-value-here-XYZ'
    const res = await callbackGet(req({ code: 'abc', state: 'different-value-here!' }))
    expect(res.headers.get('location')).toContain('error=state_mismatch')
    expect(saveOAuthToken).not.toHaveBeenCalled()
  })

  it('rejects when Microsoft reports an error (upstream provider error)', async () => {
    cookieStore[OAUTH_STATE_COOKIE] = 'anything'
    const res = await callbackGet(req({ error: 'access_denied' }))
    expect(res.headers.get('location')).toContain('error=access_denied')
    expect(saveOAuthToken).not.toHaveBeenCalled()
  })

  it('rejects when the code parameter is missing', async () => {
    cookieStore[OAUTH_STATE_COOKIE] = 'anything'
    const res = await callbackGet(req({}))
    expect(res.headers.get('location')).toContain('error=no_code')
    expect(saveOAuthToken).not.toHaveBeenCalled()
  })

  it('clears the state cookie on every callback outcome', async () => {
    cookieStore[OAUTH_STATE_COOKIE] = 'anything'
    const res = await callbackGet(req({ code: 'abc', state: 'no-match-value' }))
    // The response instructs the browser to clear the cookie.
    const setCookieHeader = res.headers.get('set-cookie') ?? ''
    expect(setCookieHeader).toContain(OAUTH_STATE_COOKIE)
    // Cookie is set with a past expiry.
    expect(setCookieHeader.toLowerCase()).toMatch(/expires=/)
  })

  it('proceeds to token exchange when state matches and env is present', async () => {
    cookieStore[OAUTH_STATE_COOKIE] = 'matching-state-abc'
    // Mock the token exchange fetch.
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }),
    }) as any

    const res = await callbackGet(req({ code: 'valid-code', state: 'matching-state-abc' }))
    expect(res.headers.get('location')).toContain('success=true')
    expect(saveOAuthToken).toHaveBeenCalledWith('microsoft', expect.objectContaining({
      access_token: 'a',
    }))
  })
})
