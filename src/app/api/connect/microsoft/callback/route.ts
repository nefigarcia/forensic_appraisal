
import { NextRequest, NextResponse } from 'next/server';
import { saveOAuthToken } from '@/app/actions/connectors';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/connections?error=' + error, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/connections?error=no_code', request.url));
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID!;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI!;

  try {
    const tokenResponse = await fetch(`https://login.microsoftonline.com/common/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const data = await tokenResponse.json();

    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    // Persist the tokens in your database
    await saveOAuthToken('microsoft', data);

    return NextResponse.redirect(new URL('/connections?success=true', request.url));
  } catch (err: any) {
    console.error("Microsoft OAuth Callback Error:", err);
    return NextResponse.redirect(new URL('/connections?error=token_exchange_failed', request.url));
  }
}
