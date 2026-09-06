'use server'

/**
 * Accounting-connector server actions.
 *
 * The OAuth handshake itself lives at
 * `src/app/api/connect/quickbooks/route.ts` (start) and
 * `.../callback/route.ts` (finish). These actions surround the OAuth
 * flow with:
 *   - listing existing connectors for a case
 *   - manual disconnect
 *   - triggering an ingestion run for a given report kind
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError } from '@/lib/authz'
import { getConnectorAdapter } from '@/lib/connectors/registry'
import {
  isAccountingProvider, isAccountingReportKind,
  type SourceRowPayload,
} from '@/lib/connectors/types'
import { decryptString } from '@/lib/crypto/envelope'

// ─────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────

export interface ConnectorForClient {
  id:                   string
  provider:             string
  providerAccountId:    string
  providerAccountLabel: string | null
  status:               string
  connectedAt:          Date
  lastSyncAt:           Date | null
  expiresAt:            Date | null
  encryptionKeyVersion: string | null
}

export async function listAccountingConnectors(caseId: string): Promise<ConnectorForClient[]> {
  await requireCaseAccess(caseId, 'case:read')
  const rows = await prisma.accountingConnector.findMany({
    where:   { caseId },
    orderBy: { connectedAt: 'desc' },
    select:  {
      id: true, provider: true, providerAccountId: true, providerAccountLabel: true,
      status: true, connectedAt: true, lastSyncAt: true, expiresAt: true,
      encryptionKeyVersion: true,
    },
  })
  return rows
}

export interface SourceRowSummary {
  runId:       string
  provider:    string
  reportType:  string
  periodLabel: string | null
  status:      string
  rowsIngested: number
  startedAt:   Date
  completedAt: Date | null
}

export async function listIngestionRuns(caseId: string): Promise<SourceRowSummary[]> {
  await requireCaseAccess(caseId, 'case:read')
  const runs = await prisma.accountingIngestionRun.findMany({
    where: { caseId }, orderBy: { startedAt: 'desc' }, take: 50,
    select: {
      id: true, provider: true, reportType: true, periodLabel: true,
      status: true, rowsIngested: true, startedAt: true, completedAt: true,
    },
  })
  return runs.map(r => ({
    runId: r.id, provider: r.provider, reportType: r.reportType,
    periodLabel: r.periodLabel, status: r.status,
    rowsIngested: r.rowsIngested, startedAt: r.startedAt, completedAt: r.completedAt,
  }))
}

// ─────────────────────────────────────────────────
// Ingestion
// ─────────────────────────────────────────────────

export async function ingestConnectorReport(input: {
  connectorId: string
  reportKind:  string
  periodStart?: string
  periodEnd?:   string
}): Promise<{ runId: string; rows: number; status: string }> {
  if (!isAccountingReportKind(input.reportKind)) throw new Error(`Unknown report kind: ${input.reportKind}`)
  const connector = await prisma.accountingConnector.findUnique({
    where: { id: input.connectorId },
    include: { case: { select: { id: true, organizationId: true } } },
  })
  if (!connector) throw new NotFoundError()
  const { session } = await requireCaseAccess(connector.case.id, 'extraction:run')

  const run = await prisma.accountingIngestionRun.create({
    data: {
      caseId:      connector.case.id,
      connectorId: connector.id,
      provider:    connector.provider,
      reportType:  input.reportKind,
      status:      'RUNNING',
      triggeredBy: session.userId,
    },
  })

  try {
    const adapter = getConnectorAdapter(connector.provider)
    if (!isAccountingProvider(connector.provider)) throw new Error(`Provider corrupt: ${connector.provider}`)

    // Decrypt the access token — never stored on the connector object beyond this call.
    const blob = connector.encryptedSecrets as any
    if (!blob?.secrets?.accessToken) throw new Error('Connector has no access token stored')
    const accessToken = await decryptString(blob.secrets.accessToken)
    if (!accessToken) throw new Error('Connector access token decryption returned null')

    const result = await adapter.fetchReport({
      accessToken,
      providerAccountId: connector.providerAccountId,
      reportKind:        input.reportKind,
      periodStart:       input.periodStart,
      periodEnd:         input.periodEnd,
    })

    // Persist rows.
    await persistSourceRows({
      caseId:        connector.case.id,
      connectorId:   connector.id,
      ingestionRunId: run.id,
      provider:      connector.provider,
      reportType:    input.reportKind,
      periodLabel:   result.periodLabel,
      userId:        session.userId,
      rows:          result.rows,
    })

    await prisma.accountingIngestionRun.update({
      where: { id: run.id },
      data:  {
        status: 'SUCCESS', completedAt: new Date(),
        rowsIngested: result.rows.length, periodLabel: result.periodLabel,
      },
    })
    await prisma.accountingConnector.update({
      where: { id: connector.id }, data: { lastSyncAt: new Date() },
    })
    await logAction({
      userId: session.userId, action: 'RUN_EXTRACTION',
      caseId: connector.case.id,
      targetModel: 'AccountingIngestionRun', targetId: run.id,
      note: `${connector.provider} ${input.reportKind} — ${result.rows.length} rows`,
    })
    revalidatePath(`/projects/${connector.case.id}`)
    return { runId: run.id, rows: result.rows.length, status: 'SUCCESS' }

  } catch (err: any) {
    await prisma.accountingIngestionRun.update({
      where: { id: run.id },
      data:  {
        status: 'FAILURE', completedAt: new Date(),
        errorMessage: String(err?.message ?? err).slice(0, 500),
      },
    }).catch(() => { /* audit never crashes the outer error */ })
    throw err
  }
}

async function persistSourceRows(input: {
  caseId: string; connectorId: string | null; ingestionRunId: string;
  provider: string; reportType: string; periodLabel: string; userId: string;
  rows: SourceRowPayload[];
}): Promise<void> {
  if (input.rows.length === 0) return
  await prisma.accountingSourceRow.createMany({
    data: input.rows.map(r => ({
      caseId:        input.caseId,
      connectorId:   input.connectorId,
      ingestionRunId: input.ingestionRunId,
      provider:      input.provider,
      reportType:    input.reportType,
      externalRowId: r.externalRowId,
      accountCode:   r.accountCode,
      accountName:   r.accountName,
      category:      r.category,
      period:        r.period === 'CURRENT' ? input.periodLabel : r.period,
      amountDecimal: r.amount,
      currency:      r.currency,
      rawPayload:    r.rawPayload as any,
      ingestedBy:    input.userId,
      status:        'PENDING_PROMOTION',
    })),
  })
}

// ─────────────────────────────────────────────────
// Disconnect
// ─────────────────────────────────────────────────

export async function disconnectAccountingConnector(input: { connectorId: string }): Promise<void> {
  const row = await prisma.accountingConnector.findUnique({
    where: { id: input.connectorId }, select: { id: true, caseId: true, provider: true },
  })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.caseId, 'org:settings')
  // Retain the row for audit but wipe the secrets + mark disconnected.
  await prisma.accountingConnector.update({
    where: { id: row.id },
    data: {
      status:              'DISCONNECTED',
      encryptedSecrets:    null as any,
      encryptionKeyVersion: null,
      expiresAt:           null,
    },
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: row.caseId, targetModel: 'AccountingConnector', targetId: row.id,
    note: `disconnected ${row.provider} connector`,
  })
  revalidatePath(`/projects/${row.caseId}`)
}

// ─────────────────────────────────────────────────
// Source rows — promote to FinancialValue with origin tag
// ─────────────────────────────────────────────────

export async function listSourceRows(caseId: string): Promise<Array<{
  id: string; provider: string; reportType: string; accountName: string;
  accountCode: string | null; category: string | null; period: string;
  amount: string | null; currency: string; status: string;
}>> {
  await requireCaseAccess(caseId, 'case:read')
  const rows = await prisma.accountingSourceRow.findMany({
    where:   { caseId },
    orderBy: { ingestedAt: 'desc' },
    take:    500,
  })
  return rows.map(r => ({
    id: r.id, provider: r.provider, reportType: r.reportType,
    accountName: r.accountName, accountCode: r.accountCode,
    category: r.category, period: r.period,
    amount: r.amountDecimal?.toString() ?? null,
    currency: r.currency, status: r.status,
  }))
}

/**
 * Promote a source row into a `FinancialValue` row. The origin field
 * is stamped from the source row's provider so the UI shows the value
 * came from QBO / Xero / Sage / etc. — never conflated with AI or
 * hand-entered values.
 */
export async function promoteSourceRow(input: {
  sourceRowId:   string
  year:          string
  statementType: string
  lineItem:      string
}): Promise<{ financialValueId: string }> {
  const row = await prisma.accountingSourceRow.findUnique({
    where: { id: input.sourceRowId },
    include: { case: { select: { id: true } } },
  })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.case.id, 'value:accept')

  const created = await prisma.$transaction(async (tx) => {
    const fv = await tx.financialValue.create({
      data: {
        caseId:        row.case.id,
        year:          input.year,
        statementType: input.statementType,
        lineItem:      input.lineItem,
        value:         Number(row.amountDecimal?.toString() ?? '0'),
        valueDecimal:  row.amountDecimal ?? undefined,
        currency:      row.currency,
        isVerified:    false,
        isLocked:      false,
        origin:        row.provider,
        sourceRowId:   row.id,
      },
    })
    await tx.accountingSourceRow.update({
      where: { id: row.id }, data: { status: 'PROMOTED' },
    })
    return fv
  })

  await logAction({
    userId: session.userId, action: 'ACCEPT_VALUE',
    caseId: row.case.id, targetModel: 'FinancialValue', targetId: created.id,
    note: `promoted from ${row.provider} source row`,
  })
  revalidatePath(`/projects/${row.case.id}`)
  return { financialValueId: created.id }
}
