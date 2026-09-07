/**
 * Session constants shared between the Edge-safe module (`auth-edge.ts`)
 * and the Node-only module (`session.ts`). Keeping them in this
 * dependency-free file means the Edge module doesn't transitively import
 * Prisma.
 */

export const SESSION_COOKIE_NAME = 'session'
export const SESSION_TTL_SECONDS = 2 * 60 * 60 // 2 hours
