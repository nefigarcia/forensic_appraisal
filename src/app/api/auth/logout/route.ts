import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { getSession } from '@/lib/auth-utils'
import { clearedSessionCookieAttrs, revokeSession } from '@/lib/session'
import { logAction } from '@/lib/audit'

async function performLogout(): Promise<NextResponse> {
  const session = await getSession().catch(() => null)
  if (session?.jti) {
    try {
      await revokeSession(
        session.jti,
        session.userId,
        'LOGOUT',
        session.exp ? new Date(session.exp * 1000) : undefined,
      )
    } catch (e) {
      console.error('[logout route] revoke failed:', e)
    }
    await logAction({ userId: session.userId, action: 'LOGOUT' })
  }
  const response = NextResponse.redirect(new URL('/', env.NEXT_PUBLIC_APP_URL))
  response.cookies.set(clearedSessionCookieAttrs())
  return response
}

export async function POST() { return performLogout() }

// Handle accidental GET (e.g. browser prefetch) gracefully.
export async function GET()  { return performLogout() }
