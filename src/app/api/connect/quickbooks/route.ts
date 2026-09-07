/**
 * Start the QuickBooks Online OAuth flow for a specific case.
 *
 * Query parameters:
 *   - `caseId` — the case the connector will be attached to on
 *     callback.
 *
 * Response:
 *   - 302 redirect to the Intuit authorize URL, with an HttpOnly
 *     `oauth_state` cookie carrying the CSRF token and an
 *     `qbo_connect_ctx` cookie carrying the caseId.
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'
import { requireSession } from '@/lib/authz'
import { generateOAuthState, oauthStateCookieAttrs } from '@/lib/oauth-state'
import { getConnectorAdapter } from '@/lib/connectors/registry'

const CTX_COOKIE = 'qbo_connect_ctx'

export async function GET(request: NextRequest) {
  const session = await requireSession()
  const caseId = request.nextUrl.searchParams.get('caseId') ?? ''
  if (!caseId) {
    return NextResponse.json({ error: 'caseId is required' }, { status: 400 })
  }

  const state = generateOAuthState()
  const redirectUri =
    `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/connect/quickbooks/callback`

  const adapter = getConnectorAdapter('QUICKBOOKS')
  const { authorizeUrl } = adapter.buildAuthorizeUrl({
    organizationId: session.organizationId,
    caseId,
    state,
    redirectUri,
  })

  const jar = await cookies()
  jar.set(oauthStateCookieAttrs(state))
  jar.set({
    name:     CTX_COOKIE,
    value:    JSON.stringify({ caseId, organizationId: session.organizationId }),
    httpOnly: true,
    secure:   env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   10 * 60,
  })

  return NextResponse.redirect(authorizeUrl)
}
