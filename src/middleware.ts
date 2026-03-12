
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
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
