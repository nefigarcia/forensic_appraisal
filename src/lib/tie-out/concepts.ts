/**
 * Concept catalog for the tie-out engine.
 *
 * A "concept" is a normalized financial fact that shows up in multiple
 * evidence sources (Revenue in the Tax Return + P&L + GL). The classifier
 * maps a raw `FinancialValue.lineItem` string to a Concept when the match
 * is unambiguous. When it isn't, the classifier returns null and the row
 * is skipped — the tie-out engine does NOT invent classifications.
 *
 * Adding a new concept:
 *   1. Add to the `TIE_OUT_CONCEPTS` tuple.
 *   2. Add regex patterns to `CONCEPT_PATTERNS`.
 *   3. Add a default tolerance to `DEFAULT_TOLERANCES`.
 *
 * All three edits live in this file to keep concept additions a one-file
 * change.
 */

import { money, type Money } from '@/lib/money'

// ─────────────────────────────────────────────────
// Concept enum
// ─────────────────────────────────────────────────

export const TIE_OUT_CONCEPTS = [
  'REVENUE',
  'EBITDA',                // aka operating income + D&A + interest
  'NET_INCOME',
  'CASH',
  'ACCOUNTS_RECEIVABLE',
  'ACCOUNTS_PAYABLE',
  'TOTAL_ASSETS',
  'TOTAL_LIABILITIES',
] as const

export type TieOutConcept = typeof TIE_OUT_CONCEPTS[number]

export function isTieOutConcept(v: string): v is TieOutConcept {
  return (TIE_OUT_CONCEPTS as readonly string[]).includes(v)
}

/** Human-facing label for the dashboard. */
export const CONCEPT_LABEL: Record<TieOutConcept, string> = {
  REVENUE:             'Revenue',
  EBITDA:              'EBITDA / Operating Income',
  NET_INCOME:          'Net Income',
  CASH:                'Cash',
  ACCOUNTS_RECEIVABLE: 'Accounts Receivable',
  ACCOUNTS_PAYABLE:    'Accounts Payable',
  TOTAL_ASSETS:        'Total Assets',
  TOTAL_LIABILITIES:   'Total Liabilities',
}

// ─────────────────────────────────────────────────
// Classifier
// ─────────────────────────────────────────────────

const CONCEPT_PATTERNS: Record<TieOutConcept, RegExp[]> = {
  REVENUE: [
    /^\s*(total\s+)?(gross\s+)?revenue(s)?\s*$/i,
    /^\s*(gross\s+)?sales(\s+revenue)?\s*$/i,
    /^\s*gross\s+receipts(\s+or\s+sales)?\s*$/i,
    /^\s*net\s+sales\s*$/i,
  ],
  EBITDA: [
    /^\s*ebitda\s*$/i,
    /^\s*operating\s+income\s*$/i,
    /^\s*earnings\s+before\s+interest.*taxes/i,
    /^\s*income\s+from\s+operations\s*$/i,
  ],
  NET_INCOME: [
    /^\s*net\s+income(\s+\(loss\))?\s*$/i,
    /^\s*net\s+profit\s*$/i,
    /^\s*net\s+earnings\s*$/i,
    /^\s*profit\s+for\s+the\s+(year|period)\s*$/i,
  ],
  CASH: [
    /^\s*cash\s*$/i,
    /^\s*cash\s+(and|&)\s+cash\s+equivalents\s*$/i,
    /^\s*cash\s+(and|&)\s+equivalents\s*$/i,
  ],
  ACCOUNTS_RECEIVABLE: [
    /^\s*accounts?\s+receivable(?:\s+\(net\))?\s*$/i,
    /^\s*a\/?r\s*$/i,
    /^\s*trade\s+receivables?\s*$/i,
  ],
  ACCOUNTS_PAYABLE: [
    /^\s*accounts?\s+payable\s*$/i,
    /^\s*a\/?p\s*$/i,
    /^\s*trade\s+payables?\s*$/i,
  ],
  TOTAL_ASSETS: [
    /^\s*total\s+assets\s*$/i,
  ],
  TOTAL_LIABILITIES: [
    /^\s*total\s+liabilities\s*$/i,
    // "Total liabilities and equity" and "Total liabilities and shareholders'
    // equity" are NOT liabilities alone — deliberately excluded.
  ],
}

/**
 * Deterministic classification. Returns a Concept when the line item's
 * text unambiguously matches, otherwise null. NULL is a first-class
 * outcome: unclassifiable rows are skipped, never guessed.
 */
export function classifyLineItem(lineItem: string): TieOutConcept | null {
  const trimmed = lineItem.trim()
  if (!trimmed) return null
  for (const concept of TIE_OUT_CONCEPTS) {
    for (const rx of CONCEPT_PATTERNS[concept]) {
      if (rx.test(trimmed)) return concept
    }
  }
  return null
}

// ─────────────────────────────────────────────────
// Default tolerances
// ─────────────────────────────────────────────────

export interface Tolerance {
  /** Absolute dollar tolerance. Values within `± absolute` of each other tie. */
  absolute: Money
  /** Percent tolerance expressed as a fraction (0.01 = 1%). */
  percent:  Money
}

const t = (absoluteDollars: number, percentFraction: number): Tolerance => ({
  absolute: money(absoluteDollars),
  percent:  money(percentFraction),
})

/**
 * Default tolerances by concept. Selected to be conservative — we
 * default to *strict*, and the reviewer can override on a per-tie-out
 * basis when a bigger tolerance is justified.
 */
export const DEFAULT_TOLERANCES: Record<TieOutConcept, Tolerance> = {
  // Money whose accuracy matters most: cash & balance-sheet totals.
  CASH:                t(   100,   0.0005), // $100 or 0.05%
  TOTAL_ASSETS:        t(  1000,   0.001),  // $1,000 or 0.1%
  TOTAL_LIABILITIES:   t(  1000,   0.001),  // $1,000 or 0.1%
  ACCOUNTS_RECEIVABLE: t(  1000,   0.001),
  ACCOUNTS_PAYABLE:    t(  1000,   0.001),
  // Income-statement figures — small rounding routinely diverges between
  // GL, book/tax, and reporting flows.
  REVENUE:             t(  1000,   0.002),  // $1,000 or 0.2%
  EBITDA:              t(  2500,   0.01),   // $2,500 or 1%
  NET_INCOME:          t(  2500,   0.01),   // $2,500 or 1%
}

export function defaultToleranceFor(concept: TieOutConcept): Tolerance {
  return DEFAULT_TOLERANCES[concept]
}
