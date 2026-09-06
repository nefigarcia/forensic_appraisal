/**
 * LOAD-BEARING: Excel export → import round-trip.
 *
 * A ValuVault-exported workbook, imported back into the same case,
 * must produce ZERO changes. This test proves the invariant end-to-end
 * without touching the DB.
 */

import { describe, it, expect } from 'vitest'
import { buildWorkbook } from '@/lib/spreadsheets/excel-export'
import { parseWorkbook, diffRows } from '@/lib/spreadsheets/excel-import'

const CASE_ID = 'case-round-trip'

const sampleRows = [
  {
    valueId: 'fv-1', year: '2024', statementType: 'IS',
    lineItem: 'Revenue', value: '1250000.00', currency: 'USD',
    isVerified: 'true', isLocked: 'false', origin: 'AI', documentId: 'doc-1',
  },
  {
    valueId: 'fv-2', year: '2024', statementType: 'IS',
    lineItem: 'COGS', value: '450000.00', currency: 'USD',
    isVerified: 'false', isLocked: 'false', origin: 'AI', documentId: null,
  },
]

describe('round-trip Financial Ledger', () => {
  it('exports and re-imports without proposing any changes', async () => {
    const buf = await buildWorkbook({
      templateKind: 'FINANCIAL_LEDGER',
      metadata: {
        app: 'ValuVault',
        templateKind: 'FINANCIAL_LEDGER', templateVersion: 'v1',
        caseId: CASE_ID, exportedAt: new Date().toISOString(),
      },
      rows: sampleRows,
    })
    const parsed = await parseWorkbook(buf, {
      expectedCaseId: CASE_ID, expectedTemplateKind: 'FINANCIAL_LEDGER',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // Build an existingById map that MATCHES the exported rows.
    const existingById = new Map(sampleRows.map(r => [r.valueId, {
      valueId:       r.valueId,
      year:          r.year,
      statementType: r.statementType,
      lineItem:      r.lineItem,
      value:         r.value,
      currency:      r.currency,
      isVerified:    r.isVerified,
      isLocked:      r.isLocked,
      origin:        r.origin,
      documentId:    r.documentId,
    } as Record<string, string | null>]))

    const diff = diffRows({
      imported: parsed.rows, existingById,
      identityKey: 'valueId',
      protectionPredicate: e => e.isVerified === 'true' || e.isLocked === 'true',
      protectedFields: ['value', 'currency', 'year', 'statementType', 'lineItem'],
    })
    // Nothing changed on the round trip.
    expect(diff.updates).toBe(0)
    expect(diff.inserts).toBe(0)
    expect(diff.protected).toBe(0)
    expect(diff.unchanged).toBe(2)
  })
})

// ─────────────────────────────────────────────────
// Cross-case guardrail
// ─────────────────────────────────────────────────

describe('parseWorkbook — cross-case guard', () => {
  it('refuses to import a workbook exported from a different case', async () => {
    const buf = await buildWorkbook({
      templateKind: 'FINANCIAL_LEDGER',
      metadata: {
        app: 'ValuVault',
        templateKind: 'FINANCIAL_LEDGER', templateVersion: 'v1',
        caseId: 'case-A', exportedAt: new Date().toISOString(),
      },
      rows: sampleRows,
    })
    const parsed = await parseWorkbook(buf, {
      expectedCaseId: 'case-B', expectedTemplateKind: 'FINANCIAL_LEDGER',
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.some(e => /case-A.*case-B|across cases/i.test(e))).toBe(true)
  })

  it('refuses a workbook whose templateKind does not match the caller expectation', async () => {
    const buf = await buildWorkbook({
      templateKind: 'NORMALIZATION',
      metadata: {
        app: 'ValuVault',
        templateKind: 'NORMALIZATION', templateVersion: 'v1',
        caseId: 'case-A', exportedAt: new Date().toISOString(),
      },
      rows: [],
    })
    const parsed = await parseWorkbook(buf, {
      expectedCaseId: 'case-A', expectedTemplateKind: 'FINANCIAL_LEDGER',
    })
    expect(parsed.ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────
// Rejection of a non-ValuVault workbook
// ─────────────────────────────────────────────────

describe('parseWorkbook — foreign workbook rejection', () => {
  it('rejects a workbook with no metadata sheet', async () => {
    // Build a workbook without any ValuVault metadata by using exceljs directly.
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet 1')
    ws.addRow(['a', 'b']); ws.addRow([1, 2])
    const buf = Buffer.from(await wb.xlsx.writeBuffer())
    const parsed = await parseWorkbook(buf, {
      expectedCaseId: 'case-A', expectedTemplateKind: 'FINANCIAL_LEDGER',
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.some(e => /_valuvault_meta/.test(e))).toBe(true)
  })
})
