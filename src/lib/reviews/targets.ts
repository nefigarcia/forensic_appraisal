/**
 * ReviewItem target types.
 *
 * Polymorphic parent — a ReviewItem row identifies a specific material
 * target via (targetType, targetId). Adding a new target means adding
 * a value here + the queue aggregator's counting side.
 */

export const REVIEW_TARGET_TYPES = [
  'FINANCIAL_VALUE',
  'ADDBACK',
  'VALUATION_MODEL',
  'ANOMALY_FLAG',
  'REPORT_SECTION',
  'DOCUMENT',
  'TIE_OUT',
] as const

export type ReviewTargetType = typeof REVIEW_TARGET_TYPES[number]

export function isReviewTargetType(v: string): v is ReviewTargetType {
  return (REVIEW_TARGET_TYPES as readonly string[]).includes(v)
}

export const REVIEW_TARGET_LABEL: Record<ReviewTargetType, string> = {
  FINANCIAL_VALUE:  'Financial value',
  ADDBACK:          'Normalization add-back',
  VALUATION_MODEL:  'Valuation assumption',
  ANOMALY_FLAG:     'Anomaly flag',
  REPORT_SECTION:   'Report section',
  DOCUMENT:         'Document',
  TIE_OUT:          'Tie-out',
}
