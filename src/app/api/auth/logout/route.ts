import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:9002'))
  response.cookies.delete('session')
  return response
}

// Handle accidental GET (e.g. browser prefetch) gracefully
export async function GET() {
  const response = NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:9002'))
  response.cookies.delete('session')
  return response
}
