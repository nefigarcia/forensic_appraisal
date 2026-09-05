'use server'

/**
 * Admin diagnostics for AI executions.
 *
 * Both reads are ADMIN-only via `team:manage` (an ADMIN-only permission
 * in the Slice-0 RBAC map). Executions are ALWAYS org-scoped — even an
 * ADMIN cannot see another org's runs.
 */

import { prisma } from '@/lib/prisma'
import {
  requireSession,
  requirePermission,
  ForbiddenError,
  NotFoundError,
} from '@/lib/authz'

export interface AiExecutionListRow {
  id:               string
  flowName:         string
  flowVersion:      string | null
  modelName:        string
  status:           string
  startedAt:        Date
  completedAt:      Date | null
  durationMs:       number | null
  errorCategory:    string | null
  reviewStatus:     string
  userEmail:        string | null
  caseName:         string | null
  documentVersionCount: number
}

export interface AiExecutionDetail extends AiExecutionListRow {
  organizationId:      string
  promptTemplateKey:   string | null
  modelProvider:       string
  modelVersion:        string | null
  inputHash:           string
  outputHash:          string | null
  documentVersionIds:  string[]
  errorMessage:        string | null
  inputTokens:         number | null
  outputTokens:        number | null
  totalTokens:         number | null
  estimatedCostUsd:    string | null
  /** Aggregate FinancialValue reviewStatus counts derived on demand. */
  financialValueSummary: {
    total:      number
    pending:    number
    accepted:   number
    overridden: number
    rejected:   number
  }
}

const LIST_ROW_SELECT = {
  id: true, flowName: true, flowVersion: true, modelName: true,
  status: true, startedAt: true, completedAt: true, durationMs: true,
  errorCategory: true, reviewStatus: true,
  documentVersionIds: true,
  user: { select: { email: true } },
  case: { select: { name: true } },
} as const

function toListRow(r: any): AiExecutionListRow {
  const ids = Array.isArray(r.documentVersionIds) ? r.documentVersionIds as unknown[] : []
  return {
    id: r.id,
    flowName: r.flowName,
    flowVersion: r.flowVersion,
    modelName: r.modelName,
    status: r.status,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    durationMs: r.durationMs,
    errorCategory: r.errorCategory,
    reviewStatus: r.reviewStatus,
    userEmail: r.user?.email ?? null,
    caseName:  r.case?.name  ?? null,
    documentVersionCount: ids.length,
  }
}

/**
 * List the most recent AI executions in the caller's org. ADMIN-only.
 * Filters keep the result usable when a chatty extraction batch has run.
 */
export async function getRecentAiExecutions(filters: {
  limit?:      number         // default 50, max 200
  flowName?:   string
  status?:     'SUCCESS' | 'FAILURE' | 'RUNNING'
  caseId?:     string
} = {}): Promise<AiExecutionListRow[]> {
  const session = await requireSession()
  requirePermission(session, 'team:manage')

  const take = Math.min(Math.max(filters.limit ?? 50, 1), 200)
  const rows = await prisma.aiExecution.findMany({
    where: {
      organizationId: session.organizationId,
      ...(filters.flowName ? { flowName: filters.flowName } : {}),
      ...(filters.status   ? { status:   filters.status }   : {}),
      ...(filters.caseId   ? { caseId:   filters.caseId }   : {}),
    },
    orderBy: { startedAt: 'desc' },
    take,
    select: LIST_ROW_SELECT,
  })
  return rows.map(toListRow)
}

/**
 * Detail for one execution: everything above plus prompt template key,
 * input/output hashes, error message (sanitized), token counts, and the
 * aggregated review status of every FinancialValue this execution
 * proposed.
 */
export async function getAiExecutionDetail(executionId: string): Promise<AiExecutionDetail> {
  const session = await requireSession()
  requirePermission(session, 'team:manage')

  const row = await prisma.aiExecution.findFirst({
    where: { id: executionId, organizationId: session.organizationId },
    include: {
      user: { select: { email: true } },
      case: { select: { name: true } },
      financialValues: { select: { reviewStatus: true } },
    },
  })
  if (!row) throw new NotFoundError()

  const summary = { total: 0, pending: 0, accepted: 0, overridden: 0, rejected: 0 }
  for (const v of row.financialValues) {
    summary.total++
    switch (v.reviewStatus) {
      case 'ACCEPTED':   summary.accepted++;   break
      case 'OVERRIDDEN': summary.overridden++; break
      case 'REJECTED':   summary.rejected++;   break
      default:           summary.pending++
    }
  }

  const ids = Array.isArray(row.documentVersionIds) ? row.documentVersionIds as unknown[] : []

  return {
    ...toListRow(row),
    organizationId:    row.organizationId,
    promptTemplateKey: row.promptTemplateKey,
    modelProvider:     row.modelProvider,
    modelVersion:      row.modelVersion,
    inputHash:         row.inputHash,
    outputHash:        row.outputHash,
    documentVersionIds: ids.map(String),
    errorMessage:      row.errorMessage,
    inputTokens:       row.inputTokens,
    outputTokens:      row.outputTokens,
    totalTokens:       row.totalTokens,
    estimatedCostUsd:  row.estimatedCostUsd?.toString() ?? null,
    financialValueSummary: summary,
  }
}

/**
 * Explicitly record a human's aggregate verdict on an execution as a
 * whole. Individual FinancialValue.reviewStatus rows are unchanged.
 */
export async function setAiExecutionReviewStatus(
  executionId: string,
  reviewStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'OVERRIDDEN' | 'MIXED',
): Promise<void> {
  const session = await requireSession()
  requirePermission(session, 'team:manage')

  const exists = await prisma.aiExecution.findFirst({
    where: { id: executionId, organizationId: session.organizationId },
    select: { id: true },
  })
  if (!exists) throw new NotFoundError()

  await prisma.aiExecution.update({
    where: { id: executionId },
    data:  { reviewStatus, reviewedBy: session.userId, reviewedAt: new Date() },
  })
}

// Guard against silent role-check drift: this file must never be
// callable by a non-admin. If a future contributor imports these
// actions from an unauthenticated route, requireSession will throw.
void ForbiddenError
