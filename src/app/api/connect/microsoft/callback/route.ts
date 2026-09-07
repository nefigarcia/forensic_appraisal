
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { saveOAuthToken } from '@/app/actions/connectors';
import {
  OAUTH_STATE_COOKIE,
  verifyOAuthState,
  clearedOauthStateCookieAttrs,
} from '@/lib/oauth-state';

export async function GET(request: NextRequest) {
  const searchParams   = request.nextUrl.searchParams;
  const code           = searchParams.get('code');
  const error          = searchParams.get('error');
  const presentedState = searchParams.get('state');

  // Always clear the state cookie once we've received a callback for it,
  // regardless of outcome. Prevents a stale state from being re-used.
  const clearState = (res: NextResponse) => {
    res.cookies.set(clearedOauthStateCookieAttrs());
    return res;
  };

  if (error) {
    return clearState(
      NextResponse.redirect(new URL(`/connections?error=${encodeURIComponent(error)}`, request.url)),
    );
  }

  if (!code) {
    return clearState(
      NextResponse.redirect(new URL('/connections?error=no_code', request.url)),
    );
  }

  // ── CSRF: verify the state parameter against the cookie set on redirect.
  const cookieState = (await cookies()).get(OAUTH_STATE_COOKIE)?.value ?? null;
  if (!verifyOAuthState(presentedState, cookieState)) {
    return clearState(
      NextResponse.redirect(new URL('/connections?error=state_mismatch', request.url)),
    );
  }

  const clientId     = env.MICROSOFT_CLIENT_ID;
  const clientSecret = env.MICROSOFT_CLIENT_SECRET;
  const redirectUri  = env.MICROSOFT_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return clearState(
      NextResponse.redirect(new URL('/connections?error=misconfigured', request.url)),
    );
  }

  try {
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/common/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     clientId,
          client_secret: clientSecret,
          code,
          redirect_uri:  redirectUri,
          grant_type:    'authorization_code',
        }),
      },
    );

    const data = await tokenResponse.json();

    if (data.error) {
      // Log only the error code/description from Microsoft. Never log tokens.
      console.error('[oauth callback] microsoft returned an error:', data.error);
      return clearState(
        NextResponse.redirect(new URL('/connections?error=token_exchange_failed', request.url)),
      );
    }

    // saveOAuthToken encrypts before write.
    await saveOAuthToken('microsoft', data);

    return clearState(
      NextResponse.redirect(new URL('/connections?success=true', request.url)),
    );
  } catch (err) {
    console.error('[oauth callback] token exchange threw:', (err as Error).message);
    return clearState(
      NextResponse.redirect(new URL('/connections?error=token_exchange_failed', request.url)),
    );
  }
}
