
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from './lib/auth-utils';

export async function middleware(request: NextRequest) {
  const session = await getSession();
  
  const publicPaths = ['/', '/login', '/signup'];
  const isPublicPath = publicPaths.includes(request.nextUrl.pathname);

  if (!session && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (session && isPublicPath && request.nextUrl.pathname !== '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Exclude API routes, Next.js internals, favicon, and all public static assets
  // (landing page frames/css/js, videos, and common media/font extensions)
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|landing|videos|.*\\.(?:webp|png|jpg|jpeg|svg|gif|ico|mp4|webm|css|js|woff2?|ttf|otf)$).*)',
  ],
};
