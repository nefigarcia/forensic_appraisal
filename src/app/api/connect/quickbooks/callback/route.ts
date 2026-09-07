/**
 * QuickBooks OAuth callback.
 *
 * Verifies:
 *   1. The `state` query parameter matches the `oauth_state` cookie
 *      (CSRF defense).
 *   2. The `qbo_connect_ctx` cookie carries a valid caseId.
 *   3. `realmId` is present (Intuit-specific).
 *
 * On success, exchanges the code for tokens via the adapter and
 * writes an `AccountingConnector` row using envelope-encrypted
 * secrets (Slice-3 pattern).
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { requireSession, requireCaseAccess } from '@/lib/authz'
import {
  OAUTH_STATE_COOKIE, verifyOAuthState, clearedOauthStateCookieAttrs,
} from '@/lib/oauth-state'
import { getConnectorAdapter } from '@/lib/connectors/registry'
import { encryptString } from '@/lib/crypto/envelope'
import { logAction } from '@/lib/audit'

const CTX_COOKIE = 'qbo_connect_ctx'

export async function GET(request: NextRequest) {
  const session = await requireSession()
  const url = request.nextUrl
  const code    = url.searchParams.get('code')
  const state   = url.searchParams.get('state')
  const realmId = url.searchParams.get('realmId')

  const jar = await cookies()
  const stateCookie = jar.get(OAUTH_STATE_COOKIE)?.value
  const ctxRaw      = jar.get(CTX_COOKIE)?.value

  // Clear the temporary cookies regardless of outcome.
  const response = (body: string, status = 200) => {
    const res = NextResponse.redirect(new URL('/projects', request.url))
    if (status !== 200) {
      // Return a plain-text page on failure — no info leak.
      const err = new NextResponse(body, { status })
      err.cookies.set(clearedOauthStateCookieAttrs())
      err.cookies.set({ name: CTX_COOKIE, value: '', maxAge: 0, path: '/' })
      return err
    }
    res.cookies.set(clearedOauthStateCookieAttrs())
    res.cookies.set({ name: CTX_COOKIE, value: '', maxAge: 0, path: '/' })
    return res
  }

  if (!verifyOAuthState(state, stateCookie)) {
    return response('OAuth state validation failed', 400)
  }
  if (!code) return response('Missing OAuth code', 400)
  if (!realmId) return response('Missing realmId', 400)
  if (!ctxRaw)  return response('Missing OAuth context cookie', 400)

  let ctx: { caseId: string; organizationId: string }
  try { ctx = JSON.parse(ctxRaw) } catch { return response('Malformed OAuth context', 400) }
  if (!ctx.caseId || ctx.organizationId !== session.organizationId) {
    return response('OAuth context mismatch', 400)
  }

  // Confirm the caller can access the case.
  await requireCaseAccess(ctx.caseId, 'org:settings')

  const adapter = getConnectorAdapter('QUICKBOOKS')
  const redirectUri =
    `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/connect/quickbooks/callback`

  // `code`, `state`, `realmId` are non-null past the guards above,
  // but TS cannot narrow across the response() helper.
  const tokens = await adapter.exchangeCode({
    code:  code!,
    state: state!,
    redirectUri,
    providerHints: { realmId: realmId! },
  })

  // Envelope-encrypt every token before writing.
  const secrets: Record<string, { ciphertext: string; keyRef: string; iv: string; tag: string; keyVersion: string }> = {}
  const enc = await encryptString(tokens.accessToken)
  ;(secrets as any).accessToken = enc
  let keyVersion: string = enc.keyVersion
  if (tokens.refreshToken) {
    const encR = await encryptString(tokens.refreshToken)
    ;(secrets as any).refreshToken = encR
    keyVersion = encR.keyVersion
  }
  const encryptedBlob = { version: 'v1' as const, secrets }

  const connector = await prisma.accountingConnector.upsert({
    where: {
      AccountingConnector_case_provider_account: {
        caseId:            ctx.caseId,
        provider:          'QUICKBOOKS',
        providerAccountId: tokens.providerAccountId,
      },
    },
    update: {
      encryptedSecrets:     encryptedBlob as any,
      encryptionKeyVersion: keyVersion,
      expiresAt:            tokens.expiresAt,
      status:               'CONNECTED',
      providerAccountLabel: tokens.providerAccountLabel,
      lastSyncAt:           null,
    },
    create: {
      organizationId:       session.organizationId,
      caseId:               ctx.caseId,
      provider:             'QUICKBOOKS',
      providerAccountId:    tokens.providerAccountId,
      providerAccountLabel: tokens.providerAccountLabel,
      encryptedSecrets:     encryptedBlob as any,
      encryptionKeyVersion: keyVersion,
      expiresAt:            tokens.expiresAt,
      status:               'CONNECTED',
      connectedBy:          session.userId,
    },
  })

  await logAction({
    userId: session.userId,
    action: 'UPDATE_CASE',
    caseId: ctx.caseId,
    targetModel: 'AccountingConnector', targetId: connector.id,
    note: `connected QuickBooks realm ${tokens.providerAccountId}`,
  })

  return response(`Connected`, 200)
}
