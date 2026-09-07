/**
 * Slice-16 query composer.
 *
 * Turns a validated `FilterSet` (see query-shape.ts) into a Prisma
 * `where` clause for `CaseSearchIndex`. Never emits SQL directly, so
 * there is no injection surface even if a malformed value slips past
 * the validator.
 *
 * Array-valued columns are stored as JSON in MySQL. Prisma exposes
 * `path`-based JSON filters; here we use `array_contains` — a
 * supported Prisma primitive that turns into a JSON_CONTAINS in
 * MySQL.
 */

import { type Prisma } from '@prisma/client'
import {
  ALL_SEARCH_FIELDS,
  isStringSearchField, isNumericSearchField, isDateSearchField,
  isBooleanSearchField, isArraySearchField,
  type FilterSet, type SearchFilter,
} from './query-shape'

const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 200

export interface ComposedQuery {
  where:   Prisma.CaseSearchIndexWhereInput
  orderBy: Prisma.CaseSearchIndexOrderByWithRelationInput
  take:    number
  /** Filter fields that were dropped because they were not whitelisted. */
  dropped: string[]
}

/**
 * Compose a Prisma query from an authorized org + filter set.
 * `authorizedCaseIds`, when provided, further limits the query to a
 * pre-computed set (see `permissions.ts`).
 *
 * Field whitelisting is enforced HERE as well — a filter whose field
 * is not in `ALL_SEARCH_FIELDS` is silently dropped and returned in
 * `dropped[]`. Callers can log the drop.
 */
export function composeSearchQuery(input: {
  organizationId:    string
  authorizedCaseIds?: string[] | null
  filterSet:         FilterSet
}): ComposedQuery {
  const wheres: Prisma.CaseSearchIndexWhereInput[] = []
  const dropped: string[] = []

  // Tenant boundary is applied unconditionally.
  wheres.push({ organizationId: input.organizationId })

  // Optional caseId shortlist — set by the permission resolver.
  if (input.authorizedCaseIds) {
    // A null / undefined authorizedCaseIds means "no engagement gate";
    // an empty array means "no cases at all".
    wheres.push({ caseId: { in: input.authorizedCaseIds } })
  }

  for (const f of input.filterSet.filters ?? []) {
    const clause = composeOne(f, dropped)
    if (clause) wheres.push(clause)
  }

  const take = Math.max(1, Math.min(input.filterSet.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
  const orderBy: Prisma.CaseSearchIndexOrderByWithRelationInput = {
    [input.filterSet.orderBy ?? 'refreshedAt']: input.filterSet.orderDir ?? 'desc',
  }
  return { where: { AND: wheres }, orderBy, take, dropped }
}

function composeOne(f: SearchFilter, dropped: string[]): Prisma.CaseSearchIndexWhereInput | null {
  const inner: any = f.filter
  const field: string = inner?.field
  if (!ALL_SEARCH_FIELDS.includes(field)) {
    dropped.push(field ?? '(missing field)')
    return null
  }

  if (f.kind === 'string' && isStringSearchField(field)) {
    if (inner.op === 'eq')       return { [field]: inner.value } as any
    if (inner.op === 'contains') return { [field]: { contains: String(inner.value) } } as any
    dropped.push(`${field}(op ${inner.op})`); return null
  }

  if (f.kind === 'numeric' && isNumericSearchField(field)) {
    if (inner.op === 'eq')  return { [field]: inner.value } as any
    if (inner.op === 'gte') return { [field]: { gte: inner.value } } as any
    if (inner.op === 'lte') return { [field]: { lte: inner.value } } as any
    if (inner.op === 'between') {
      return { [field]: { gte: inner.min, lte: inner.max } } as any
    }
    dropped.push(`${field}(op ${inner.op})`); return null
  }

  if (f.kind === 'date' && isDateSearchField(field)) {
    const parse = (s: string) => new Date(s)
    if (inner.op === 'eq')  return { [field]: parse(inner.value) } as any
    if (inner.op === 'gte') return { [field]: { gte: parse(inner.value) } } as any
    if (inner.op === 'lte') return { [field]: { lte: parse(inner.value) } } as any
    if (inner.op === 'between') {
      return { [field]: { gte: parse(inner.min), lte: parse(inner.max) } } as any
    }
    dropped.push(`${field}(op ${inner.op})`); return null
  }

  if (f.kind === 'boolean' && isBooleanSearchField(field)) {
    if (inner.op === 'eq') return { [field]: inner.value } as any
    dropped.push(`${field}(op ${inner.op})`); return null
  }

  if (f.kind === 'array' && isArraySearchField(field)) {
    // JSON `array_contains` — Prisma resolves this to JSON_CONTAINS in MySQL.
    if (inner.op === 'includes') {
      return { [field]: { array_contains: String(inner.value) } } as any
    }
    if (inner.op === 'anyOf' && Array.isArray(inner.values)) {
      return {
        OR: inner.values.map((v: string) => ({
          [field]: { array_contains: v } as any,
        })),
      } as any
    }
    dropped.push(`${field}(op ${inner.op})`); return null
  }

  dropped.push(`${field}(kind ${f.kind})`)
  return null
}
