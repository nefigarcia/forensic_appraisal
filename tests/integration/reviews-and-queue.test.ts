import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:            { findFirst: vi.fn() },
    caseMember:      { findUnique: vi.fn() },
    user:            { findUnique: vi.fn() },
    reviewItem:      { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    reviewComment:   { create: vi.fn() },
    financialValue:  { count: vi.fn() },
    addBack:         { count: vi.fn() },
    tieOut:          { count: vi.fn() },
    document:        { count: vi.fn() },
    anomalyFlag:     { count: vi.fn() },
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import {
  createReviewItem,
  changeReviewStatus,
  addReviewComment,
} from '@/app/actions/reviews'
import { getCaseReviewQueue } from '@/app/actions/review-queue'
import { NotFoundError } from '@/lib/authz'

const editorInOrgA = { userId: 'user-e', organizationId: 'org-a', role: 'EDITOR', email: 'e@a', jti: 'j' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(editorInOrgA as any)
})

// ─────────────────────────────────────────────────
// createReviewItem
// ─────────────────────────────────────────────────

describe('createReviewItem', () => {
  it('refuses unknown targetType', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
    await expect(createReviewItem({ caseId: 'case-a', targetType: 'RANDOM', targetId: 't1', title: 'x' })).rejects.toThrow(/Unknown targetType/)
  })

  it('refuses empty title', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
    await expect(createReviewItem({ caseId: 'case-a', targetType: 'FINANCIAL_VALUE', targetId: 't1', title: '   ' })).rejects.toThrow(/Title required/)
  })

  it('creates a DRAFT review item with createdBy = session user', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
    vi.mocked(prisma.reviewItem.create).mockResolvedValue({ id: 'ri-1' } as any)

    await createReviewItem({
      caseId: 'case-a', targetType: 'FINANCIAL_VALUE', targetId: 'fv-1',
      title: 'Verify tax return matches P&L revenue',
      description: 'Requires evidence citation',
    })

    const data = vi.mocked(prisma.reviewItem.create).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('DRAFT')
    expect(data.createdBy).toBe('user-e')
    expect(data.targetType).toBe('FINANCIAL_VALUE')
    expect(data.targetId).toBe('fv-1')
  })

  it('returns the existing item when the (case, targetType, targetId) is a duplicate', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
    // Simulate P2002 on create, then findUnique returns the pre-existing row.
    const p2002 = Object.assign(new Error('unique'), { code: 'P2002' })
    vi.mocked(prisma.reviewItem.create).mockRejectedValue(p2002)
    vi.mocked(prisma.reviewItem.findUnique).mockResolvedValue({ id: 'ri-existing' } as any)
    const res = await createReviewItem({
      caseId: 'case-a', targetType: 'ADDBACK', targetId: 'ab-1', title: 'Review add-back',
    })
    expect(res.id).toBe('ri-existing')
  })

  it('refuses an assignedTo user from another org', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ organizationId: 'org-b' } as any)
    await expect(createReviewItem({
      caseId: 'case-a', targetType: 'FINANCIAL_VALUE', targetId: 'x', title: 't', assignedTo: 'user-b',
    })).rejects.toThrow(/not in this organization/)
  })
})

// ─────────────────────────────────────────────────
// changeReviewStatus — the state machine
// ─────────────────────────────────────────────────

describe('changeReviewStatus', () => {
  function primeItem(status: string) {
    vi.mocked(prisma.reviewItem.findUnique).mockResolvedValue({
      id: 'ri-1', caseId: 'case-a', status,
    } as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
    vi.mocked(prisma.reviewItem.update).mockResolvedValue({} as any)
  }

  it('DRAFT → READY_FOR_REVIEW is allowed and clears no reviewer fields', async () => {
    primeItem('DRAFT')
    await changeReviewStatus('ri-1', 'READY_FOR_REVIEW')
    const data = vi.mocked(prisma.reviewItem.update).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('READY_FOR_REVIEW')
  })

  it('READY_FOR_REVIEW → APPROVED sets reviewer + timestamp', async () => {
    primeItem('READY_FOR_REVIEW')
    await changeReviewStatus('ri-1', 'APPROVED')
    const data = vi.mocked(prisma.reviewItem.update).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('APPROVED')
    expect(data.approvedBy).toBe('user-e')
    expect(data.approvedAt).toBeInstanceOf(Date)
  })

  it('READY_FOR_REVIEW → CHANGES_REQUESTED requires a note', async () => {
    primeItem('READY_FOR_REVIEW')
    await expect(changeReviewStatus('ri-1', 'CHANGES_REQUESTED')).rejects.toThrow(/note/)
    await expect(changeReviewStatus('ri-1', 'CHANGES_REQUESTED', '  ')).rejects.toThrow(/note/)
  })

  it('READY_FOR_REVIEW → CHANGES_REQUESTED with a note records changesRequestedNote', async () => {
    primeItem('READY_FOR_REVIEW')
    await changeReviewStatus('ri-1', 'CHANGES_REQUESTED', 'Missing evidence citation')
    const data = vi.mocked(prisma.reviewItem.update).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('CHANGES_REQUESTED')
    expect(data.changesRequestedBy).toBe('user-e')
    expect(data.changesRequestedNote).toBe('Missing evidence citation')
  })

  it('APPROVED → CHANGES_REQUESTED is refused (must reopen to READY_FOR_REVIEW first)', async () => {
    primeItem('APPROVED')
    await expect(changeReviewStatus('ri-1', 'CHANGES_REQUESTED', 'x')).rejects.toThrow(/Invalid review transition/)
  })

  it('DRAFT → APPROVED is refused (cannot skip READY_FOR_REVIEW)', async () => {
    primeItem('DRAFT')
    await expect(changeReviewStatus('ri-1', 'APPROVED')).rejects.toThrow(/Invalid review transition/)
  })

  it('self-transition is silent no-op', async () => {
    primeItem('DRAFT')
    await changeReviewStatus('ri-1', 'DRAFT')
    expect(prisma.reviewItem.update).not.toHaveBeenCalled()
  })

  it('APPROVED → READY_FOR_REVIEW clears the previous approval', async () => {
    primeItem('APPROVED')
    await changeReviewStatus('ri-1', 'READY_FOR_REVIEW')
    const data = vi.mocked(prisma.reviewItem.update).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('READY_FOR_REVIEW')
    expect(data.approvedBy).toBeNull()
    expect(data.approvedAt).toBeNull()
  })
})

// ─────────────────────────────────────────────────
// addReviewComment
// ─────────────────────────────────────────────────

describe('addReviewComment — append-only', () => {
  it('requires a non-empty body', async () => {
    await expect(addReviewComment({ reviewItemId: 'ri-1', body: '  ' })).rejects.toThrow(/body/)
  })

  it('persists a comment with authorId=session user', async () => {
    vi.mocked(prisma.reviewItem.findUnique).mockResolvedValue({ caseId: 'case-a' } as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
    vi.mocked(prisma.reviewComment.create).mockResolvedValue({ id: 'rc-1' } as any)
    await addReviewComment({ reviewItemId: 'ri-1', body: 'Looks good; approve after citation is attached.' })
    const data = vi.mocked(prisma.reviewComment.create).mock.calls[0]![0]!.data as any
    expect(data.authorId).toBe('user-e')
    expect(data.body).toContain('Looks good')
  })

  it('refuses a comment on a non-existent review item', async () => {
    vi.mocked(prisma.reviewItem.findUnique).mockResolvedValue(null)
    await expect(addReviewComment({ reviewItemId: 'ri-none', body: 'x' })).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ─────────────────────────────────────────────────
// getCaseReviewQueue — the promised summary shape
// ─────────────────────────────────────────────────

describe('getCaseReviewQueue', () => {
  it('reproduces the slice prompt example: 12 financial values / 3 add-backs / 1 discrepancy / 4 missing docs', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
    vi.mocked(prisma.reviewItem.groupBy).mockResolvedValue([
      { targetType: 'VALUATION_MODEL', status: 'READY_FOR_REVIEW', _count: { _all: 2 } },
    ] as any)
    vi.mocked(prisma.financialValue.count).mockResolvedValueOnce(12)
    vi.mocked(prisma.addBack.count)
      .mockResolvedValueOnce(3)   // proposed
      .mockResolvedValueOnce(0)   // needs support
    vi.mocked(prisma.tieOut.count).mockResolvedValueOnce(1)
    vi.mocked(prisma.document.count).mockResolvedValueOnce(4)
    vi.mocked(prisma.anomalyFlag.count).mockResolvedValueOnce(0)

    const q = await getCaseReviewQueue('case-a')
    expect(q.derived).toEqual({
      financialValuesPending: 12,
      addBacksProposed:       3,
      addBacksNeedsSupport:   0,
      tieOutsDiscrepancy:     1,
      documentsPending:       4,
      anomalyFlagsOpen:       0,
    })
    // 12 + 3 + 1 + 4 + 2 (explicit READY_FOR_REVIEW valuation assumptions) = 22
    expect(q.totalItemsAwaitingReview).toBe(22)
    expect(q.reviewItems).toEqual([
      expect.objectContaining({
        targetType: 'VALUATION_MODEL',
        readyForReviewCount: 2,
      }),
    ])
  })

  it('groups multiple statuses on the same target type', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
    vi.mocked(prisma.reviewItem.groupBy).mockResolvedValue([
      { targetType: 'FINANCIAL_VALUE', status: 'READY_FOR_REVIEW',   _count: { _all: 2 } },
      { targetType: 'FINANCIAL_VALUE', status: 'CHANGES_REQUESTED',  _count: { _all: 1 } },
      { targetType: 'FINANCIAL_VALUE', status: 'APPROVED',           _count: { _all: 5 } },
    ] as any)
    vi.mocked(prisma.financialValue.count).mockResolvedValueOnce(0)
    vi.mocked(prisma.addBack.count).mockResolvedValue(0)
    vi.mocked(prisma.tieOut.count).mockResolvedValue(0)
    vi.mocked(prisma.document.count).mockResolvedValue(0)
    vi.mocked(prisma.anomalyFlag.count).mockResolvedValue(0)

    const q = await getCaseReviewQueue('case-a')
    expect(q.reviewItems[0]).toMatchObject({
      targetType: 'FINANCIAL_VALUE',
      readyForReviewCount: 2,
      changesRequestedCount: 1,
      approvedCount: 5,
    })
  })

  it('refuses cross-org access (Slice-1 inheritance)', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue(null)
    await expect(getCaseReviewQueue('case-b')).rejects.toBeInstanceOf(NotFoundError)
  })
})
