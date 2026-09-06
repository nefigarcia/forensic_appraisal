/**
 * Excel workbook export.
 *
 * The functions here compose a workbook for a specific template.
 * Every workbook contains two sheets:
 *   1. The data sheet named after the template (`sheetName`),
 *      pre-populated with header + rows.
 *   2. A hidden `_valuvault_meta` sheet carrying the metadata JSON
 *      the importer reads to verify the round trip.
 *
 * All monetary values are written as strings so decimal.js precision
 * is not silently truncated by Excel's float representation. On
 * import, values are re-parsed to Decimal via `money()`.
 */

import ExcelJS from 'exceljs'
import {
  METADATA_SHEET_NAME, METADATA_CELL, encodeMetadata,
  type WorkbookMetadata,
} from './workbook-metadata'
import {
  TEMPLATE_REGISTRY, type TemplateKind, type ColumnDef,
} from './template-schema'

export interface ExportInput {
  templateKind: TemplateKind
  metadata:     WorkbookMetadata
  rows:         Array<Record<string, unknown>>
}

export async function buildWorkbook(input: ExportInput): Promise<Buffer> {
  const template = TEMPLATE_REGISTRY[input.templateKind]
  if (!template) throw new Error(`Unknown template kind: ${input.templateKind}`)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'ValuVault'
  wb.created = new Date()

  // ── Data sheet ─────────────────────────────────────────────────
  const ws = wb.addWorksheet(template.sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  ws.columns = template.columns.map(c => ({
    key:    c.key,
    header: c.header,
    width:  Math.max(12, c.header.length + 4),
  }))
  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true }
  headerRow.commit()

  for (const row of input.rows) {
    const shaped: Record<string, unknown> = {}
    for (const col of template.columns) {
      shaped[col.key] = coerceForExcel(row[col.key], col)
    }
    ws.addRow(shaped)
  }

  // ── Hidden metadata sheet ──────────────────────────────────────
  const metaSheet = wb.addWorksheet(METADATA_SHEET_NAME)
  metaSheet.state = 'hidden'
  metaSheet.getCell(METADATA_CELL).value = encodeMetadata(input.metadata)

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

/**
 * Coerce values for Excel writing. Monetary and rate values are
 * written as strings (see file header). Booleans go through as-is.
 * `null` / `undefined` become empty cells.
 */
function coerceForExcel(v: unknown, col: ColumnDef): unknown {
  if (v === null || v === undefined) return null
  switch (col.type) {
    case 'money':
    case 'rate':
      // Prisma.Decimal has `.toString()`; a JS number becomes its
      // canonical string form.
      if (typeof v === 'object' && v !== null && typeof (v as any).toString === 'function') {
        return (v as { toString(): string }).toString()
      }
      return String(v)
    case 'boolean':
      return typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true'
    case 'integer':
      return typeof v === 'number' ? v : parseInt(String(v), 10)
    case 'date':
      if (v instanceof Date) return v.toISOString().slice(0, 10)
      return String(v)
    case 'year':
    case 'string':
    default:
      return String(v)
  }
}
