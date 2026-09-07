'use server';

import { prisma } from '@/lib/prisma'
import { createSessionToken, getSession } from '@/lib/auth-utils'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { hashPassword, verifyPassword, needsRehash } from '@/lib/auth/passwords'
import { assertNotRateLimited, recordLoginAttempt, RateLimitedError } from '@/lib/auth/rate-limit'
import { sessionCookieAttrs, clearedSessionCookieAttrs, revokeSession } from '@/lib/session'
import { safeRedirectPath } from '@/lib/auth/redirect'
import { logAction } from '@/lib/audit'

async function clientIpAddress(): Promise<string | null> {
  try {
    const h = await headers()
    const fwd = h.get('x-forwarded-for')
    if (fwd) return fwd.split(',')[0]!.trim()
    return h.get('x-real-ip')
  } catch {
    return null
  }
}

export async function signup(formData: FormData) {
  const email    = (formData.get('email')    as string ?? '').trim().toLowerCase()
  const password = formData.get('password')  as string
  const name     = formData.get('name')      as string
  const orgName  = formData.get('orgName')   as string

  if (!email || !password || !name || !orgName) {
    return { error: 'Missing required fields' }
  }

  const hashed = await hashPassword(password)

  const org = await prisma.organization.create({
    data: { name: orgName },
  })

  const user = await prisma.user.create({
    data: {
      email,
      password: hashed,
      name,
      organizationId: org.id,
      role: 'ADMIN',
      passwordChangedAt: new Date(),
    },
  })

  const { token, expiresAt } = await createSessionToken({
    userId:         user.id,
    organizationId: org.id,
    role:           user.role,
    email:          user.email,
  })
  ;(await cookies()).set(sessionCookieAttrs(token, expiresAt))

  const ip = await clientIpAddress()
  await logAction({ userId: user.id, action: 'SIGNUP',        note: `org=${orgName}`, ipAddress: ip ?? undefined })
  await logAction({ userId: user.id, action: 'LOGIN_SUCCESS', note: 'signup',        ipAddress: ip ?? undefined })

  redirect('/dashboard')
}

export async function login(formData: FormData) {
  const email    = (formData.get('email')    as string ?? '').trim().toLowerCase()
  const password = formData.get('password')  as string
  const returnTo = formData.get('returnTo')  as string | null

  if (!email || !password) return { error: 'Invalid credentials' }

  const ip = await clientIpAddress()

  // ── Rate limit ────────────────────────────────────────────────────
  try {
    await assertNotRateLimited(email)
  } catch (e) {
    if (e instanceof RateLimitedError) {
      await logAction({
        userId: null, action: 'LOGIN_RATE_LIMITED',
        note: email, ipAddress: ip ?? undefined,
      })
      return { error: 'Too many login attempts. Try again in 15 minutes.' }
    }
    throw e
  }

  // ── Credential verify ─────────────────────────────────────────────
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    // Do NOT reveal whether the email exists — always return the same message.
    await recordLoginAttempt(email, ip, false, 'UNKNOWN_USER')
    await logAction({ userId: null, action: 'LOGIN_FAIL', note: 'unknown-user', ipAddress: ip ?? undefined })
    return { error: 'Invalid credentials' }
  }

  const ok = await verifyPassword(password, user.password)
  if (!ok) {
    await recordLoginAttempt(email, ip, false, 'BAD_PASSWORD')
    await logAction({ userId: user.id, action: 'LOGIN_FAIL', note: 'bad-password', ipAddress: ip ?? undefined })
    return { error: 'Invalid credentials' }
  }

  // ── Opportunistic hash upgrade ────────────────────────────────────
  if (needsRehash(user.password)) {
    try {
      const upgraded = await hashPassword(password)
      await prisma.user.update({ where: { id: user.id }, data: { password: upgraded } })
    } catch (e) {
      // Rehash failure must never block login.
      console.error('[login] hash upgrade failed:', e)
    }
  }

  // ── Issue session ────────────────────────────────────────────────
  const { token, expiresAt } = await createSessionToken({
    userId:         user.id,
    organizationId: user.organizationId,
    role:           user.role,
    email:          user.email,
  })
  ;(await cookies()).set(sessionCookieAttrs(token, expiresAt))

  await recordLoginAttempt(email, ip, true)
  await logAction({ userId: user.id, action: 'LOGIN_SUCCESS', ipAddress: ip ?? undefined })

  // Same-origin only.
  const target = safeRedirectPath(returnTo, '/dashboard')
  redirect(target)
}

export async function logout() {
  const session = await getSession()
  if (session?.jti) {
    try {
      await revokeSession(
        session.jti,
        session.userId,
        'LOGOUT',
        session.exp ? new Date(session.exp * 1000) : undefined,
      )
    } catch (e) {
      // If the revocation store is unreachable we still clear the cookie —
      // the session becomes untrusted at the next page load anyway.
      console.error('[logout] session revocation failed:', e)
    }
    await logAction({ userId: session.userId, action: 'LOGOUT' })
  }
  ;(await cookies()).set(clearedSessionCookieAttrs())
  redirect('/login')
}
