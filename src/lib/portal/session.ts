/**
 * Portal-request authorization.
 *
 * Every portal server action starts with `resolvePortalAccess(rawToken)`.
 * The helper hashes the raw token, looks it up in `PortalAccess`, and
 * enforces:
 *
 *   1. The row exists (else NotFoundError — no distinction from a
 *      cross-tenant scan, per the Slice-1 anti-enumeration rule).
 *   2. `revokedAt` is null.
 *   3. `expiresAt` is in the future.
 *   4. The parent RequestList status is not CLOSED.
 *
 * On success the row is returned together with the caseId/orgId/
 * clientContactId scope. NOTHING in the returned shape may be used
 * outside this scope. Portal actions must ONLY write to rows scoped to
 * `requestListId` (or `caseId` if a downstream table only carries the
 * denormalized case pointer).
 *
 * There is NO firm session, org role, or JWT involved. Portal callers
 * never appear to `getSession()`.
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/authz'
import { hashPortalToken, looksLikePortalToken } from './tokens'

export interface PortalScope {
  tokenHash:       string
  requestListId:   string
  caseId:          string
  organizationId:  string
  clientContactId: string
  contactName:     string
  contactEmail:    string
  expiresAt:       Date
}

/**
 * Resolve + validate a raw portal token. Throws NotFoundError on any
 * failure (never leaks which check failed).
 *
 * Callers pass the raw URL token; we hash it once here and never carry
 * the raw value further.
 */
export async function resolvePortalAccess(rawToken: unknown): Promise<PortalScope> {
  if (!looksLikePortalToken(rawToken)) throw new NotFoundError()
  const tokenHash = hashPortalToken(rawToken)

  const row = await prisma.portalAccess.findUnique({
    where: { tokenHash },
    include: {
      clientContact: { select: { id: true, name: true, email: true, isActive: true } },
      requestList:   { select: { id: true, status: true, caseId: true } },
      case:          { select: { id: true, organizationId: true } },
    },
  })
  if (!row) throw new NotFoundError()
  if (row.revokedAt) throw new NotFoundError()
  if (row.expiresAt <= new Date()) throw new NotFoundError()
  if (!row.clientContact?.isActive) throw new NotFoundError()
  if (row.requestList.status === 'CLOSED') throw new NotFoundError()
  // Defense-in-depth: denormalized caseId must match the joined row.
  if (row.requestList.caseId !== row.caseId) throw new NotFoundError()

  return {
    tokenHash,
    requestListId:   row.requestList.id,
    caseId:          row.caseId,
    organizationId:  row.case.organizationId,
    clientContactId: row.clientContact.id,
    contactName:     row.clientContact.name,
    contactEmail:    row.clientContact.email,
    expiresAt:       row.expiresAt,
  }
}

/**
 * Record a portal-side "touch" — increments usageCount + updates
 * lastUsedAt/lastUsedIp. Errors are swallowed: an audit-style failure
 * should never break the client's experience.
 */
export async function recordPortalUse(tokenHash: string, ip?: string): Promise<void> {
  try {
    await prisma.portalAccess.update({
      where: { tokenHash },
      data:  {
        lastUsedAt: new Date(),
        lastUsedIp: ip ?? null,
        usageCount: { increment: 1 },
      },
    })
  } catch {
    // Non-fatal.
  }
}
