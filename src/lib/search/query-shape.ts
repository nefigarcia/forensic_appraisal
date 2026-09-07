/**
 * The Slice-16 case-search filter DSL.
 *
 * This is a CLOSED whitelist of the fields the search accepts. The AI
 * planner is instructed to only produce fields from this list; the
 * server-side validator drops anything else. There is no free-form
 * SQL, no user-supplied WHERE clauses, and no way to smuggle a filter
 * that references confidential data.
 *
 * Any change to this file:
 *   - schema.prisma should carry an @@index on the org+field pair
 *     (the load-bearing indexes are already declared for the
 *     Slice-16 fields).
 *   - the AI prompt in report/search planner should be updated so it
 *     doesn't blindly attempt older filter names.
 *   - the validator (`validateFilterSet`) must be updated.
 */

// ─────────────────────────────────────────────────
// Filter atoms
// ─────────────────────────────────────────────────

export type StringOp     = 'eq' | 'contains'
export type NumericOp    = 'eq' | 'gte' | 'lte' | 'between'
export type DateOp       = 'eq' | 'gte' | 'lte' | 'between'
export type BooleanOp    = 'eq'
export type ArrayIncludes = 'includes' | 'anyOf'

export interface StringFilter {
  field:  StringSearchField
  op:     StringOp
  value:  string
}

export interface NumericFilter {
  field:  NumericSearchField
  op:     NumericOp
  value?: string       // decimal string for 'eq' | 'gte' | 'lte'
  min?:   string       // for 'between'
  max?:   string       // for 'between'
}

export interface DateFilter {
  field:  DateSearchField
  op:     DateOp
  value?: string       // ISO date
  min?:   string
  max?:   string
}

export interface BooleanFilter {
  field:  BooleanSearchField
  op:     'eq'
  value:  boolean
}

export interface ArrayFilter {
  field:  ArraySearchField
  op:     ArrayIncludes
  value?: string
  values?: string[]
}

export type SearchFilter =
  | { kind: 'string';  filter: StringFilter }
  | { kind: 'numeric'; filter: NumericFilter }
  | { kind: 'date';    filter: DateFilter }
  | { kind: 'boolean'; filter: BooleanFilter }
  | { kind: 'array';   filter: ArrayFilter }

export interface FilterSet {
  filters:      SearchFilter[]
  limit?:       number    // default 50, capped at MAX_LIMIT server-side
  orderBy?:     'valuationDate' | 'refreshedAt' | 'caseName'
  orderDir?:    'asc' | 'desc'
}

// ─────────────────────────────────────────────────
// Whitelisted fields
// ─────────────────────────────────────────────────
// String fields
export const STRING_SEARCH_FIELDS = [
  'caseName', 'clientName', 'engagementType',
  'caseStatus', 'reportStatus',
  'subjectState', 'subjectCity', 'subjectCountry',
  'naicsCode', 'sicCode', 'industryLabel',
] as const
export type StringSearchField = typeof STRING_SEARCH_FIELDS[number]

// Numeric fields (money / percent)
export const NUMERIC_SEARCH_FIELDS = [
  'approvedDlocPercent', 'approvedDlomPercent',
  'concludedEnterpriseValue', 'concludedEquityValue', 'concludedOwnershipValue',
  'documentCount',
] as const
export type NumericSearchField = typeof NUMERIC_SEARCH_FIELDS[number]

// Date fields
export const DATE_SEARCH_FIELDS = [
  'valuationDate', 'reportDueDate', 'reportFinalizedAt', 'refreshedAt',
] as const
export type DateSearchField = typeof DATE_SEARCH_FIELDS[number]

// Boolean fields
export const BOOLEAN_SEARCH_FIELDS = [
  'hasRelatedPartyAddBack',
] as const
export type BooleanSearchField = typeof BOOLEAN_SEARCH_FIELDS[number]

// Array-of-strings JSON fields (methodsApplied, approvedAddBackCategories, approvedAssumptions)
export const ARRAY_SEARCH_FIELDS = [
  // Slice-13 approach kinds e.g. INCOME_DCF
  'methodsApplied',
  // Slice-10 add-back categories e.g. OWNER_COMP
  'approvedAddBackCategoryKeys',
  // Slice-13 assumption keys e.g. wacc.riskFreeRate
  'approvedAssumptionKeys',
] as const
export type ArraySearchField = typeof ARRAY_SEARCH_FIELDS[number]

// ─────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────

export function isStringSearchField(f: unknown): f is StringSearchField {
  return typeof f === 'string' && (STRING_SEARCH_FIELDS as readonly string[]).includes(f)
}
export function isNumericSearchField(f: unknown): f is NumericSearchField {
  return typeof f === 'string' && (NUMERIC_SEARCH_FIELDS as readonly string[]).includes(f)
}
export function isDateSearchField(f: unknown): f is DateSearchField {
  return typeof f === 'string' && (DATE_SEARCH_FIELDS as readonly string[]).includes(f)
}
export function isBooleanSearchField(f: unknown): f is BooleanSearchField {
  return typeof f === 'string' && (BOOLEAN_SEARCH_FIELDS as readonly string[]).includes(f)
}
export function isArraySearchField(f: unknown): f is ArraySearchField {
  return typeof f === 'string' && (ARRAY_SEARCH_FIELDS as readonly string[]).includes(f)
}

// Global list — every whitelisted field the AI planner may reference.
export const ALL_SEARCH_FIELDS: readonly string[] = [
  ...STRING_SEARCH_FIELDS,
  ...NUMERIC_SEARCH_FIELDS,
  ...DATE_SEARCH_FIELDS,
  ...BOOLEAN_SEARCH_FIELDS,
  ...ARRAY_SEARCH_FIELDS,
]

// ─────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────

export interface ValidationResult {
  ok:      boolean
  reasons: string[]
}

const MAX_LIMIT = 200
const MAX_STRING_LEN = 200

/**
 * Cheap defense-in-depth check that fires BEFORE the query composer.
 * Any field not in the whitelist, any obvious type mismatch, or any
 * over-long value is rejected here. The composer additionally
 * ignores unknown fields so a mutation between validation and
 * execution cannot leak.
 */
export function validateFilterSet(fs: unknown): ValidationResult {
  const reasons: string[] = []
  if (!fs || typeof fs !== 'object') return { ok: false, reasons: ['filter set is not an object'] }
  const asFs = fs as FilterSet
  if (!Array.isArray(asFs.filters)) return { ok: false, reasons: ['filters is not an array'] }

  for (let i = 0; i < asFs.filters.length; i++) {
    const f = asFs.filters[i]
    const label = `filters[${i}]`
    if (!f || typeof f !== 'object') { reasons.push(`${label} is not an object`); continue }
    const fkind = (f as any).kind
    const inner = (f as any).filter
    if (!inner || typeof inner !== 'object') { reasons.push(`${label}.filter missing`); continue }
    if (typeof inner.field !== 'string')     { reasons.push(`${label}.field must be a string`); continue }

    if (fkind === 'string' && !isStringSearchField(inner.field)) {
      reasons.push(`${label} field "${inner.field}" is not a whitelisted string field`)
      continue
    }
    if (fkind === 'numeric' && !isNumericSearchField(inner.field)) {
      reasons.push(`${label} field "${inner.field}" is not a whitelisted numeric field`)
      continue
    }
    if (fkind === 'date' && !isDateSearchField(inner.field)) {
      reasons.push(`${label} field "${inner.field}" is not a whitelisted date field`)
      continue
    }
    if (fkind === 'boolean' && !isBooleanSearchField(inner.field)) {
      reasons.push(`${label} field "${inner.field}" is not a whitelisted boolean field`)
      continue
    }
    if (fkind === 'array' && !isArraySearchField(inner.field)) {
      reasons.push(`${label} field "${inner.field}" is not a whitelisted array field`)
      continue
    }
    if (!['string', 'numeric', 'date', 'boolean', 'array'].includes(fkind)) {
      reasons.push(`${label}.kind "${fkind}" is unknown`)
      continue
    }

    // Op validation — reject operators outside the kind's allowed set.
    const ALLOWED_OPS: Record<string, readonly string[]> = {
      string:  ['eq', 'contains'],
      numeric: ['eq', 'gte', 'lte', 'between'],
      date:    ['eq', 'gte', 'lte', 'between'],
      boolean: ['eq'],
      array:   ['includes', 'anyOf'],
    }
    if (!ALLOWED_OPS[fkind]!.includes(inner.op)) {
      reasons.push(`${label}.op "${inner.op}" is not valid for kind "${fkind}"`)
      continue
    }

    // Value-shape checks.
    if (fkind === 'string') {
      if (typeof inner.value !== 'string' || inner.value.length === 0) reasons.push(`${label}.value must be a non-empty string`)
      else if (inner.value.length > MAX_STRING_LEN) reasons.push(`${label}.value exceeds ${MAX_STRING_LEN} chars`)
    }
    if (fkind === 'numeric') {
      const nums = inner.op === 'between'
        ? [inner.min, inner.max]
        : [inner.value]
      for (const n of nums) {
        if (n === undefined || n === null) { reasons.push(`${label} numeric value missing`); break }
        if (typeof n !== 'string' || !/^-?\d+(\.\d+)?$/.test(n)) {
          reasons.push(`${label} numeric value "${n}" is not a decimal string`)
          break
        }
      }
    }
    if (fkind === 'date') {
      const ds = inner.op === 'between' ? [inner.min, inner.max] : [inner.value]
      for (const d of ds) {
        if (d === undefined || d === null) { reasons.push(`${label} date value missing`); break }
        if (typeof d !== 'string' || Number.isNaN(Date.parse(d))) {
          reasons.push(`${label} date value "${d}" is not parseable`)
          break
        }
      }
    }
    if (fkind === 'boolean') {
      if (typeof inner.value !== 'boolean') reasons.push(`${label} boolean value must be true/false`)
    }
    if (fkind === 'array') {
      if (inner.op === 'includes') {
        if (typeof inner.value !== 'string') reasons.push(`${label} array.includes value must be a string`)
      } else if (inner.op === 'anyOf') {
        if (!Array.isArray(inner.values) || inner.values.length === 0) reasons.push(`${label} array.anyOf values must be a non-empty string[]`)
        else if (inner.values.some((v: unknown) => typeof v !== 'string')) reasons.push(`${label} array.anyOf must be all strings`)
      } else {
        reasons.push(`${label} array.op "${inner.op}" is unknown`)
      }
    }
  }

  if (asFs.limit != null) {
    if (typeof asFs.limit !== 'number' || asFs.limit <= 0 || asFs.limit > MAX_LIMIT) {
      reasons.push(`limit must be 1..${MAX_LIMIT}`)
    }
  }
  if (asFs.orderBy != null && !['valuationDate', 'refreshedAt', 'caseName'].includes(asFs.orderBy)) {
    reasons.push(`orderBy "${asFs.orderBy}" is not allowed`)
  }
  if (asFs.orderDir != null && !['asc', 'desc'].includes(asFs.orderDir)) {
    reasons.push(`orderDir "${asFs.orderDir}" is not allowed`)
  }

  return { ok: reasons.length === 0, reasons }
}
