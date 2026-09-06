/**
 * QuickBooks Online adapter.
 *
 * OAuth2 flow (Intuit):
 *   1. `buildAuthorizeUrl` returns the Intuit authorize URL. The
 *      caller redirects the browser there.
 *   2. The browser is redirected back to the app's callback with
 *      `code`, `state`, and `realmId` query parameters.
 *   3. `exchangeCode` swaps the code for an access + refresh token.
 *      `realmId` (Intuit's company id) becomes `providerAccountId`.
 *
 * Report fetching:
 *   Intuit exposes `/reports/ProfitAndLoss`, `/reports/BalanceSheet`,
 *   `/reports/TrialBalance`, `/reports/GeneralLedger`,
 *   `/reports/AgedReceivables`, `/reports/AgedPayables`. This adapter
 *   is written as a shape-preserving mapper — the actual HTTP call
 *   is delegated to `httpFetch` (injected for tests) so we can build
 *   the request URL without hitting Intuit in the test suite.
 */

import { env } from '@/lib/env'
import {
  type ConnectorAdapter,
  type OAuthAuthorizeInput, type OAuthAuthorizeResult,
  type OAuthCallbackInput, type OAuthTokenResult,
  type FetchReportInput, type FetchReportResult,
  type AccountingReportKind, type SourceRowPayload,
  UnsupportedReportError,
} from '../types'

const AUTH_URL      = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_URL     = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const API_ROOT_PROD = 'https://quickbooks.api.intuit.com/v3/company'
const API_ROOT_SBX  = 'https://sandbox-quickbooks.api.intuit.com/v3/company'

/** Report path per Intuit API. */
const REPORT_PATHS: Record<AccountingReportKind, string | null> = {
  P_AND_L:        'reports/ProfitAndLoss',
  BALANCE_SHEET:  'reports/BalanceSheet',
  TRIAL_BALANCE:  'reports/TrialBalance',
  GENERAL_LEDGER: 'reports/GeneralLedger',
  AR_AGING:       'reports/AgedReceivables',
  AP_AGING:       'reports/AgedPayables',
}

/** Requested Intuit OAuth scopes. */
const SCOPES = ['com.intuit.quickbooks.accounting', 'openid'].join(' ')

/** Injected fetch — swappable in tests. */
export type HttpFetch = (url: string, init: {
  method:  'GET' | 'POST'
  headers: Record<string, string>
  body?:   string
}) => Promise<{ status: number; text(): Promise<string>; json(): Promise<any> }>

export interface QuickbooksAdapterOptions {
  /** Whether to route API traffic through the sandbox. Default: !production. */
  useSandbox?: boolean
  httpFetch?:  HttpFetch
}

export function makeQuickbooksAdapter(opts: QuickbooksAdapterOptions = {}): ConnectorAdapter {
  const useSandbox = opts.useSandbox ?? (env.NODE_ENV !== 'production')
  const apiRoot    = useSandbox ? API_ROOT_SBX : API_ROOT_PROD
  const httpFetch: HttpFetch = opts.httpFetch ?? (async (url, init) => {
    const res = await fetch(url, init as any)
    return { status: res.status, text: () => res.text(), json: () => res.json() }
  })

  function requireClientCredentials(): { clientId: string; clientSecret: string } {
    const clientId     = process.env.QUICKBOOKS_CLIENT_ID
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      throw new Error(
        'QuickBooks connector requires QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.',
      )
    }
    return { clientId, clientSecret }
  }

  const adapter: ConnectorAdapter = {
    provider: 'QUICKBOOKS',

    buildAuthorizeUrl(input: OAuthAuthorizeInput): OAuthAuthorizeResult {
      const { clientId } = requireClientCredentials()
      const params = new URLSearchParams({
        client_id:     clientId,
        response_type: 'code',
        scope:         SCOPES,
        redirect_uri:  input.redirectUri,
        state:         input.state,
      })
      return { authorizeUrl: `${AUTH_URL}?${params.toString()}` }
    },

    async exchangeCode(input: OAuthCallbackInput): Promise<OAuthTokenResult> {
      const { clientId, clientSecret } = requireClientCredentials()
      const realmId = input.providerHints?.realmId
      if (!realmId) throw new Error('QuickBooks callback missing realmId')

      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      const body  = new URLSearchParams({
        grant_type:   'authorization_code',
        code:         input.code,
        redirect_uri: input.redirectUri,
      }).toString()

      const res = await httpFetch(TOKEN_URL, {
        method:  'POST',
        headers: {
          'Authorization': `Basic ${basic}`,
          'Content-Type':  'application/x-www-form-urlencoded',
          'Accept':        'application/json',
        },
        body,
      })
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`QuickBooks token exchange failed (status ${res.status})`)
      }
      const payload = await res.json() as {
        access_token: string; refresh_token?: string; expires_in?: number
      }
      const expiresAt = payload.expires_in
        ? new Date(Date.now() + payload.expires_in * 1000)
        : null
      return {
        accessToken:          payload.access_token,
        refreshToken:         payload.refresh_token ?? null,
        expiresAt,
        providerAccountId:    realmId,
        providerAccountLabel: null,   // resolved via CompanyInfo call in a follow-up
      }
    },

    async refresh(input) {
      const { clientId, clientSecret } = requireClientCredentials()
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      const body  = new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: input.refreshToken,
      }).toString()
      const res = await httpFetch(TOKEN_URL, {
        method:  'POST',
        headers: {
          'Authorization': `Basic ${basic}`,
          'Content-Type':  'application/x-www-form-urlencoded',
          'Accept':        'application/json',
        },
        body,
      })
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`QuickBooks refresh failed (status ${res.status})`)
      }
      const payload = await res.json() as {
        access_token: string; refresh_token?: string; expires_in?: number
      }
      return {
        accessToken:          payload.access_token,
        refreshToken:         payload.refresh_token ?? input.refreshToken,
        expiresAt:            payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null,
        providerAccountId:    '',    // caller supplies from stored row
        providerAccountLabel: null,
      }
    },

    async fetchReport(input: FetchReportInput): Promise<FetchReportResult> {
      const path = REPORT_PATHS[input.reportKind]
      if (!path) throw new UnsupportedReportError('QUICKBOOKS', input.reportKind)

      const params = new URLSearchParams()
      if (input.periodStart) params.set('start_date', input.periodStart)
      if (input.periodEnd)   params.set('end_date',   input.periodEnd)
      const url = `${apiRoot}/${input.providerAccountId}/${path}?${params.toString()}&minorversion=65`

      const res = await httpFetch(url, {
        method:  'GET',
        headers: {
          'Authorization': `Bearer ${input.accessToken}`,
          'Accept':        'application/json',
        },
      })
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`QuickBooks ${input.reportKind} fetch failed (status ${res.status})`)
      }
      const payload = await res.json()
      const rows = mapReportRows(input.reportKind, payload)
      return {
        reportKind:  input.reportKind,
        periodLabel: buildPeriodLabel(input.periodStart, input.periodEnd),
        rows,
        fetchedAt:   new Date(),
      }
    },
  }
  return adapter
}

/**
 * Convert an Intuit report response into the abstract `SourceRowPayload`
 * shape. Exported so tests can exercise the mapper without touching
 * OAuth / HTTP.
 */
export function mapReportRows(kind: AccountingReportKind, payload: unknown): SourceRowPayload[] {
  const rows: SourceRowPayload[] = []
  const root = (payload as { Rows?: { Row?: any[] } })?.Rows?.Row ?? []
  walk(root, rows, kind, undefined)
  return rows
}

function walk(nodes: any[], out: SourceRowPayload[], kind: AccountingReportKind, category?: string) {
  for (const n of nodes) {
    // Section header — QBO structures reports as sections with nested rows.
    const sectionHeader = n?.Header?.ColData?.[0]?.value
    if (n?.Rows?.Row && Array.isArray(n.Rows.Row)) {
      walk(n.Rows.Row, out, kind, sectionHeader ?? category)
      continue
    }
    // Data row — array of {value, id}
    const cols = n?.ColData
    if (!Array.isArray(cols) || cols.length < 2) continue
    const accountName = cols[0]?.value
    const accountCode = cols[0]?.id
    const amount      = cols[cols.length - 1]?.value
    if (!accountName || amount === undefined) continue
    out.push({
      accountName:  String(accountName),
      accountCode:  accountCode ? String(accountCode) : undefined,
      category:     category ?? undefined,
      period:       'CURRENT',    // caller reformats using periodLabel
      amount:       String(amount),
      currency:     'USD',
      externalRowId: accountCode ? `${kind}:${accountCode}` : undefined,
      rawPayload:   n,
    })
  }
}

function buildPeriodLabel(start?: string, end?: string): string {
  if (start && end) return `${start}_${end}`
  if (end)          return `to_${end}`
  return 'CURRENT'
}
