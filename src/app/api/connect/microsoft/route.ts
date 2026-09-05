
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { generateOAuthState, oauthStateCookieAttrs } from '@/lib/oauth-state';

export async function GET() {
  const clientId    = env.MICROSOFT_CLIENT_ID;
  const redirectUri = env.MICROSOFT_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'Microsoft OAuth environment variables are missing.' },
      { status: 500 },
    );
  }

  // Random per-request state — verified in the callback against this cookie.
  // See docs/architecture/MICROSOFT_OAUTH_SCOPES.md for the scope review.
  const state = generateOAuthState();
  (await cookies()).set(oauthStateCookieAttrs(state));

  // Scopes intentionally unchanged in this slice to avoid forcing users to
  // re-consent — the review is in the docs, and the trimming is planned as
  // a follow-up UX slice.
  const scope = encodeURIComponent(
    'user.read files.read.all sites.read.all offline_access',
  );

  const authUrl =
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` +
    `?client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_mode=query` +
    `&scope=${scope}` +
    `&state=${state}`;

  return NextResponse.redirect(authUrl);
}
