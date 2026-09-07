'use server'

/**
 * Excel export + import server actions.
 *
 * Export helpers pull APPROVED / verified rows from the case and
 * produce a workbook whose metadata block ties it to the case.
 *
 * Import actions land in two phases:
 *   1. `startExcelImport` — parse + validate + produce a diff. NO DB
 *      writes to case data. Only `ExcelImportRun` is written with
 *      status PENDING_REVIEW.
 *   2. `applyExcelImport` — the reviewer approves the diff. UPDATE /
 *      INSERT actions are applied atomically. PROTECTED actions are
 *      skipped unless the caller explicitly passes the row keys in
 *      `overrideRowKeys` (which is audited).
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError } from '@/lib/authz'
import { isTemplateKind, TEMPLATE_REGISTRY, type TemplateKind } from '@/lib/spreadsheets/template-schema'
import { buildWorkbook } from '@/lib/spreadsheets/excel-export'
import {
  parseWorkbook, diffRows, type DiffSummary, type ImportResult,
  normalizeCompare,
} from '@/lib/spreadsheets/excel-import'
import { money } from '@/lib/money'

// ─────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────

export interface ExportResult {
  base64:   string
  filename: string
  rowCount: number
}

export async function exportSpreadsheet(input: {
  caseId:       string
  templateKind: string
}): Promise<ExportResult> {
  if (!isTemplateKind(input.templateKind)) throw new Error(`Unknown template kind: ${input.templateKind}`)
  const { session, case: c } = await requireCaseAccess(input.caseId, 'case:read')
  const template = TEMPLATE_REGISTRY[input.templateKind]

  let rows: Array<Record<string, unknown>> = []

  if (input.templateKind === 'FINANCIAL_LEDGER') {
    const values = await prisma.financialValue.findMany({
      where:   { caseId: input.caseId },
      orderBy: [{ year: 'asc' }, { statementType: 'asc' }, { lineItem: 'asc' }],
    })
    rows = values.map(v => ({
      valueId:       v.id,
      year:          v.year,
      statementType: v.statementType,
      lineItem:      v.lineItem,
      value:         v.valueDecimal?.toString() ?? String(v.value),
      currency:      v.currency,
      isVerified:    v.isVerified,
      isLocked:      v.isLocked,
      origin:        v.origin,
      documentId:    v.documentId,
    }))
  } else if (input.templateKind === 'NORMALIZATION') {
    const addBacks = await prisma.addBack.findMany({
      where:   { caseId: input.caseId },
      orderBy: [{ category: 'asc' }, { description: 'asc' }],
    })
    rows = addBacks.map(a => ({
      addBackId:    a.id,
      category:     a.category,
      description:  a.description,
      year2:        a.year2Decimal?.toString() ?? null,
      year1:        a.year1Decimal?.toString() ?? null,
      ttm:          a.ttmDecimal?.toString() ?? null,
      direction:    a.direction,
      recurring:    a.recurring,
      taxTreatment: a.taxTreatment,
      status:       a.status,
      rationale:    a.rationale,
    }))
  } else if (input.templateKind === 'VALUATION') {
    const engagement = await prisma.valuationEngagement.findUnique({
      where: { caseId: input.caseId },
      include: {
        scenarios: {
          include: { approaches: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    })
    for (const s of engagement?.scenarios ?? []) {
      for (const a of s.approaches) {
        rows.push({
          scenarioKey:    s.key,
          approachKind:   a.kind,
          label:          a.label,
          weight:         a.weight.toString(),
          isIncluded:     a.isIncluded,
          indicatedValue: a.indicatedValue?.toString() ?? null,
          computedAt:     a.computedAt,
          note:           a.computationNote,
        })
      }
    }
  } else if (input.templateKind === 'TIE_OUTS') {
    const tieOuts = await prisma.tieOut.findMany({
      where:   { caseId: input.caseId },
      include: { items: true },
      orderBy: [{ concept: 'asc' }, { year: 'asc' }],
    })
    for (const t of tieOuts) {
      for (const it of t.items) {
        rows.push({
          tieOutId:          t.id,
          concept:           t.concept,
          year:              t.year,
          sourceLabel:       it.sourceLabel,
          value:             it.value.toString(),
          status:            t.status,
          toleranceAbsolute: t.toleranceAbsolute?.toString() ?? null,
          tolerancePercent:  t.tolerancePercent?.toString() ?? null,
          maxDifference:     t.maxDifference?.toString() ?? null,
          resolutionNote:    t.resolutionNote,
        })
      }
    }
  }

  const buf = await buildWorkbook({
    templateKind: input.templateKind as TemplateKind,
    metadata: {
      app:             'ValuVault',
      templateKind:    input.templateKind,
      templateVersion: template.version,
      caseId:          input.caseId,
      caseName:        c.name,
      organizationId:  session.organizationId,
      exportedAt:      new Date().toISOString(),
    },
    rows,
  })

  await logAction({
    userId: session.userId, action: 'GENERATE_REPORT',
    caseId: input.caseId,
    targetModel: 'ExcelExport', targetId: input.templateKind,
    note: `exported ${rows.length} rows for ${input.templateKind}`,
  })

  return {
    base64:   buf.toString('base64'),
    filename: safeFilename(`${c.name}_${input.templateKind}.xlsx`),
    rowCount: rows.length,
  }
}

// ─────────────────────────────────────────────────
// Import — phase 1: parse + diff + persist as PENDING_REVIEW
// ─────────────────────────────────────────────────

export interface StartImportResult {
  ok:      boolean
  runId:   string | null
  errors:  string[]
  warnings: string[]
  metadata?: {
    templateKind:    string
    templateVersion: string
    exportedAt:      string
    caseId:          string
  }
  diff?:  DiffSummary
}

export async function startExcelImport(input: {
  caseId:       string
  templateKind: string
  filename:     string
  base64:       string        // client sends the file as base64
}): Promise<StartImportResult> {
  if (!isTemplateKind(input.templateKind)) throw new Error(`Unknown template kind: ${input.templateKind}`)
  const { session } = await requireCaseAccess(input.caseId, 'document:upload')

  const buffer = Buffer.from(input.base64, 'base64')
  const parsed: ImportResult = await parseWorkbook(buffer, {
    expectedCaseId:       input.caseId,
    expectedTemplateKind: input.templateKind as TemplateKind,
  })

  // Persist an ExcelImportRun even for validation failures so an
  // auditor can see what was attempted.
  if (!parsed.ok) {
    const run = await prisma.excelImportRun.create({
      data: {
        caseId:            input.caseId,
        templateKind:      input.templateKind,
        templateVersion:   parsed.metadata?.templateVersion ?? 'unknown',
        filename:          input.filename,
        fileSha256:        parsed.fileSha256,
        detectedCaseId:    parsed.metadata?.caseId,
        status:            'FAILED_VALIDATION',
        triggeredBy:       session.userId,
        validationSummary: { errors: parsed.errors, warnings: parsed.warnings } as any,
      },
    })
    await logAction({
      userId: session.userId, action: 'UPDATE_CASE',
      caseId: input.caseId, targetModel: 'ExcelImportRun', targetId: run.id,
      note: `Excel import validation failed: ${parsed.errors[0] ?? 'unknown'}`,
    })
    return { ok: false, runId: run.id, errors: parsed.errors, warnings: parsed.warnings, metadata: undefined }
  }

  // Compute the diff against the current DB state.
  const diff = await computeDiffForTemplate(input.templateKind as TemplateKind, input.caseId, parsed.rows)

  const run = await prisma.excelImportRun.create({
    data: {
      caseId:            input.caseId,
      templateKind:      input.templateKind,
      templateVersion:   parsed.metadata.templateVersion,
      filename:          input.filename,
      fileSha256:        parsed.fileSha256,
      detectedCaseId:    parsed.metadata.caseId,
      status:            'PENDING_REVIEW',
      triggeredBy:       session.userId,
      validationSummary: { errors: [], warnings: parsed.warnings } as any,
      proposedChanges:   { proposals: diff.proposals } as any,
      diffSummary: {
        inserts:   diff.inserts,
        updates:   diff.updates,
        unchanged: diff.unchanged,
        protected: diff.protected,
      } as any,
    },
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: input.caseId, targetModel: 'ExcelImportRun', targetId: run.id,
    note: `Excel import ready: ${diff.inserts} inserts, ${diff.updates} updates, ${diff.protected} protected`,
  })
  revalidatePath(`/projects/${input.caseId}`)
  return {
    ok: true, runId: run.id, errors: [], warnings: parsed.warnings,
    metadata: {
      templateKind: parsed.metadata.templateKind,
      templateVersion: parsed.metadata.templateVersion,
      exportedAt: parsed.metadata.exportedAt,
      caseId: parsed.metadata.caseId,
    },
    diff,
  }
}

// ─────────────────────────────────────────────────
// Import — phase 2: apply approved diff
// ─────────────────────────────────────────────────

export async function applyExcelImport(input: {
  runId:            string
  overrideRowKeys?: string[]     // rowKeys the reviewer explicitly unlocked
}): Promise<{ applied: number; skipped: number; protectedSkipped: number }> {
  const run = await prisma.excelImportRun.findUnique({ where: { id: input.runId } })
  if (!run) throw new NotFoundError()
  if (run.status !== 'PENDING_REVIEW') {
    throw new Error(`Excel import run is ${run.status} — cannot apply`)
  }
  const { session } = await requireCaseAccess(run.caseId, 'document:upload')

  const proposals = ((run.proposedChanges as any)?.proposals ?? []) as Array<{
    rowKey: string; action: string;
    proposedValues: Record<string, string | null>;
    existingValues?: Record<string, string | null>;
    changedFields: string[];
    protectedFields: string[];
    reasons: string[];
  }>
  const overrides = new Set(input.overrideRowKeys ?? [])

  let applied = 0, skipped = 0, protectedSkipped = 0

  await prisma.$transaction(async (tx) => {
    for (const p of proposals) {
      if (p.action === 'UNCHANGED') { skipped++; continue }
      if (p.action === 'PROTECTED' && !overrides.has(p.rowKey)) {
        protectedSkipped++; continue
      }
      const isInsert   = p.action === 'INSERT'
      const isUpdate   = p.action === 'UPDATE'
      const isProtOK   = p.action === 'PROTECTED' && overrides.has(p.rowKey)
      if (!(isInsert || isUpdate || isProtOK)) { skipped++; continue }

      if (run.templateKind === 'FINANCIAL_LEDGER') {
        await applyLedgerRow(tx as any, run.caseId, p, session.userId, isInsert)
      } else if (run.templateKind === 'NORMALIZATION') {
        await applyAddBackRow(tx as any, run.caseId, p, isInsert)
      } else {
        // Valuation + tie-outs imports round-trip is descriptive only in Slice 15.
        // We accept the row shape but do not mutate case data — a future slice
        // wires those into the valuation workbench.
      }
      applied++
    }

    await tx.excelImportRun.update({
      where: { id: run.id },
      data: {
        status:     'APPLIED',
        appliedAt:  new Date(),
        appliedBy:  session.userId,
        reviewedAt: new Date(),
        reviewedBy: session.userId,
      },
    })
  })

  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: run.caseId, targetModel: 'ExcelImportRun', targetId: run.id,
    note: `Excel import applied — ${applied} rows applied, ${protectedSkipped} protected skipped`,
  })
  revalidatePath(`/projects/${run.caseId}`)
  return { applied, skipped, protectedSkipped }
}

export async function rejectExcelImport(input: { runId: string; reason?: string }): Promise<void> {
  const run = await prisma.excelImportRun.findUnique({ where: { id: input.runId } })
  if (!run) throw new NotFoundError()
  if (run.status !== 'PENDING_REVIEW') return
  const { session } = await requireCaseAccess(run.caseId, 'document:upload')
  await prisma.excelImportRun.update({
    where: { id: run.id },
    data: {
      status: 'REJECTED', reviewedAt: new Date(), reviewedBy: session.userId,
    },
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: run.caseId, targetModel: 'ExcelImportRun', targetId: run.id,
    note: `Excel import rejected${input.reason ? ` — ${input.reason.slice(0, 200)}` : ''}`,
  })
  revalidatePath(`/projects/${run.caseId}`)
}

// ─────────────────────────────────────────────────
// Diff computation per template
// ─────────────────────────────────────────────────

async function computeDiffForTemplate(kind: TemplateKind, caseId: string, imported: Array<{
  rowNumber: number; values: Record<string, string | null>
}>): Promise<DiffSummary> {
  if (kind === 'FINANCIAL_LEDGER') {
    const existing = await prisma.financialValue.findMany({ where: { caseId } })
    const existingById = new Map(existing.map(v => [v.id, {
      valueId:       v.id,
      year:          v.year,
      statementType: v.statementType,
      lineItem:      v.lineItem,
      value:         v.valueDecimal?.toString() ?? String(v.value),
      currency:      v.currency,
      isVerified:    v.isVerified ? 'true' : 'false',
      isLocked:      v.isLocked   ? 'true' : 'false',
      origin:        v.origin,
      documentId:    v.documentId,
    } as Record<string, string | null>]))
    return diffRows({
      imported, existingById,
      identityKey: 'valueId',
      protectionPredicate: existing => existing.isVerified === 'true' || existing.isLocked === 'true',
      protectedFields:  ['value', 'currency', 'year', 'statementType', 'lineItem'],
    })
  }
  if (kind === 'NORMALIZATION') {
    const existing = await prisma.addBack.findMany({ where: { caseId } })
    const existingById = new Map(existing.map(a => [a.id, {
      addBackId:    a.id,
      category:     a.category,
      description:  a.description,
      year2:        a.year2Decimal?.toString() ?? null,
      year1:        a.year1Decimal?.toString() ?? null,
      ttm:          a.ttmDecimal?.toString() ?? null,
      direction:    a.direction,
      recurring:    a.recurring,
      taxTreatment: a.taxTreatment,
      status:       a.status,
      rationale:    a.rationale,
    } as Record<string, string | null>]))
    return diffRows({
      imported, existingById,
      identityKey: 'addBackId',
      protectionPredicate: existing => existing.status === 'APPROVED',
      protectedFields:  ['category', 'description', 'year2', 'year1', 'ttm', 'direction'],
    })
  }
  // Valuation + tie-outs treated as descriptive — every row lands as an
  // UNCHANGED / INSERT proposal.
  return diffRows({
    imported, existingById: new Map(),
    identityKey: kind === 'VALUATION' ? 'scenarioKey' : 'tieOutId',
    protectionPredicate: () => true,
    protectedFields: [],
  })
}

// ─────────────────────────────────────────────────
// Row appliers
// ─────────────────────────────────────────────────

async function applyLedgerRow(
  tx: any, caseId: string,
  p: { rowKey: string; action: string; proposedValues: Record<string, string | null> },
  userId: string,
  isInsert: boolean,
) {
  const v = p.proposedValues
  const data: any = {
    year:          v.year,
    statementType: v.statementType,
    lineItem:      v.lineItem,
    valueDecimal:  v.value ?? undefined,
    value:         v.value != null ? Number(money(v.value).toString()) : undefined,
    currency:      v.currency ?? 'USD',
    origin:        'EXCEL',
  }
  if (isInsert) {
    await tx.financialValue.create({
      data: {
        ...data,
        caseId,
        // isVerified / isLocked never inherit from the sheet — a fresh
        // insert always lands unverified until a human confirms.
        isVerified: false,
        isLocked:   false,
      },
    })
  } else {
    await tx.financialValue.update({
      where: { id: p.rowKey },
      data,
    })
  }
}

async function applyAddBackRow(
  tx: any, caseId: string,
  p: { rowKey: string; action: string; proposedValues: Record<string, string | null> },
  isInsert: boolean,
) {
  const v = p.proposedValues
  const data: any = {
    category:     v.category,
    description:  v.description,
    year2Decimal: v.year2 ?? null,
    year1Decimal: v.year1 ?? null,
    ttmDecimal:   v.ttm ?? null,
    direction:    v.direction,
    recurring:    v.recurring,
    taxTreatment: v.taxTreatment,
    // Status is NEVER promoted from the sheet — professional decision.
    // The importer respects the current DB status.
    rationale:    v.rationale,
  }
  if (isInsert) {
    await tx.addBack.create({ data: { ...data, caseId, status: 'DRAFT' } })
  } else {
    await tx.addBack.update({ where: { id: p.rowKey }, data })
  }
}

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_')
}

// keep normalizeCompare export live for downstream utilities
void normalizeCompare
