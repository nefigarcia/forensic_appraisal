/**
 * RequestItem categories.
 *
 * A closed enum — new categories mean a schema-review conversation, not
 * a free-form UI field. Keeps dashboard tallies + template exports
 * comparable across firms.
 */

export const REQUEST_ITEM_CATEGORIES = [
  'FINANCIAL',   // P&L, GL, trial balances
  'TAX',         // tax returns (federal + state)
  'BANK',        // bank statements, reconciliations
  'LEGAL',       // articles, operating agreements, contracts
  'OPERATIONS',  // customer / vendor lists, KPIs
  'GOVERNANCE',  // board minutes, cap tables, org chart
  'HR',          // payroll, headcount, benefit plans
  'OTHER',
] as const

export type RequestItemCategory = typeof REQUEST_ITEM_CATEGORIES[number]

export function isRequestItemCategory(c: unknown): c is RequestItemCategory {
  return typeof c === 'string' && (REQUEST_ITEM_CATEGORIES as readonly string[]).includes(c)
}

export const REQUEST_ITEM_CATEGORY_LABEL: Record<RequestItemCategory, string> = {
  FINANCIAL:  'Financial',
  TAX:        'Tax',
  BANK:       'Bank',
  LEGAL:      'Legal',
  OPERATIONS: 'Operations',
  GOVERNANCE: 'Governance',
  HR:         'HR / Payroll',
  OTHER:      'Other',
}

export const REQUEST_ITEM_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const
export type RequestItemPriority = typeof REQUEST_ITEM_PRIORITIES[number]

export function isRequestItemPriority(p: unknown): p is RequestItemPriority {
  return typeof p === 'string' && (REQUEST_ITEM_PRIORITIES as readonly string[]).includes(p)
}
