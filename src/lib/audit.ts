/**
 * Audit logging — every significant action is persisted to AuditLog.
 * Used as chain-of-custody evidence in forensic engagements.
 *
 * Slice 6: every write now joins a tamper-evident hash chain keyed by
 * organization (or `global:anon` for events with no discoverable org).
 * See src/lib/audit-chain.ts for the format + verifier.
 */

import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import {
  canonicalEventPayload,
  computeEventHash,
  chainKeyForOrg,
  ANON_CHAIN_KEY,
  HASH_VERSION,
} from '@/lib/audit-chain'

export type AuditAction =
  // Case + data lifecycle
  | 'CREATE_CASE'
  | 'UPDATE_CASE'
  | 'DELETE_CASE'
  | 'UPLOAD_DOCUMENT'
  | 'DELETE_DOCUMENT'
  // Slice 5 — document versioning + immutable evidence
  | 'UPLOAD_DOCUMENT_VERSION'
  | 'DOWNLOAD_DOCUMENT_VERSION'
  | 'ARCHIVE_DOCUMENT'
  | 'ARCHIVE_DOCUMENT_VERSION'
  | 'RESTORE_DOCUMENT_VERSION'
  | 'MALWARE_SCAN_COMPLETED'
  | 'MALWARE_SCAN_INFECTED'
  | 'RUN_EXTRACTION'
  | 'ACCEPT_VALUE'
  | 'OVERRIDE_VALUE'
  | 'REJECT_VALUE'
  | 'LOCK_VALUE'
  | 'UNLOCK_VALUE'
  | 'APPROVE_BATCH'
  | 'CREATE_ADDBACK'
  | 'UPDATE_ADDBACK'
  | 'APPROVE_ADDBACK'
  | 'UNAPPROVE_ADDBACK'
  | 'DELETE_ADDBACK'
  | 'SAVE_VALUATION'
  | 'GENERATE_REPORT'
  | 'RUN_ANOMALY_DETECTION'
  | 'RESOLVE_FLAG'
  | 'RUN_INDUSTRY_ANALYSIS'
  | 'RUN_TTM_NORMALIZATION'
  // Auth events (Slice 2)
  | 'LOGIN'                    // legacy alias for LOGIN_SUCCESS; kept for compat
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAIL'
  | 'LOGIN_RATE_LIMITED'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'EMAIL_VERIFICATION_SENT'
  | 'EMAIL_VERIFIED'
  | 'MFA_ENROLLED'
  | 'MFA_DISABLED'
  | 'SESSION_REVOKED'
  | 'SIGNUP'

export interface LogParams {
  /** May be null for pre-auth events (e.g. LOGIN_FAIL for an unknown email). */
  userId: string | null
  action: AuditAction
  /** Slice 6: pass explicitly when you have it — otherwise inferred from
   *  caseId → Case → org, then from userId → User → org. */
  organizationId?: string
  caseId?: string
  targetModel?: string
  targetId?: string
  oldValue?: unknown
  newValue?: unknown
  note?: string
  ipAddress?: string
}

const CHAIN_RETRY_LIMIT = 3

/**
 * cuid()-like generator using node crypto — Prisma's Node client normally
 * fills @default(cuid()) for us, but here we need the id BEFORE the row is
 * created so we can hash it into `eventHash`.
 */
function generateAuditId(): string {
  // 24 hex chars ≈ 96 bits of entropy — plenty for a per-org monotonic
  // audit row within a chainKey window.
  return 'a' + randomBytes(12).toString('hex')
}

/**
 * Resolve the chain a given event should join.
 *
 * Explicit `organizationId` wins. Then `caseId → Case.organizationId`.
 * Then `userId → User.organizationId`. Finally `global:anon` for the
 * anonymous chain.
 */
async function resolveChainKey(params: LogParams): Promise<string> {
  if (params.organizationId) return chainKeyForOrg(params.organizationId)
  if (params.caseId) {
    const c = await prisma.case.findUnique({
      where: { id: params.caseId },
      select: { organizationId: true },
    })
    if (c) return chainKeyForOrg(c.organizationId)
  }
  if (params.userId) {
    const u = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { organizationId: true },
    })
    if (u) return chainKeyForOrg(u.organizationId)
  }
  return ANON_CHAIN_KEY
}

async function writeChainedEvent(params: LogParams): Promise<void> {
  const chainKey = await resolveChainKey(params)

  // Common data that survives every retry.
  const oldValueStr = params.oldValue != null ? JSON.stringify(params.oldValue) : null
  const newValueStr = params.newValue != null ? JSON.stringify(params.newValue) : null

  for (let attempt = 0; attempt < CHAIN_RETRY_LIMIT; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        const tail = await tx.auditLog.findFirst({
          where: { chainKey },
          orderBy: { sequence: 'desc' },
          select: { sequence: true, eventHash: true },
        })
        const sequence     = (tail?.sequence ?? 0) + 1
        const previousHash = tail?.eventHash ?? null

        // Fix the identifiers ourselves so the hash can include them.
        const id        = generateAuditId()
        const createdAt = new Date()

        const eventHash = computeEventHash({
          id,
          createdAt,
          chainKey,
          sequence,
          hashVersion:  HASH_VERSION,
          action:       params.action,
          userId:       params.userId ?? null,
          caseId:       params.caseId ?? null,
          targetModel:  params.targetModel ?? null,
          targetId:     params.targetId ?? null,
          oldValue:     oldValueStr,
          newValue:     newValueStr,
          note:         params.note ?? null,
          ipAddress:    params.ipAddress ?? null,
          previousHash,
        })

        await tx.auditLog.create({
          data: {
            id,
            createdAt,
            userId:      params.userId ?? null,
            action:      params.action,
            caseId:      params.caseId,
            targetModel: params.targetModel,
            targetId:    params.targetId,
            oldValue:    oldValueStr ?? undefined,
            newValue:    newValueStr ?? undefined,
            note:        params.note,
            ipAddress:   params.ipAddress,
            chainKey,
            sequence,
            previousHash,
            eventHash,
            hashVersion: HASH_VERSION,
          },
        })
      })
      return
    } catch (e: any) {
      // P2002 = unique constraint violation on (chainKey, sequence). Two
      // concurrent writes raced; re-read the tail and try again.
      if (e?.code === 'P2002' && attempt < CHAIN_RETRY_LIMIT - 1) continue
      // Anything else, or the last retry — fall through to the unchained
      // fallback below so we never silently drop an event.
      throw e
    }
  }
}

export async function logAction(params: LogParams): Promise<void> {
  try {
    await writeChainedEvent(params)
    return
  } catch (chainErr) {
    console.error('[audit] chained write failed:', (chainErr as Error).message)
  }
  // Fallback — unchained INSERT. Verifier will treat this as pre-chain.
  // Better a degraded record than a lost one.
  try {
    await prisma.auditLog.create({
      data: {
        userId:      params.userId ?? null,
        action:      params.action,
        caseId:      params.caseId,
        targetModel: params.targetModel,
        targetId:    params.targetId,
        oldValue:    params.oldValue != null ? JSON.stringify(params.oldValue) : undefined,
        newValue:    params.newValue != null ? JSON.stringify(params.newValue) : undefined,
        note:        params.note,
        ipAddress:   params.ipAddress,
      },
    })
  } catch (err) {
    // Truly nothing we can do — audit must never crash the outer action.
    console.error('[audit] fallback write also failed:', err)
  }
}
