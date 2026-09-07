/**
 * Excel template schemas.
 *
 * A template is defined by its `kind` (what the workbook represents)
 * and its `version` (the column shape at export time). Bumping the
 * version means:
 *   - existing exports are still importable (importer must switch on
 *     version and translate),
 *   - the metadata block written into the workbook records the
 *     version so an import knows which parser to use.
 *
 * Every template exposes:
 *   - `kind`
 *   - `version`
 *   - `sheetName`             the tab the data lives on
 *   - `columns`               ordered column defs (header + type)
 *   - `metadataDefinedName`   Excel defined-name that carries JSON
 *                              metadata (see workbook-metadata.ts)
 */

export const TEMPLATE_KINDS = [
  'FINANCIAL_LEDGER',
  'NORMALIZATION',
  'VALUATION',
  'TIE_OUTS',
] as const

export type TemplateKind = typeof TEMPLATE_KINDS[number]

export function isTemplateKind(k: unknown): k is TemplateKind {
  return typeof k === 'string' && (TEMPLATE_KINDS as readonly string[]).includes(k)
}

export type ColumnType =
  | 'string'
  | 'money'     // Decimal(19,4)
  | 'rate'      // Decimal(9,6)
  | 'integer'
  | 'year'      // 'TTM' | '2024' | ...
  | 'boolean'
  | 'date'

export interface ColumnDef {
  key:      string        // stable id — never translated
  header:   string        // human header shown in the spreadsheet
  type:     ColumnType
  required: boolean
  /** When true, the importer treats a change to this column as a
   *  destructive edit — bare re-imports refuse unless the reviewer
   *  explicitly overrides on a per-row basis. */
  protectedIfVerified?: boolean
}

export interface TemplateSchema {
  kind:                TemplateKind
  version:             string           // 'v1', 'v2'
  sheetName:           string
  metadataDefinedName: string           // 'valuvault_metadata'
  columns:             readonly ColumnDef[]
}

// ─────────────────────────────────────────────────
// Financial Ledger v1 — the FinancialValue export
// ─────────────────────────────────────────────────
export const FINANCIAL_LEDGER_V1: TemplateSchema = {
  kind:                'FINANCIAL_LEDGER',
  version:             'v1',
  sheetName:           'Financial Ledger',
  metadataDefinedName: 'valuvault_metadata',
  columns: [
    { key: 'valueId',       header: 'ID',              type: 'string',  required: true  },
    { key: 'year',          header: 'Year',            type: 'year',    required: true  },
    { key: 'statementType', header: 'Statement Type',  type: 'string',  required: true  },
    { key: 'lineItem',      header: 'Line Item',       type: 'string',  required: true  },
    { key: 'value',         header: 'Value',           type: 'money',   required: true,
      protectedIfVerified: true },
    { key: 'currency',      header: 'Currency',        type: 'string',  required: true  },
    { key: 'isVerified',    header: 'Verified',        type: 'boolean', required: true  },
    { key: 'isLocked',      header: 'Locked',          type: 'boolean', required: true  },
    { key: 'origin',        header: 'Origin',          type: 'string',  required: true  },
    { key: 'documentId',    header: 'Source Document', type: 'string',  required: false },
  ],
}

// ─────────────────────────────────────────────────
// Normalization Schedule v1 — the AddBack export
// ─────────────────────────────────────────────────
export const NORMALIZATION_V1: TemplateSchema = {
  kind:                'NORMALIZATION',
  version:             'v1',
  sheetName:           'Normalization Schedule',
  metadataDefinedName: 'valuvault_metadata',
  columns: [
    { key: 'addBackId',    header: 'ID',          type: 'string',  required: true  },
    { key: 'category',     header: 'Category',    type: 'string',  required: true  },
    { key: 'description',  header: 'Description', type: 'string',  required: true  },
    { key: 'year2',        header: 'Year -2',     type: 'money',   required: false, protectedIfVerified: true },
    { key: 'year1',        header: 'Year -1',     type: 'money',   required: false, protectedIfVerified: true },
    { key: 'ttm',          header: 'TTM',         type: 'money',   required: false, protectedIfVerified: true },
    { key: 'direction',    header: 'Direction',   type: 'string',  required: true  },
    { key: 'recurring',    header: 'Recurring',   type: 'string',  required: true  },
    { key: 'taxTreatment', header: 'Tax',         type: 'string',  required: false },
    { key: 'status',       header: 'Status',      type: 'string',  required: true  },
    { key: 'rationale',    header: 'Rationale',   type: 'string',  required: false },
  ],
}

// ─────────────────────────────────────────────────
// Valuation Calculations v1 — Slice-13 approaches + reconciliations
// ─────────────────────────────────────────────────
export const VALUATION_V1: TemplateSchema = {
  kind:                'VALUATION',
  version:             'v1',
  sheetName:           'Valuation Calculations',
  metadataDefinedName: 'valuvault_metadata',
  columns: [
    { key: 'scenarioKey',    header: 'Scenario',        type: 'string', required: true  },
    { key: 'approachKind',   header: 'Approach',        type: 'string', required: true  },
    { key: 'label',          header: 'Label',           type: 'string', required: false },
    { key: 'weight',         header: 'Weight',          type: 'rate',   required: true  },
    { key: 'isIncluded',     header: 'Included',        type: 'boolean',required: true  },
    { key: 'indicatedValue', header: 'Indicated Value', type: 'money',  required: false },
    { key: 'computedAt',     header: 'Computed',        type: 'date',   required: false },
    { key: 'note',           header: 'Note',            type: 'string', required: false },
  ],
}

// ─────────────────────────────────────────────────
// Tie-Outs v1 — Slice-9 TieOut + TieOutItem export
// ─────────────────────────────────────────────────
export const TIE_OUTS_V1: TemplateSchema = {
  kind:                'TIE_OUTS',
  version:             'v1',
  sheetName:           'Tie-Outs',
  metadataDefinedName: 'valuvault_metadata',
  columns: [
    { key: 'tieOutId',        header: 'Tie-Out ID',      type: 'string', required: true  },
    { key: 'concept',         header: 'Concept',         type: 'string', required: true  },
    { key: 'year',            header: 'Year',            type: 'year',   required: true  },
    { key: 'sourceLabel',     header: 'Source',          type: 'string', required: true  },
    { key: 'value',           header: 'Value',           type: 'money',  required: true  },
    { key: 'status',          header: 'Status',          type: 'string', required: true  },
    { key: 'toleranceAbsolute',header: 'Tolerance Abs',  type: 'money',  required: false },
    { key: 'tolerancePercent',header: 'Tolerance %',     type: 'rate',   required: false },
    { key: 'maxDifference',   header: 'Max Difference',  type: 'money',  required: false },
    { key: 'resolutionNote',  header: 'Resolution Note', type: 'string', required: false },
  ],
}

// ─────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────
export const TEMPLATE_REGISTRY: Record<TemplateKind, TemplateSchema> = {
  FINANCIAL_LEDGER: FINANCIAL_LEDGER_V1,
  NORMALIZATION:    NORMALIZATION_V1,
  VALUATION:        VALUATION_V1,
  TIE_OUTS:         TIE_OUTS_V1,
}

export function getTemplate(kind: TemplateKind, version: string): TemplateSchema | null {
  const t = TEMPLATE_REGISTRY[kind]
  if (!t) return null
  if (t.version !== version) return null
  return t
}
