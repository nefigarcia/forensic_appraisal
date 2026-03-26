/**
 * Role-Based Access Control
 *
 * Roles (lowest → highest privilege):
 *   VIEWER   – read-only on assigned cases
 *   REVIEWER – read + comment, cannot approve or edit values
 *   EDITOR   – full case access, can approve, override, generate reports
 *   ADMIN    – all of the above + org settings, team management
 */

export type Role = 'VIEWER' | 'REVIEWER' | 'EDITOR' | 'ADMIN'

export type Permission =
  | 'case:create'
  | 'case:delete'
  | 'case:read'
  | 'document:upload'
  | 'document:delete'
  | 'extraction:run'
  | 'value:accept'
  | 'value:override'
  | 'value:reject'
  | 'value:lock'
  | 'value:approve_batch'
  | 'addback:write'
  | 'addback:approve'
  | 'valuation:write'
  | 'report:generate'
  | 'anomaly:run'
  | 'team:manage'
  | 'org:settings'
  | 'audit:read'

const PERMISSIONS: Record<Role, Permission[]> = {
  VIEWER: [
    'case:read',
    'audit:read',
  ],
  REVIEWER: [
    'case:read',
    'audit:read',
    'value:accept',
  ],
  EDITOR: [
    'case:read',
    'case:create',
    'document:upload',
    'document:delete',
    'extraction:run',
    'value:accept',
    'value:override',
    'value:reject',
    'value:lock',
    'value:approve_batch',
    'addback:write',
    'addback:approve',
    'valuation:write',
    'report:generate',
    'anomaly:run',
    'audit:read',
  ],
  ADMIN: [
    'case:read',
    'case:create',
    'case:delete',
    'document:upload',
    'document:delete',
    'extraction:run',
    'value:accept',
    'value:override',
    'value:reject',
    'value:lock',
    'value:approve_batch',
    'addback:write',
    'addback:approve',
    'valuation:write',
    'report:generate',
    'anomaly:run',
    'team:manage',
    'org:settings',
    'audit:read',
  ],
}

export function hasPermission(role: string, permission: Permission): boolean {
  const normalized = (role?.toUpperCase() ?? 'VIEWER') as Role
  return PERMISSIONS[normalized]?.includes(permission) ?? false
}

export function requirePermission(role: string, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Forbidden: role '${role}' cannot perform '${permission}'`)
  }
}

/** Convenience: throw if session is missing or lacks permission */
export function guardAction(
  session: { role?: string } | null,
  permission: Permission,
): void {
  if (!session) throw new Error('Unauthorized: no active session')
  requirePermission(session.role ?? 'VIEWER', permission)
}
