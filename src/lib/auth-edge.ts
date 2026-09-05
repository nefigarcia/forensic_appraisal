/**
 * Edge-runtime-safe subset of the auth surface.
 *
 * Middleware runs in the Edge runtime and cannot import Prisma or Node's
 * `crypto`. This module has no such imports — it only decodes and verifies
 * the session JWT. The full DB-backed session check lives in `auth-utils.ts`
 * and runs at the action layer.
 */

import { jwtVerify } from 'jose'
import { env } from './env'
import { SESSION_COOKIE_NAME } from './session-constants'

const key = new TextEncoder().encode(env.JWT_SECRET)

/** Returns true iff the raw cookie decodes to a valid, non-expired JWT. */
export async function isJwtSignedAndUnexpired(raw: string | undefined | null): Promise<boolean> {
  if (!raw) return false
  try {
    await jwtVerify(raw, key, { algorithms: ['HS256'] })
    return true
  } catch {
    return false
  }
}

export { SESSION_COOKIE_NAME }
