/**
 * Central resource authorization.
 *
 * Every server-side data access should route through one of these helpers.
 * They collapse three checks into one call so a mutation cannot silently
 * skip any of them:
 *
 *   1. session       — is there a signed-in user?
 *   2. tenant        — does the resource belong to the caller's org?
 *   3. permission    — does the caller's role permit the operation?
 *
 * Ordering matters: we fetch with a tenant-scoped filter *before* checking
 * the permission, so:
 *
 *   - a missing or cross-tenant resource returns 404 (indistinguishable),
 *     preventing enumeration of ids that exist in other orgs;
 *   - a caller whose role lacks the permission for a resource they *can* see
 *     returns 403.
 *
 * Helpers return the fetched row so callers don't need a second query.
 */

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { hasPermission, type Permission } from '@/lib/rbac'

// ─────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────

export type AuthzErrorCode = 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND'

export class AuthzError extends Error {
  code: AuthzErrorCode
  constructor(code: AuthzErrorCode, message: string) {
    super(message)
    this.name = 'AuthzError'
    this.code = code
  }
}

export class UnauthorizedError extends AuthzError {
  constructor(message = 'Unauthorized') { super('UNAUTHORIZED', message) }
}

export class ForbiddenError extends AuthzError {
  constructor(message = 'Forbidden') { super('FORBIDDEN', message) }
}

/** Fired both when a resource is missing and when it exists in another org.
 *  The two cases are intentionally indistinguishable. */
export class NotFoundError extends AuthzError {
  constructor(message = 'Not found') { super('NOT_FOUND', message) }
}

// ─────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────

export interface SessionPayload {
  userId: string
  organizationId: string
  role: string
  email: string
  iat?: number
  exp?: number
}

/** Require a signed-in session. Throws UnauthorizedError otherwise. */
export async function requireSession(): Promise<SessionPayload> {
  const raw = await getSession()
  if (!raw || typeof raw !== 'object') throw new UnauthorizedError()
  const s = raw as Partial<SessionPayload>
  if (!s.userId || !s.organizationId || !s.role) throw new UnauthorizedError()
  return s as SessionPayload
}

/** Sugar for requireSession, kept for readability at call sites where the
 *  tenant scope is the point (e.g. listing all cases for the org). */
export async function requireOrganization(): Promise<SessionPayload> {
  return requireSession()
}

/** RBAC check on an already-authenticated session. */
export function requirePermission(session: SessionPayload, permission: Permission): void {
  if (!hasPermission(session.role, permission)) {
    throw new ForbiddenError(`role '${session.role}' cannot perform '${permission}'`)
  }
}

// ─────────────────────────────────────────────────
// Resource helpers
// ─────────────────────────────────────────────────

/** Verify a case belongs to the caller's org and (optionally) that the caller
 *  has a permission. Returns the case row. */
export async function requireCaseAccess(caseId: string, permission?: Permission) {
  const session = await requireSession()
  const record = await prisma.case.findFirst({
    where: { id: caseId, organizationId: session.organizationId },
  })
  if (!record) throw new NotFoundError()
  if (permission) requirePermission(session, permission)
  return { session, case: record }
}

/** Verify a document belongs to a case in the caller's org. */
export async function requireDocumentAccess(documentId: string, permission?: Permission) {
  const session = await requireSession()
  const record = await prisma.document.findFirst({
    where: { id: documentId, case: { organizationId: session.organizationId } },
    include: { case: { select: { id: true, organizationId: true } } },
  })
  if (!record) throw new NotFoundError()
  if (permission) requirePermission(session, permission)
  return { session, document: record }
}

/** Verify a FinancialValue belongs to a case in the caller's org. */
export async function requireFinancialValueAccess(valueId: string, permission?: Permission) {
  const session = await requireSession()
  const record = await prisma.financialValue.findFirst({
    where: { id: valueId, case: { organizationId: session.organizationId } },
  })
  if (!record) throw new NotFoundError()
  if (permission) requirePermission(session, permission)
  return { session, value: record }
}

/** Verify an AddBack belongs to a case in the caller's org. */
export async function requireAddBackAccess(addBackId: string, permission?: Permission) {
  const session = await requireSession()
  const record = await prisma.addBack.findFirst({
    where: { id: addBackId, case: { organizationId: session.organizationId } },
  })
  if (!record) throw new NotFoundError()
  if (permission) requirePermission(session, permission)
  return { session, addBack: record }
}

/** Verify a ValuationModel belongs to a case in the caller's org. */
export async function requireValuationModelAccess(modelId: string, permission?: Permission) {
  const session = await requireSession()
  const record = await prisma.valuationModel.findFirst({
    where: { id: modelId, case: { organizationId: session.organizationId } },
  })
  if (!record) throw new NotFoundError()
  if (permission) requirePermission(session, permission)
  return { session, model: record }
}

/** Verify an AnomalyFlag belongs to a case in the caller's org. */
export async function requireAnomalyFlagAccess(flagId: string, permission?: Permission) {
  const session = await requireSession()
  const record = await prisma.anomalyFlag.findFirst({
    where: { id: flagId, case: { organizationId: session.organizationId } },
  })
  if (!record) throw new NotFoundError()
  if (permission) requirePermission(session, permission)
  return { session, flag: record }
}

/** Verify a CaseInsight belongs to a case in the caller's org. */
export async function requireCaseInsightAccess(insightId: string, permission?: Permission) {
  const session = await requireSession()
  const record = await prisma.caseInsight.findFirst({
    where: { id: insightId, case: { organizationId: session.organizationId } },
  })
  if (!record) throw new NotFoundError()
  if (permission) requirePermission(session, permission)
  return { session, insight: record }
}

/** Verify an ExternalConnector belongs directly to the caller's org. */
export async function requireConnectorAccess(connectorId: string, permission?: Permission) {
  const session = await requireSession()
  const record = await prisma.externalConnector.findFirst({
    where: { id: connectorId, organizationId: session.organizationId },
  })
  if (!record) throw new NotFoundError()
  if (permission) requirePermission(session, permission)
  return { session, connector: record }
}
