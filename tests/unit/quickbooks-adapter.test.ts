/**
 * QuickBooks adapter — URL construction, callback exchange, and
 * report-row mapping.
 *
 * The tests inject a fake `httpFetch` so no network traffic occurs.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { makeQuickbooksAdapter, mapReportRows } from '@/lib/connectors/quickbooks/adapter'
import { UnsupportedReportError } from '@/lib/connectors/types'

beforeAll(() => {
  process.env.QUICKBOOKS_CLIENT_ID     = 'test-client'
  process.env.QUICKBOOKS_CLIENT_SECRET = 'test-secret'
})

describe('QuickBooks — buildAuthorizeUrl', () => {
  it('produces an Intuit authorize URL with the state parameter', () => {
    const a = makeQuickbooksAdapter()
    const { authorizeUrl } = a.buildAuthorizeUrl({
      organizationId: 'org-1',
      caseId:         'case-1',
      state:          'STATE-abc',
      redirectUri:    'https://app.example/api/connect/quickbooks/callback',
    })
    expect(authorizeUrl).toContain('https://appcenter.intuit.com/connect/oauth2')
    expect(authorizeUrl).toContain('client_id=test-client')
    expect(authorizeUrl).toContain('state=STATE-abc')
    expect(authorizeUrl).toContain('scope=com.intuit.quickbooks.accounting+openid')
    // Redirect URI is URL-encoded.
    expect(decodeURIComponent(authorizeUrl))
      .toContain('https://app.example/api/connect/quickbooks/callback')
  })

  it('requires QUICKBOOKS_CLIENT_ID / SECRET', () => {
    const prev = process.env.QUICKBOOKS_CLIENT_ID
    delete process.env.QUICKBOOKS_CLIENT_ID
    const a = makeQuickbooksAdapter()
    expect(() => a.buildAuthorizeUrl({
      organizationId: 'org-1', caseId: 'case-1', state: 's',
      redirectUri: 'https://x/cb',
    })).toThrow(/QUICKBOOKS_CLIENT_ID/)
    process.env.QUICKBOOKS_CLIENT_ID = prev
  })
})

describe('QuickBooks — exchangeCode', () => {
  it('calls the Intuit token endpoint with the Basic auth header', async () => {
    let capturedUrl = ''
    let capturedInit: any = null
    const a = makeQuickbooksAdapter({
      httpFetch: async (url, init) => {
        capturedUrl  = url
        capturedInit = init
        return {
          status: 200,
          text: async () => '',
          json: async () => ({
            access_token: 'AT', refresh_token: 'RT', expires_in: 3600,
          }),
        }
      },
    })
    const tokens = await a.exchangeCode({
      code:        'CODE',
      state:       's',
      redirectUri: 'https://app.example/cb',
      providerHints: { realmId: 'REALM-123' },
    })
    expect(capturedUrl).toBe('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer')
    expect(capturedInit.headers['Authorization']).toMatch(/^Basic /)
    expect(capturedInit.body).toContain('grant_type=authorization_code')
    expect(capturedInit.body).toContain('code=CODE')
    expect(tokens.accessToken).toBe('AT')
    expect(tokens.refreshToken).toBe('RT')
    expect(tokens.providerAccountId).toBe('REALM-123')
    expect(tokens.expiresAt).toBeInstanceOf(Date)
  })

  it('throws when realmId is missing (Intuit callback contract)', async () => {
    const a = makeQuickbooksAdapter({
      httpFetch: async () => ({ status: 200, text: async () => '', json: async () => ({}) }),
    })
    await expect(a.exchangeCode({
      code: 'x', state: 's', redirectUri: 'https://app.example/cb',
    })).rejects.toThrow(/realmId/)
  })

  it('surfaces a non-2xx from the token endpoint', async () => {
    const a = makeQuickbooksAdapter({
      httpFetch: async () => ({ status: 400, text: async () => 'bad', json: async () => ({}) }),
    })
    await expect(a.exchangeCode({
      code: 'x', state: 's', redirectUri: 'https://app.example/cb',
      providerHints: { realmId: 'R' },
    })).rejects.toThrow(/status 400/)
  })
})

describe('QuickBooks — fetchReport', () => {
  it('rejects unsupported report kinds via UnsupportedReportError', async () => {
    const a = makeQuickbooksAdapter({
      httpFetch: async () => ({ status: 200, text: async () => '', json: async () => ({}) }),
    })
    await expect(a.fetchReport({
      accessToken: 't', providerAccountId: 'r',
      reportKind: 'CUSTOM' as any,
    })).rejects.toBeInstanceOf(UnsupportedReportError)
  })

  it('routes P_AND_L to the ProfitAndLoss endpoint with a Bearer token', async () => {
    let capturedUrl = ''
    const a = makeQuickbooksAdapter({
      useSandbox: true,
      httpFetch: async (url, init) => {
        capturedUrl = url
        expect(init.headers['Authorization']).toBe('Bearer AT')
        return {
          status: 200, text: async () => '',
          json: async () => ({ Rows: { Row: [] } }),
        }
      },
    })
    await a.fetchReport({
      accessToken: 'AT', providerAccountId: 'REALM',
      reportKind: 'P_AND_L',
      periodStart: '2024-01-01', periodEnd: '2024-12-31',
    })
    expect(capturedUrl).toContain('/REALM/reports/ProfitAndLoss?')
    expect(capturedUrl).toContain('start_date=2024-01-01')
    expect(capturedUrl).toContain('end_date=2024-12-31')
    expect(capturedUrl).toContain('minorversion=65')
    // Sandbox routing.
    expect(capturedUrl.startsWith('https://sandbox-quickbooks.api.intuit.com')).toBe(true)
  })
})

describe('mapReportRows', () => {
  it('flattens nested sections and preserves category from the section header', () => {
    const payload = {
      Rows: { Row: [{
        Header: { ColData: [{ value: 'Income' }] },
        Rows: { Row: [
          { ColData: [{ value: 'Sales', id: '4000' }, { value: '10000' }] },
          { ColData: [{ value: 'Services', id: '4100' }, { value: '2500' }] },
        ] },
      }, {
        Header: { ColData: [{ value: 'Expenses' }] },
        Rows: { Row: [
          { ColData: [{ value: 'Rent', id: '6000' }, { value: '3000' }] },
        ] },
      }] },
    }
    const rows = mapReportRows('P_AND_L', payload)
    expect(rows.length).toBe(3)
    expect(rows[0]).toMatchObject({
      accountName: 'Sales', accountCode: '4000', amount: '10000',
      category: 'Income', currency: 'USD',
    })
    expect(rows[2]).toMatchObject({
      accountName: 'Rent', category: 'Expenses', amount: '3000',
    })
    // externalRowId prefixes with the report kind so identical account
    // codes across P&L / BS do not collide.
    expect(rows[0]!.externalRowId).toBe('P_AND_L:4000')
  })

  it('ignores rows without an amount', () => {
    const payload = {
      Rows: { Row: [
        { ColData: [{ value: 'Header row only' }] },  // no amount
        { ColData: [{ value: 'Sales', id: '4000' }, { value: '100' }] },
      ] },
    }
    const rows = mapReportRows('P_AND_L', payload)
    expect(rows.length).toBe(1)
  })
})
