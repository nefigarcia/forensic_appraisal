/**
 * The load-bearing permission resolver for Slice-16 search.
 *
 * ANY search — factual or AI-planned — MUST route through
 * `resolveAuthorizedCaseIds(session)`. The returned list is the ONLY
 * set of `caseId`s the caller may see in results. The query composer
 * takes it as `authorizedCaseIds` and adds a `caseId IN (…)` clause.
 *
 * The invariants this module preserves are:
 *
 *   1. Slice-1 tenant boundary. Only cases in the caller's org.
 *   2. Slice-11 engagement gate. When `Case.hasEngagementTeam=true`,
 *      non-ADMIN callers must have an *active* CaseMember row.
 *   3. Fail-closed on unexpected errors. If the resolver throws, the
 *      caller MUST NOT return results.
 *   4. The list is computed BEFORE any user-supplied filter is
 *      applied — the AI's filter cannot influence which caseIds are
 *      considered.
 *
 * See docs/architecture/CASE_SEARCH.md for the leakage-defense
 * write-up. Every deviation from this pattern is a security bug.
 */

import { prisma } from '@/lib/prisma'
import type { SessionPayload } from '@/lib/auth-utils'

export interface AuthorizedCasesResult {
  authorizedCaseIds: string[]
  restrictedCaseIds: string[]  // for observability — cases the user is org-scoped for but locked out of
}

/**
 * Resolve the caseIds the given session may search.
 *
 * Implementation:
 *   1. Fetch every case in the caller's org, projecting
 *      `hasEngagementTeam` only.
 *   2. For cases without an engagement team → always allowed.
 *   3. For cases WITH an engagement team → allowed if the caller is
 *      an ADMIN or has an active `CaseMember` row.
 *
 * We do the JOIN application-side (two queries) rather than a Prisma
 * `AND` with a related-record filter because the JSON `array_contains`
 * filter used elsewhere and the engagement-gate filter don't compose
 * cleanly in Prisma 5.x. Two queries + application-side intersection
 * is simpler and equally correct.
 */
export async function resolveAuthorizedCaseIds(session: SessionPayload): Promise<AuthorizedCasesResult> {
  const rows = await prisma.case.findMany({
    where:  { organizationId: session.organizationId },
    select: { id: true, hasEngagementTeam: true },
  })

  const allowed:    string[] = []
  const restricted: string[] = []

  if (session.role === 'ADMIN') {
    // ADMINs see every case in the org — Slice-11 spec: "org ADMIN OR
    // an active CaseMember".
    for (const r of rows) allowed.push(r.id)
    return { authorizedCaseIds: allowed, restrictedCaseIds: [] }
  }

  const restrictedIds = rows.filter(r => r.hasEngagementTeam).map(r => r.id)
  const unrestrictedIds = rows.filter(r => !r.hasEngagementTeam).map(r => r.id)

  // For every restricted case, check active membership. The query is
  // scoped to (caseId IN restrictedIds, userId = session.userId,
  // removedAt IS NULL) so we only load the rows we might allow.
  let memberIds: Set<string> = new Set()
  if (restrictedIds.length > 0) {
    const members = await prisma.caseMember.findMany({
      where: {
        userId:    session.userId,
        removedAt: null,
        caseId:    { in: restrictedIds },
      },
      select: { caseId: true },
    })
    memberIds = new Set(members.map(m => m.caseId))
  }

  for (const id of unrestrictedIds) allowed.push(id)
  for (const id of restrictedIds) {
    if (memberIds.has(id)) allowed.push(id)
    else                   restricted.push(id)
  }
  return { authorizedCaseIds: allowed, restrictedCaseIds: restricted }
}

/**
 * Apply an authorization filter to an already-computed result set —
 * used as a defense-in-depth pass after the DB query. Even if the
 * composer somehow lets a row through (schema drift, bug, …), the
 * result is filtered against the authorized set before it leaves
 * the server action.
 *
 * If the caller ever sees a result whose caseId is NOT in the
 * authorized list, the row is dropped and a `leakedCaseIds` list is
 * returned so the caller can log it.
 */
export function filterResultsToAuthorized<T extends { caseId: string }>(
  rows:               T[],
  authorizedCaseIds:  string[],
): { rows: T[]; leakedCaseIds: string[] } {
  const authorized = new Set(authorizedCaseIds)
  const leaked: string[] = []
  const out:    T[] = []
  for (const r of rows) {
    if (authorized.has(r.caseId)) out.push(r)
    else leaked.push(r.caseId)
  }
  return { rows: out, leakedCaseIds: leaked }
}
