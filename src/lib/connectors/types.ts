/**
 * Accounting-connector abstraction.
 *
 * Every provider (QuickBooks Online, Xero, Sage, NetSuite) implements
 * this interface. Server actions talk to the abstract adapter — never
 * to the provider directly — so a Slice-15 QBO integration and a
 * future Xero integration share the same wiring for OAuth,
 * report-fetching, and row mapping.
 *
 * The adapter never touches the DB. Server actions do the persistence
 * using the adapter's `SourceRowPayload[]` output.
 */

export const ACCOUNTING_PROVIDERS = [
  'QUICKBOOKS',
  'XERO',
  'SAGE',
  'NETSUITE',
] as const

export type AccountingProvider = typeof ACCOUNTING_PROVIDERS[number]

export function isAccountingProvider(p: unknown): p is AccountingProvider {
  return typeof p === 'string' && (ACCOUNTING_PROVIDERS as readonly string[]).includes(p)
}

export const ACCOUNTING_REPORT_KINDS = [
  'P_AND_L',
  'BALANCE_SHEET',
  'TRIAL_BALANCE',
  'GENERAL_LEDGER',
  'AR_AGING',
  'AP_AGING',
] as const

export type AccountingReportKind = typeof ACCOUNTING_REPORT_KINDS[number]

export function isAccountingReportKind(r: unknown): r is AccountingReportKind {
  return typeof r === 'string' && (ACCOUNTING_REPORT_KINDS as readonly string[]).includes(r)
}

// ─────────────────────────────────────────────────
// OAuth
// ─────────────────────────────────────────────────

export interface OAuthAuthorizeInput {
  organizationId: string
  caseId:         string
  state:          string          // random per-request state (see oauth-state.ts)
  redirectUri:    string
}

export interface OAuthAuthorizeResult {
  /** Full authorization URL the browser is redirected to. */
  authorizeUrl: string
}

export interface OAuthCallbackInput {
  code:         string
  state:        string
  redirectUri:  string
  /** Provider-specific hint (e.g. QBO's realmId query param). */
  providerHints?: Record<string, string>
}

export interface OAuthTokenResult {
  accessToken:         string
  refreshToken:        string | null
  expiresAt:           Date | null
  providerAccountId:   string
  providerAccountLabel: string | null
}

// ─────────────────────────────────────────────────
// Report fetching
// ─────────────────────────────────────────────────

export interface FetchReportInput {
  accessToken:       string
  providerAccountId: string
  reportKind:        AccountingReportKind
  /** Optional caller-controlled period. Interpretation is provider-specific. */
  periodStart?: string
  periodEnd?:   string
}

/**
 * The abstract shape every adapter emits. Server actions turn these
 * into `AccountingSourceRow` DB rows.
 */
export interface SourceRowPayload {
  externalRowId?: string
  accountCode?:   string
  accountName:    string
  category?:      string
  period:         string
  amount:         string      // decimal-safe string, never a JS number
  currency:       string
  rawPayload?:    unknown
}

export interface FetchReportResult {
  reportKind:   AccountingReportKind
  periodLabel:  string
  rows:         SourceRowPayload[]
  fetchedAt:    Date
}

// ─────────────────────────────────────────────────
// Adapter interface
// ─────────────────────────────────────────────────

export interface ConnectorAdapter {
  provider: AccountingProvider

  /** Return the full authorize URL for the provider's OAuth. */
  buildAuthorizeUrl(input: OAuthAuthorizeInput): OAuthAuthorizeResult

  /** Exchange the OAuth code for tokens + resolve the account label. */
  exchangeCode(input: OAuthCallbackInput): Promise<OAuthTokenResult>

  /** Refresh the access token using the refresh token. */
  refresh?(input: { refreshToken: string }): Promise<OAuthTokenResult>

  /**
   * Fetch a canonical report. Adapters that do not support a given
   * report kind throw `UnsupportedReportError`.
   */
  fetchReport(input: FetchReportInput): Promise<FetchReportResult>
}

export class UnsupportedReportError extends Error {
  constructor(provider: string, kind: string) {
    super(`Provider ${provider} does not yet support report ${kind}`)
    this.name = 'UnsupportedReportError'
  }
}

/**
 * Signal that an adapter has not been implemented yet. Distinct type
 * so server code + tests can catch it explicitly.
 */
export class AdapterNotImplementedError extends Error {
  constructor(provider: string) {
    super(`Adapter for ${provider} is registered but not yet implemented`)
    this.name = 'AdapterNotImplementedError'
  }
}
