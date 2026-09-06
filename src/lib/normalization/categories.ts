/**
 * Suggested adjustment categories.
 *
 * Rule from the slice prompt: "Do not hardcode accounting judgment."
 *
 * These are labels + human-facing text, NOT gatekeepers. The `category`
 * column on `AddBack` is a free-form string — analysts can type anything.
 * The dropdown in the UI shows these as suggestions; a fresh
 * engagement's unusual adjustment ("SBA loan forgiveness") types itself
 * in without a schema change.
 */

export const SUGGESTED_CATEGORIES = [
  'OWNER_COMPENSATION',
  'PERSONAL_EXPENSES',
  'RELATED_PARTY_RENT',
  'ONE_TIME_LITIGATION',
  'NONRECURRING_PROFESSIONAL_FEES',
  'DISCRETIONARY_EXPENSE',
  'NON_OPERATING_INCOME',
  'NON_OPERATING_EXPENSE',
  'DEPRECIATION_AMORTIZATION',
  'INTEREST_EXPENSE',
  'INCOME_TAXES',
] as const

export type SuggestedCategory = typeof SUGGESTED_CATEGORIES[number]

/** Human-readable label for the dropdown. Falls back to the raw string
 *  when the caller passes a custom category. */
export const CATEGORY_LABEL: Record<SuggestedCategory, string> = {
  OWNER_COMPENSATION:              'Owner compensation',
  PERSONAL_EXPENSES:               'Personal expenses',
  RELATED_PARTY_RENT:              'Related-party rent',
  ONE_TIME_LITIGATION:             'One-time litigation',
  NONRECURRING_PROFESSIONAL_FEES:  'Nonrecurring professional fees',
  DISCRETIONARY_EXPENSE:           'Discretionary expense',
  NON_OPERATING_INCOME:            'Non-operating income',
  NON_OPERATING_EXPENSE:           'Non-operating expense',
  DEPRECIATION_AMORTIZATION:       'Depreciation & amortization',
  INTEREST_EXPENSE:                'Interest expense',
  INCOME_TAXES:                    'Income taxes',
}

export function categoryLabel(category: string): string {
  const known = CATEGORY_LABEL[category as SuggestedCategory]
  return known ?? category
}

/** Default direction hint for the UI when picking a suggested category.
 *  Purely a UX default — the analyst can flip it. Non-operating INCOME
 *  is typically subtracted; every other suggested category is added. */
export function defaultDirectionFor(category: string): 'ADD' | 'SUBTRACT' {
  return category === 'NON_OPERATING_INCOME' ? 'SUBTRACT' : 'ADD'
}
