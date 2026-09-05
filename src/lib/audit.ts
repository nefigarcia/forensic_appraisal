/**
 * Audit logging — every significant action is persisted to AuditLog.
 * Used as chain-of-custody evidence in forensic engagements.
 */

import { prisma } from '@/lib/prisma'

export type AuditAction =
  // Case + data lifecycle
  | 'CREATE_CASE'
  | 'UPDATE_CASE'
  | 'DELETE_CASE'
  | 'UPLOAD_DOCUMENT'
  | 'DELETE_DOCUMENT'
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
  caseId?: string
  targetModel?: string
  targetId?: string
  oldValue?: unknown
  newValue?: unknown
  note?: string
  ipAddress?: string
}

export async function logAction(params: LogParams): Promise<void> {
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
    // Audit failures must never crash the main action
    console.error('[audit] Failed to write audit log:', err)
  }
}
