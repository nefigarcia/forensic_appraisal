/**
 * Workbook-metadata block.
 *
 * Every ValuVault-exported workbook contains a hidden metadata sheet
 * named `_valuvault_meta` with a small JSON blob:
 *
 *   {
 *     "app":              "ValuVault",
 *     "templateKind":     "FINANCIAL_LEDGER",
 *     "templateVersion":  "v1",
 *     "caseId":           "cuid...",
 *     "caseName":         "…",
 *     "organizationId":   "cuid...",
 *     "exportedAt":       "2026-…"
 *   }
 *
 * The import path reads this block BEFORE touching any row. A missing
 * or malformed block, wrong caseId, or unknown templateKind/version
 * causes a hard failure — the importer never falls back to shape
 * guessing.
 *
 * We use a hidden worksheet (not a defined name) because `exceljs`
 * writes defined names inconsistently across Excel versions; hidden
 * sheets round-trip losslessly.
 */

export const METADATA_SHEET_NAME = '_valuvault_meta'
export const METADATA_CELL       = 'A1'

export interface WorkbookMetadata {
  app:              'ValuVault'
  templateKind:     string
  templateVersion:  string
  caseId:           string
  caseName?:        string
  organizationId?:  string
  exportedAt:       string   // ISO
}

export function encodeMetadata(m: WorkbookMetadata): string {
  return JSON.stringify(m)
}

export function decodeMetadata(raw: unknown): WorkbookMetadata | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const rec = parsed as Record<string, unknown>
  if (rec.app !== 'ValuVault')                 return null
  if (typeof rec.templateKind    !== 'string') return null
  if (typeof rec.templateVersion !== 'string') return null
  if (typeof rec.caseId          !== 'string') return null
  if (typeof rec.exportedAt      !== 'string') return null
  return {
    app:             'ValuVault',
    templateKind:    rec.templateKind,
    templateVersion: rec.templateVersion,
    caseId:          rec.caseId,
    caseName:        typeof rec.caseName === 'string' ? rec.caseName : undefined,
    organizationId:  typeof rec.organizationId === 'string' ? rec.organizationId : undefined,
    exportedAt:      rec.exportedAt,
  }
}
