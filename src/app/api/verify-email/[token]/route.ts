import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { verifyEmailToken } from '@/app/actions/email-verification'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const result = await verifyEmailToken(token)
  const base = new URL(env.NEXT_PUBLIC_APP_URL)
  if ('error' in result) {
    return NextResponse.redirect(new URL('/login?verify=invalid', base))
  }
  return NextResponse.redirect(new URL('/login?verify=ok', base))
}
