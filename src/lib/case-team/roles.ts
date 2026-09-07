/**
 * Case-level engagement roles.
 *
 * These are distinct from the org-level RBAC roles in `src/lib/rbac.ts`.
 * The engagement role controls WHAT you can do on a specific case; the
 * org RBAC role controls the org-wide permissions your session carries.
 *
 * Authorization composes:
 *   1. session exists                              — src/lib/authz.ts
 *   2. case belongs to caller's org                — requireCaseAccess
 *   3. IF Case.hasEngagementTeam:
 *        caller is org ADMIN  *OR*  active CaseMember
 *   4. IF caller path needs it:
 *        - org-level permission via requirePermission (Slice 1)
 *        - case-level role via requireCaseRole (this module)
 *
 * External collaborators are architected for later — the enum value
 * exists so the schema and helpers are ready, but no automatic
 * privileges are granted yet.
 */

export const CASE_ROLES = [
  'ENGAGEMENT_PARTNER',
  'MANAGER',
  'SENIOR',
  'ANALYST',
  'REVIEWER',
  'READ_ONLY',
  'EXTERNAL_COLLABORATOR',
] as const

export type CaseRole = typeof CASE_ROLES[number]

export function isCaseRole(v: string): v is CaseRole {
  return (CASE_ROLES as readonly string[]).includes(v)
}

export const CASE_ROLE_LABEL: Record<CaseRole, string> = {
  ENGAGEMENT_PARTNER:    'Engagement Partner',
  MANAGER:               'Manager',
  SENIOR:                'Senior',
  ANALYST:               'Analyst',
  REVIEWER:              'Reviewer',
  READ_ONLY:             'Read-only',
  EXTERNAL_COLLABORATOR: 'External collaborator',
}

/**
 * Case-role rank (higher = more privileged). Used by `atLeastCaseRole`
 * for "engagement partner or above" style checks.
 */
export const CASE_ROLE_RANK: Record<CaseRole, number> = {
  ENGAGEMENT_PARTNER:    100,
  MANAGER:               80,
  SENIOR:                60,
  ANALYST:               40,
  REVIEWER:              30,
  READ_ONLY:             10,
  EXTERNAL_COLLABORATOR: 5,
}

export function atLeastCaseRole(role: string, minimum: CaseRole): boolean {
  const r = (CASE_ROLE_RANK as Record<string, number | undefined>)[role]
  return r !== undefined && r >= CASE_ROLE_RANK[minimum]
}

/**
 * Roles allowed to manage the engagement team (add/remove members,
 * change roles). Partner + Manager only. Analysts and below cannot
 * add themselves or others to the case.
 */
export function canManageTeam(role: string): boolean {
  return role === 'ENGAGEMENT_PARTNER' || role === 'MANAGER'
}
