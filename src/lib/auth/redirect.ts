/**
 * Open-redirect guard.
 *
 * Every user-controlled redirect target — including a login `?returnTo=`
 * parameter, an OAuth callback state, or any place where we might route
 * a user based on client input — must go through `safeRedirectPath()`.
 *
 * Rules:
 *  - Path must start with a single `/` (`/dashboard`, `/projects/123`).
 *  - It must not start with `//` or `/\`, which browsers may interpret
 *    as a protocol-relative URL to another host.
 *  - It must not contain a scheme (`http:`, `https:`, `javascript:`,
 *    `data:`, ...).
 *  - If it doesn't pass, return the fallback (typically `/dashboard`).
 *
 * We intentionally accept only same-origin paths, not full URLs, so this
 * helper cannot itself be misused as an escape hatch.
 */

const SAFE_PATH = /^\/(?!\/|\\)[^\r\n]*$/
const SCHEME    = /^[a-z][a-z0-9+.-]*:/i

export function isSafeRedirectPath(input: unknown): input is string {
  if (typeof input !== 'string' || input === '') return false
  if (SCHEME.test(input)) return false
  return SAFE_PATH.test(input)
}

export function safeRedirectPath(input: unknown, fallback: string): string {
  if (!isSafeRedirectPath(fallback)) {
    throw new Error('[safeRedirectPath] fallback is itself unsafe')
  }
  return isSafeRedirectPath(input) ? input : fallback
}
