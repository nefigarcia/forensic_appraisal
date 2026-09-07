/**
 * Excel workbook import.
 *
 * Pipeline:
 *   1. Read the hidden `_valuvault_meta` sheet, decode the metadata.
 *   2. Verify the caller-supplied caseId matches the metadata caseId
 *      (defense against cross-case imports).
 *   3. Look up the template schema by (kind, version). Unknown pair →
 *      hard failure — the parser does NOT guess.
 *   4. Verify the header row against the schema. Missing columns →
 *      hard failure. Extra columns → warning.
 *   5. Parse rows into a normalized `ImportedRow` shape. Type errors
 *      (money that isn't a number, missing required cell) → warning.
 *   6. Return `ImportResult` with rows + errors + warnings. The
 *      *caller* (server action) does the DB diff and applies changes
 *      only after human confirmation.
 *
 * NO row is written to the DB here. This module is pure parsing +
 * validation.
 */

import ExcelJS from 'exceljs'
import { createHash } from 'crypto'
import {
  METADATA_SHEET_NAME, METADATA_CELL, decodeMetadata,
  type WorkbookMetadata,
} from './workbook-metadata'
import {
  getTemplate, isTemplateKind,
  type TemplateSchema, type ColumnDef, type TemplateKind,
} from './template-schema'

export interface ImportedRow {
  rowNumber: number                            // 1-based excel row (2+ for data)
  values:    Record<string, string | null>     // raw cell strings by column key
}

export interface ImportSuccess {
  ok:            true
  metadata:      WorkbookMetadata
  template:      TemplateSchema
  rows:          ImportedRow[]
  warnings:      string[]
  fileSha256:    string
}

export interface ImportFailure {
  ok:            false
  errors:        string[]
  warnings:      string[]
  fileSha256:    string
  metadata?:     WorkbookMetadata
}

export type ImportResult = ImportSuccess | ImportFailure

export interface ImportOptions {
  expectedCaseId:      string
  expectedTemplateKind?: TemplateKind         // when set, workbook kind must match
}

export async function parseWorkbook(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  opts:   ImportOptions,
): Promise<ImportResult> {
  const errors:   string[] = []
  const warnings: string[] = []
  const fileSha256 = sha256Hex(buffer)

  const wb = new ExcelJS.Workbook()
  try {
    // ExcelJS accepts a Buffer or ArrayBuffer for xlsx.load.
    // Cast handles the drift between Node's Buffer<ArrayBufferLike>
    // (from @types/node ≥ 22) and ExcelJS's Buffer type.
    const asBuffer =
      buffer instanceof ArrayBuffer ? Buffer.from(buffer) :
      buffer instanceof Uint8Array  ? Buffer.from(buffer) :
      buffer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (wb.xlsx as any).load(asBuffer)
  } catch (e) {
    return {
      ok: false, fileSha256,
      errors: ['Failed to parse workbook — file may be corrupt or not an XLSX.'],
      warnings,
    }
  }

  // ── Metadata block ───────────────────────────────────────────────
  const metaSheet = wb.getWorksheet(METADATA_SHEET_NAME)
  if (!metaSheet) {
    errors.push(
      `Workbook does not contain the "${METADATA_SHEET_NAME}" sheet. ` +
      `Only ValuVault-exported workbooks can be imported here.`,
    )
    return { ok: false, fileSha256, errors, warnings }
  }
  const metadata = decodeMetadata(metaSheet.getCell(METADATA_CELL).value?.toString())
  if (!metadata) {
    errors.push('Workbook metadata is missing or malformed.')
    return { ok: false, fileSha256, errors, warnings }
  }

  // ── Case identity ─────────────────────────────────────────────────
  if (metadata.caseId !== opts.expectedCaseId) {
    errors.push(
      `Workbook was exported from case "${metadata.caseId}" but this ` +
      `import is targeting case "${opts.expectedCaseId}". Refusing to ` +
      `import across cases.`,
    )
    return { ok: false, fileSha256, errors, warnings, metadata }
  }

  // ── Template lookup ───────────────────────────────────────────────
  if (opts.expectedTemplateKind && metadata.templateKind !== opts.expectedTemplateKind) {
    errors.push(
      `Workbook template is "${metadata.templateKind}" but the import ` +
      `flow expected "${opts.expectedTemplateKind}".`,
    )
    return { ok: false, fileSha256, errors, warnings, metadata }
  }
  if (!isTemplateKind(metadata.templateKind)) {
    errors.push(`Unknown template kind: ${metadata.templateKind}`)
    return { ok: false, fileSha256, errors, warnings, metadata }
  }
  const template = getTemplate(metadata.templateKind as TemplateKind, metadata.templateVersion)
  if (!template) {
    errors.push(
      `Unsupported template version: ${metadata.templateKind}@${metadata.templateVersion}. ` +
      `Re-export from ValuVault to use the current template.`,
    )
    return { ok: false, fileSha256, errors, warnings, metadata }
  }

  // ── Data sheet + header row ───────────────────────────────────────
  const ws = wb.getWorksheet(template.sheetName)
  if (!ws) {
    errors.push(`Workbook does not contain the "${template.sheetName}" sheet.`)
    return { ok: false, fileSha256, errors, warnings, metadata }
  }
  const headerRow = ws.getRow(1)
  const headers: string[] = []
  headerRow.eachCell({ includeEmpty: true }, cell => headers.push(String(cell.value ?? '').trim()))
  const missing = template.columns.filter(c => !headers.includes(c.header)).map(c => c.header)
  if (missing.length > 0) {
    errors.push(`Workbook is missing required columns: ${missing.join(', ')}`)
    return { ok: false, fileSha256, errors, warnings, metadata }
  }
  const extras = headers.filter(h => h && !template.columns.some(c => c.header === h))
  if (extras.length > 0) warnings.push(`Ignoring unexpected columns: ${extras.join(', ')}`)

  // Map header string → column def.
  const headerIndex = new Map<string, ColumnDef>()
  for (const c of template.columns) headerIndex.set(c.header, c)

  // ── Row parse ─────────────────────────────────────────────────────
  const rows: ImportedRow[] = []
  const lastRow = ws.actualRowCount
  for (let r = 2; r <= lastRow; r++) {
    const excelRow = ws.getRow(r)
    const values: Record<string, string | null> = {}
    let hasAny = false
    for (let c = 1; c <= headers.length; c++) {
      const header = headers[c - 1]!
      const col = headerIndex.get(header)
      if (!col) continue
      const raw = excelRow.getCell(c).value
      const asStr = coerceToString(raw)
      values[col.key] = asStr
      if (asStr !== null && asStr.length > 0) hasAny = true
    }
    if (!hasAny) continue
    const missingReq = template.columns
      .filter(c => c.required && (values[c.key] === null || values[c.key] === ''))
      .map(c => c.header)
    if (missingReq.length > 0) {
      warnings.push(`Row ${r}: missing required column(s) ${missingReq.join(', ')} — skipped`)
      continue
    }
    for (const c of template.columns) {
      if (!validateValue(values[c.key], c)) {
        warnings.push(`Row ${r}: value in "${c.header}" does not match type ${c.type} — skipped`)
        // Mark the row as skipped so the DB writer never sees it.
        values.__skip__ = 'true'
        break
      }
    }
    if (values.__skip__) continue
    rows.push({ rowNumber: r, values })
  }

  return { ok: true, fileSha256, metadata, template, rows, warnings }
}

// ─────────────────────────────────────────────────
// Diff engine
// ─────────────────────────────────────────────────

export interface DiffProposal {
  rowKey:          string    // stable id (e.g. valueId, addBackId)
  action:          'INSERT' | 'UPDATE' | 'UNCHANGED' | 'PROTECTED'
  proposedValues:  Record<string, string | null>
  existingValues?: Record<string, string | null>
  changedFields:   string[]        // keys where existing !== proposed
  protectedFields: string[]        // fields changed on a verified/locked row
  reasons:         string[]        // 'row is locked', 'row is verified', ...
}

export interface DiffSummary {
  inserts:      number
  updates:      number
  unchanged:    number
  protected:    number
  proposals:    DiffProposal[]
}

/**
 * Compute a diff between the imported rows and the current DB state.
 *
 * `protectionPredicate(existing)` returns `true` when a row must be
 * treated as protected — its values may not be silently overwritten.
 * For the financial-ledger template, "protected" means the DB row is
 * verified OR locked.
 *
 * `identityKey` names the column carrying the row's stable id (e.g.
 * `valueId`). When the id is empty the row is treated as an INSERT.
 */
export function diffRows(input: {
  imported:            ImportedRow[]
  existingById:        Map<string, Record<string, string | null>>
  identityKey:         string
  protectionPredicate: (existing: Record<string, string | null>) => boolean
  protectedFields:     readonly string[]
}): DiffSummary {
  const proposals: DiffProposal[] = []
  for (const row of input.imported) {
    const idRaw = row.values[input.identityKey]
    const id = idRaw ? String(idRaw) : ''

    if (!id) {
      proposals.push({
        rowKey:         `row-${row.rowNumber}`,
        action:         'INSERT',
        proposedValues: row.values,
        changedFields:  Object.keys(row.values),
        protectedFields:[],
        reasons:        [],
      })
      continue
    }

    const existing = input.existingById.get(id)
    if (!existing) {
      proposals.push({
        rowKey:         id,
        action:         'INSERT',
        proposedValues: row.values,
        changedFields:  Object.keys(row.values),
        protectedFields:[],
        reasons:        [],
      })
      continue
    }

    const changedFields: string[] = []
    for (const [k, v] of Object.entries(row.values)) {
      if (k === '__skip__') continue
      const eq = normalizeCompare(existing[k]) === normalizeCompare(v)
      if (!eq) changedFields.push(k)
    }

    if (changedFields.length === 0) {
      proposals.push({
        rowKey: id, action: 'UNCHANGED', proposedValues: row.values,
        existingValues: existing, changedFields: [], protectedFields: [], reasons: [],
      })
      continue
    }

    const isProtected = input.protectionPredicate(existing)
    const touchesProtected = changedFields.some(f => input.protectedFields.includes(f))
    if (isProtected && touchesProtected) {
      proposals.push({
        rowKey: id, action: 'PROTECTED',
        proposedValues: row.values, existingValues: existing,
        changedFields,
        protectedFields: changedFields.filter(f => input.protectedFields.includes(f)),
        reasons: ['row is verified or locked in ValuVault; refusing silent overwrite'],
      })
      continue
    }

    proposals.push({
      rowKey: id, action: 'UPDATE',
      proposedValues: row.values, existingValues: existing,
      changedFields, protectedFields: [], reasons: [],
    })
  }

  return {
    inserts:   proposals.filter(p => p.action === 'INSERT').length,
    updates:   proposals.filter(p => p.action === 'UPDATE').length,
    unchanged: proposals.filter(p => p.action === 'UNCHANGED').length,
    protected: proposals.filter(p => p.action === 'PROTECTED').length,
    proposals,
  }
}

// ─────────────────────────────────────────────────
// Cell coercion helpers
// ─────────────────────────────────────────────────

function coerceToString(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string')  return v.trim() === '' ? null : v.trim()
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number')  return String(v)
  if (v instanceof Date)      return v.toISOString().slice(0, 10)
  // ExcelJS cell rich-text / formula wrappers
  if (typeof v === 'object' && v !== null) {
    if ('result' in v && (v as any).result !== undefined) return coerceToString((v as any).result)
    if ('richText' in v && Array.isArray((v as any).richText)) {
      return (v as any).richText.map((t: any) => t.text ?? '').join('').trim() || null
    }
    if ('text' in v && typeof (v as any).text === 'string') return coerceToString((v as any).text)
    if ('value' in v && (v as any).value !== undefined) return coerceToString((v as any).value)
  }
  return String(v)
}

function validateValue(raw: string | null, col: ColumnDef): boolean {
  if (raw === null) return !col.required
  switch (col.type) {
    case 'money':
    case 'rate': {
      // Accept decimal-safe strings: /^-?\d+(\.\d+)?$/, with optional
      // thousands commas stripped. Reject other characters — a corrupt
      // cell should not silently overwrite anything.
      const cleaned = raw.replace(/,/g, '').trim()
      return /^-?\d+(\.\d+)?$/.test(cleaned)
    }
    case 'integer':
      return /^-?\d+$/.test(raw.trim())
    case 'boolean': {
      const norm = raw.toLowerCase()
      return norm === 'true' || norm === 'false' || norm === '1' || norm === '0'
    }
    case 'year':
      return /^(TTM|LFY|\d{4})$/.test(raw.trim())
    case 'date':
      return !Number.isNaN(Date.parse(raw))
    case 'string':
    default:
      return true
  }
}

/** For diff comparison — normalize whitespace + case-fold booleans. */
export function normalizeCompare(v: string | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  if (s === '')       return ''
  const l = s.toLowerCase()
  if (l === 'true'  || l === '1') return 'true'
  if (l === 'false' || l === '0') return 'false'
  // Trim thousands + normalize decimals so "1000" == "1000.0000".
  if (/^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ''))) {
    const n = s.replace(/,/g, '')
    if (n.includes('.')) return n.replace(/0+$/, '').replace(/\.$/, '')
    return n
  }
  return s
}

// ─────────────────────────────────────────────────
// SHA-256 helper
// ─────────────────────────────────────────────────
function sha256Hex(buf: Buffer | Uint8Array | ArrayBuffer): string {
  const asBuffer =
    buf instanceof ArrayBuffer ? Buffer.from(buf) :
    buf instanceof Uint8Array  ? Buffer.from(buf) :
    buf
  return createHash('sha256').update(asBuffer).digest('hex')
}
