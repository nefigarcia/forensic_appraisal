
import { NextRequest, NextResponse } from 'next/server'
import { isJwtSignedAndUnexpired, SESSION_COOKIE_NAME } from './lib/auth-edge'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Slice 12 — the client portal is a public surface. It never issues a
  // firm session cookie and is authenticated per-request by the opaque
  // token in the URL. Middleware carves the whole /portal/* tree out of
  // the redirect logic below so a client hitting an expired link stays
  // on /portal/* (where the page can render a friendly explanation)
  // rather than being bounced to /login (which would confuse them and
  // hint at internal firm routing).
  if (pathname === '/portal' || pathname.startsWith('/portal/')) {
    return NextResponse.next()
  }

  // Edge-safe presence check: we only verify signature + expiry here. The
  // DB-backed revocation and password-changed checks happen inside
  // `getSession()` at the action layer.
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const hasSession = await isJwtSignedAndUnexpired(raw)

  const publicPaths = ['/', '/login', '/signup']
  const isPublicPath = publicPaths.includes(pathname)

  if (!hasSession && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (hasSession && isPublicPath && pathname !== '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  // Exclude API routes, Next.js internals, favicon, and all public static assets
  // (landing page frames/css/js, videos, and common media/font extensions)
  matcher: [
    '/((?!api/webhooks|api|_next/static|_next/image|favicon.ico|landing|videos|.*\\.(?:webp|png|jpg|jpeg|svg|gif|ico|mp4|webm|css|js|woff2?|ttf|otf)$).*)',
  ],
}
