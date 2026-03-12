
import { NextResponse } from 'next/server';

export async function GET() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "Microsoft OAuth environment variables are missing." }, { status: 500 });
  }

  const scope = encodeURIComponent("user.read files.read.all sites.read.all offline_access");
  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${scope}&state=forensic_valuvault`;

  return NextResponse.redirect(authUrl);
}
