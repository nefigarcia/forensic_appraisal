'use server'

/**
 * Audit-integrity server actions.
 *
 * `verifyOrganizationAuditChain()` walks the caller's org chain and
 * reports the first invalid link. `verifyAnonymousAuditChain()` walks
 * `global:anon` and is restricted to ADMIN callers.
 *
 * Both actions require a valid session and route through the Slice 1
 * authz layer.
 */

import { prisma } from '@/lib/prisma'
import {
  requireSession,
  requirePermission,
  ForbiddenError,
} from '@/lib/authz'
import {
  chainKeyForOrg,
  ANON_CHAIN_KEY,
  verifyChainRows,
  type VerifyResult,
} from '@/lib/audit-chain'

const CHAIN_ROW_SELECT = {
  id: true, createdAt: true, chainKey: true, sequence: true,
  hashVersion: true, action: true, userId: true, caseId: true,
  targetModel: true, targetId: true,
  oldValue: true, newValue: true, note: true, ipAddress: true,
  previousHash: true, eventHash: true,
} as const

/** Verify the caller's organization's audit chain. Any signed-in user can
 *  run this — we intentionally keep it accessible to non-admins so
 *  analysts can spot-check their own case history. */
export async function verifyOrganizationAuditChain(): Promise<VerifyResult> {
  const session = await requireSession()
  requirePermission(session, 'audit:read')
  const chainKey = chainKeyForOrg(session.organizationId)
  const rows = await prisma.auditLog.findMany({
    where: { chainKey },
    orderBy: { sequence: 'asc' },
    select: CHAIN_ROW_SELECT,
  })
  return verifyChainRows(chainKey, rows)
}

/** Verify the anonymous global chain (LOGIN_FAIL for unknown emails,
 *  rate-limited attempts, etc.). Restricted to ADMIN. */
export async function verifyAnonymousAuditChain(): Promise<VerifyResult> {
  const session = await requireSession()
  if (session.role !== 'ADMIN') throw new ForbiddenError('anon chain requires ADMIN')
  const rows = await prisma.auditLog.findMany({
    where: { chainKey: ANON_CHAIN_KEY },
    orderBy: { sequence: 'asc' },
    select: CHAIN_ROW_SELECT,
  })
  return verifyChainRows(ANON_CHAIN_KEY, rows)
}
