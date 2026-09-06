'use server'

/**
 * Review-queue aggregation.
 *
 * Two shapes of "needs review" work stream through the system:
 *
 *   1. Explicit ReviewItem rows (Slice 11) — one per material target,
 *      with a status machine and comments.
 *
 *   2. Derived queues from earlier slices — a FinancialValue with
 *      reviewStatus='PENDING' (Slice 0), an AddBack with status
 *      'PROPOSED'/'NEEDS_SUPPORT' (Slice 10), a TieOut with
 *      status='DISCREPANCY' (Slice 9), and Documents that haven't been
 *      through extraction yet.
 *
 * The queue endpoint returns BOTH so the analyst can see the whole
 * remaining workload for a case in one place.
 */

import { prisma } from '@/lib/prisma'
import { requireCaseAccess } from '@/lib/authz'
import { REVIEW_TARGET_LABEL, type ReviewTargetType } from '@/lib/reviews/targets'

export interface ReviewQueueSummary {
  caseId: string
  /** Explicit ReviewItem rows by target type. */
  reviewItems: Array<{
    targetType: ReviewTargetType
    targetTypeLabel: string
    readyForReviewCount:    number
    changesRequestedCount:  number
    approvedCount:          number
    draftCount:             number
  }>
  /** Derived counts from earlier-slice models. */
  derived: {
    financialValuesPending: number
    addBacksProposed:       number
    addBacksNeedsSupport:   number
    tieOutsDiscrepancy:     number
    documentsPending:       number
    anomalyFlagsOpen:       number
  }
  /** Convenience total for the header badge. */
  totalItemsAwaitingReview: number
}

export async function getCaseReviewQueue(caseId: string): Promise<ReviewQueueSummary> {
  await requireCaseAccess(caseId, 'case:read')

  // ── Explicit ReviewItem groupBy ─────────────────────────────────
  const grouped = await prisma.reviewItem.groupBy({
    where:   { caseId },
    by:      ['targetType', 'status'],
    _count:  { _all: true },
  })
  const perTarget = new Map<ReviewTargetType, {
    readyForReviewCount:    number
    changesRequestedCount:  number
    approvedCount:          number
    draftCount:             number
  }>()
  for (const row of grouped) {
    const key = row.targetType as ReviewTargetType
    const bucket = perTarget.get(key) ?? {
      readyForReviewCount: 0, changesRequestedCount: 0,
      approvedCount:       0, draftCount:            0,
    }
    const c = row._count._all
    if (row.status === 'READY_FOR_REVIEW')  bucket.readyForReviewCount    = c
    if (row.status === 'CHANGES_REQUESTED') bucket.changesRequestedCount  = c
    if (row.status === 'APPROVED')          bucket.approvedCount          = c
    if (row.status === 'DRAFT')             bucket.draftCount             = c
    perTarget.set(key, bucket)
  }
  const reviewItems = Array.from(perTarget.entries()).map(([targetType, b]) => ({
    targetType,
    targetTypeLabel: REVIEW_TARGET_LABEL[targetType] ?? targetType,
    ...b,
  }))

  // ── Derived counts — one query per model, no full scan ─────────
  const [
    financialValuesPending,
    addBacksProposed,
    addBacksNeedsSupport,
    tieOutsDiscrepancy,
    documentsPending,
    anomalyFlagsOpen,
  ] = await Promise.all([
    prisma.financialValue.count({ where: { caseId, reviewStatus: 'PENDING' } }),
    prisma.addBack       .count({ where: { caseId, status: 'PROPOSED' } }),
    prisma.addBack       .count({ where: { caseId, status: 'NEEDS_SUPPORT' } }),
    prisma.tieOut        .count({ where: { caseId, status: 'DISCREPANCY' } }),
    prisma.document      .count({ where: { caseId, status: 'PENDING', isArchived: false } }),
    prisma.anomalyFlag   .count({ where: { caseId, status: 'OPEN' } }),
  ])

  const totalItemsAwaitingReview =
    reviewItems.reduce((s, r) => s + r.readyForReviewCount + r.changesRequestedCount, 0)
    + financialValuesPending
    + addBacksProposed
    + addBacksNeedsSupport
    + tieOutsDiscrepancy
    + documentsPending
    + anomalyFlagsOpen

  return {
    caseId,
    reviewItems,
    derived: {
      financialValuesPending,
      addBacksProposed,
      addBacksNeedsSupport,
      tieOutsDiscrepancy,
      documentsPending,
      anomalyFlagsOpen,
    },
    totalItemsAwaitingReview,
  }
}
