import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:           { findFirst: vi.fn() },
    addBack:        { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    financialValue: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import {
  createAdjustment,
  updateAdjustment,
  changeAdjustmentStatus,
  deleteAdjustment,
  getCaseReviewerQueue,
  getOrgReviewerQueue,
  getWorkbenchForCase,
} from '@/app/actions/normalization'
import { NotFoundError, UnauthorizedError, ForbiddenError } from '@/lib/authz'

const sessionOrgA = { userId: 'user-a', organizationId: 'org-a', role: 'EDITOR', email: 'a@b.com', jti: 'j' }
const reviewerA   = { userId: 'user-r', organizationId: 'org-a', role: 'ADMIN',  email: 'r@b.com', jti: 'j' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(sessionOrgA as any)
})

// ─────────────────────────────────────────────────
// Tenant scoping
// ─────────────────────────────────────────────────

describe('tenant scoping', () => {
  it('createAdjustment refuses cross-org', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue(null)
    await expect(createAdjustment('case-b', { category: 'x', description: 'y' })).rejects.toBeInstanceOf(NotFoundError)
    expect(prisma.addBack.create).not.toHaveBeenCalled()
  })

  it('updateAdjustment refuses cross-org', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue(null)
    await expect(updateAdjustment('ab-b', { description: 'x' })).rejects.toBeInstanceOf(NotFoundError)
    expect(prisma.addBack.update).not.toHaveBeenCalled()
  })

  it('changeAdjustmentStatus refuses cross-org', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue(null)
    await expect(changeAdjustmentStatus('ab-b', 'PROPOSED')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('getWorkbenchForCase refuses cross-org', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue(null)
    await expect(getWorkbenchForCase('case-b')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('getCaseReviewerQueue refuses cross-org', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue(null)
    await expect(getCaseReviewerQueue('case-b')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('getOrgReviewerQueue refuses an unauthenticated caller', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    await expect(getOrgReviewerQueue()).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

// ─────────────────────────────────────────────────
// createAdjustment
// ─────────────────────────────────────────────────

describe('createAdjustment', () => {
  it('starts as DRAFT with proposedBy set to the session user', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.addBack.create).mockResolvedValue({ id: 'ab-new' } as any)

    await createAdjustment('case-a', {
      category: 'OWNER_COMPENSATION',
      description: 'Owner personal auto lease',
      recurring: 'RECURRING',
      taxTreatment: 'PRE_TAX',
      rationale: 'Not required for continuing operations',
      amounts: { year2: '30000', year1: '31500', ttm: '33000' },
    })

    const data = vi.mocked(prisma.addBack.create).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('DRAFT')
    expect(data.proposedBy).toBe('user-a')
    expect(data.direction).toBe('ADD')        // default for OWNER_COMPENSATION
    expect(data.recurring).toBe('RECURRING')
    expect(data.taxTreatment).toBe('PRE_TAX')
    expect(data.isApproved).toBe(false)
    // Slice-4 Decimal shadows populated
    expect(String(data.year2Decimal)).toBe('30000')
    expect(String(data.year1Decimal)).toBe('31500')
    expect(String(data.ttmDecimal)).toBe('33000')
  })

  it('defaults NON_OPERATING_INCOME direction to SUBTRACT (UX hint)', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.addBack.create).mockResolvedValue({ id: 'ab-x' } as any)
    await createAdjustment('case-a', {
      category: 'NON_OPERATING_INCOME',
      description: 'Insurance recovery',
      amounts: { year1: '10000' },
    })
    const data = vi.mocked(prisma.addBack.create).mock.calls[0]![0]!.data as any
    expect(data.direction).toBe('SUBTRACT')
  })

  it('refuses empty description / category', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    await expect(createAdjustment('case-a', { category: '', description: 'ok' })).rejects.toThrow(/Category/)
    await expect(createAdjustment('case-a', { category: 'x', description: '  ' })).rejects.toThrow(/Description/)
  })
})

// ─────────────────────────────────────────────────
// updateAdjustment — status-gated
// ─────────────────────────────────────────────────

describe('updateAdjustment', () => {
  it('allows edits on DRAFT / NEEDS_SUPPORT / REJECTED', async () => {
    for (const status of ['DRAFT', 'NEEDS_SUPPORT', 'REJECTED']) {
      vi.mocked(prisma.addBack.findFirst).mockResolvedValueOnce({
        id: 'ab-1', caseId: 'case-a', description: 'old', category: 'X',
        year2: null, year1: 100, ttm: null,
        status,
      } as any)
      vi.mocked(prisma.addBack.update).mockResolvedValueOnce({} as any)
      await updateAdjustment('ab-1', { description: 'new' })
    }
    expect(prisma.addBack.update).toHaveBeenCalledTimes(3)
  })

  it('refuses edits on PROPOSED / APPROVED', async () => {
    for (const status of ['PROPOSED', 'APPROVED']) {
      vi.mocked(prisma.addBack.findFirst).mockResolvedValueOnce({
        id: 'ab-1', caseId: 'case-a', description: 'x', category: 'X',
        status,
      } as any)
      await expect(updateAdjustment('ab-1', { description: 'new' })).rejects.toThrow(/Cannot edit/)
    }
    expect(prisma.addBack.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────
// changeAdjustmentStatus — the transition gate
// ─────────────────────────────────────────────────

describe('changeAdjustmentStatus', () => {
  it('allows DRAFT → PROPOSED (no reason required)', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue({
      id: 'ab-1', caseId: 'case-a', status: 'DRAFT', description: 'x',
    } as any)
    vi.mocked(prisma.addBack.update).mockResolvedValue({} as any)
    await changeAdjustmentStatus('ab-1', 'PROPOSED')
    const data = vi.mocked(prisma.addBack.update).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('PROPOSED')
    expect(data.statusChangedAt).toBeInstanceOf(Date)
    expect(data.proposedBy).toBe('user-a')
  })

  it('refuses DRAFT → APPROVED (must go through PROPOSED)', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue({
      id: 'ab-1', caseId: 'case-a', status: 'DRAFT', description: 'x',
    } as any)
    await expect(changeAdjustmentStatus('ab-1', 'APPROVED')).rejects.toThrow(/Invalid transition/)
    expect(prisma.addBack.update).not.toHaveBeenCalled()
  })

  it('PROPOSED → APPROVED sets reviewer + timestamp + isApproved=true', async () => {
    vi.mocked(getSession).mockResolvedValue(reviewerA as any)
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue({
      id: 'ab-1', caseId: 'case-a', status: 'PROPOSED', description: 'x',
    } as any)
    vi.mocked(prisma.addBack.update).mockResolvedValue({} as any)
    await changeAdjustmentStatus('ab-1', 'APPROVED')
    const data = vi.mocked(prisma.addBack.update).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('APPROVED')
    expect(data.isApproved).toBe(true)
    expect(data.reviewedBy).toBe('user-r')
    expect(data.reviewedAt).toBeInstanceOf(Date)
    expect(data.approvedBy).toBe('user-r')
  })

  it('PROPOSED → REJECTED requires a reason', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue({
      id: 'ab-1', caseId: 'case-a', status: 'PROPOSED', description: 'x',
    } as any)
    await expect(changeAdjustmentStatus('ab-1', 'REJECTED')).rejects.toThrow(/reason/)
    await expect(changeAdjustmentStatus('ab-1', 'REJECTED', '   ')).rejects.toThrow(/reason/)
  })

  it('PROPOSED → REJECTED with reason stores rejectionReason', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue({
      id: 'ab-1', caseId: 'case-a', status: 'PROPOSED', description: 'x',
    } as any)
    vi.mocked(prisma.addBack.update).mockResolvedValue({} as any)
    await changeAdjustmentStatus('ab-1', 'REJECTED', 'no supporting doc')
    const data = vi.mocked(prisma.addBack.update).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('REJECTED')
    expect(data.rejectionReason).toBe('no supporting doc')
    expect(data.isApproved).toBe(false)
  })

  it('PROPOSED → NEEDS_SUPPORT requires a reason', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue({
      id: 'ab-1', caseId: 'case-a', status: 'PROPOSED', description: 'x',
    } as any)
    await expect(changeAdjustmentStatus('ab-1', 'NEEDS_SUPPORT')).rejects.toThrow(/reason/)
  })

  it('APPROVED → DRAFT clears reviewer fields (rework)', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue({
      id: 'ab-1', caseId: 'case-a', status: 'APPROVED', description: 'x',
    } as any)
    vi.mocked(prisma.addBack.update).mockResolvedValue({} as any)
    await changeAdjustmentStatus('ab-1', 'DRAFT')
    const data = vi.mocked(prisma.addBack.update).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('DRAFT')
    expect(data.isApproved).toBe(false)
    expect(data.reviewedBy).toBeNull()
    expect(data.reviewedAt).toBeNull()
    expect(data.rejectionReason).toBeNull()
  })

  it('APPROVED → REJECTED is refused (must reopen to DRAFT first)', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue({
      id: 'ab-1', caseId: 'case-a', status: 'APPROVED', description: 'x',
    } as any)
    await expect(changeAdjustmentStatus('ab-1', 'REJECTED', 'x')).rejects.toThrow(/Invalid transition/)
  })

  it('self-transition is a no-op (does not throw)', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue({
      id: 'ab-1', caseId: 'case-a', status: 'DRAFT', description: 'x',
    } as any)
    await changeAdjustmentStatus('ab-1', 'DRAFT')
    expect(prisma.addBack.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────
// deleteAdjustment
// ─────────────────────────────────────────────────

describe('deleteAdjustment', () => {
  it('deletes DRAFT and REJECTED rows', async () => {
    for (const status of ['DRAFT','REJECTED']) {
      vi.mocked(prisma.addBack.findFirst).mockResolvedValueOnce({
        id: 'ab-1', caseId: 'case-a', description: 'x', status,
      } as any)
      vi.mocked(prisma.addBack.delete).mockResolvedValueOnce({} as any)
      await deleteAdjustment('ab-1')
    }
    expect(prisma.addBack.delete).toHaveBeenCalledTimes(2)
  })

  it('refuses deletion of PROPOSED / NEEDS_SUPPORT / APPROVED', async () => {
    for (const status of ['PROPOSED','NEEDS_SUPPORT','APPROVED']) {
      vi.mocked(prisma.addBack.findFirst).mockResolvedValueOnce({
        id: 'ab-1', caseId: 'case-a', description: 'x', status,
      } as any)
      await expect(deleteAdjustment('ab-1')).rejects.toThrow(/Cannot delete/)
    }
    expect(prisma.addBack.delete).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────
// Reviewer queue
// ─────────────────────────────────────────────────

describe('getCaseReviewerQueue', () => {
  it('scopes to PROPOSED and NEEDS_SUPPORT only', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.addBack.findMany).mockResolvedValue([] as any)
    await getCaseReviewerQueue('case-a')
    const arg = vi.mocked(prisma.addBack.findMany).mock.calls[0]![0]!
    expect(arg.where).toMatchObject({
      caseId: 'case-a',
      status: { in: ['PROPOSED', 'NEEDS_SUPPORT'] },
    })
  })
})

// ─────────────────────────────────────────────────
// getWorkbenchForCase — sort order + bridge integration
// ─────────────────────────────────────────────────

describe('getWorkbenchForCase — sort order', () => {
  it('surfaces reviewer-queue items ahead of everything else', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.addBack.findMany).mockResolvedValue([
      // DB returns in arbitrary alphabetic-ish order
      { id: 'a1', category: 'X', description: 'approved',       status: 'APPROVED',      direction: 'ADD', recurring: 'NONRECURRING', taxTreatment: null, rationale: 'r', proposedBy: null, reviewedBy: null, reviewedAt: null, statusChangedAt: null, rejectionReason: null, year2: null, year1: 100, ttm: null, year2Decimal: null, year1Decimal: '100', ttmDecimal: null, createdAt: new Date(), updatedAt: new Date(), _count: { citations: 1 } },
      { id: 'a2', category: 'X', description: 'draft',          status: 'DRAFT',         direction: 'ADD', recurring: 'NONRECURRING', taxTreatment: null, rationale: 'r', proposedBy: null, reviewedBy: null, reviewedAt: null, statusChangedAt: null, rejectionReason: null, year2: null, year1: 100, ttm: null, year2Decimal: null, year1Decimal: '100', ttmDecimal: null, createdAt: new Date(), updatedAt: new Date(), _count: { citations: 1 } },
      { id: 'a3', category: 'X', description: 'needs-support',  status: 'NEEDS_SUPPORT', direction: 'ADD', recurring: 'NONRECURRING', taxTreatment: null, rationale: 'r', proposedBy: null, reviewedBy: null, reviewedAt: null, statusChangedAt: null, rejectionReason: null, year2: null, year1: 100, ttm: null, year2Decimal: null, year1Decimal: '100', ttmDecimal: null, createdAt: new Date(), updatedAt: new Date(), _count: { citations: 1 } },
      { id: 'a4', category: 'X', description: 'proposed',       status: 'PROPOSED',      direction: 'ADD', recurring: 'NONRECURRING', taxTreatment: null, rationale: 'r', proposedBy: null, reviewedBy: null, reviewedAt: null, statusChangedAt: null, rejectionReason: null, year2: null, year1: 100, ttm: null, year2Decimal: null, year1Decimal: '100', ttmDecimal: null, createdAt: new Date(), updatedAt: new Date(), _count: { citations: 1 } },
      { id: 'a5', category: 'X', description: 'rejected',       status: 'REJECTED',      direction: 'ADD', recurring: 'NONRECURRING', taxTreatment: null, rationale: 'r', proposedBy: null, reviewedBy: null, reviewedAt: null, statusChangedAt: null, rejectionReason: null, year2: null, year1: 100, ttm: null, year2Decimal: null, year1Decimal: '100', ttmDecimal: null, createdAt: new Date(), updatedAt: new Date(), _count: { citations: 1 } },
    ] as any)
    vi.mocked(prisma.financialValue.findMany).mockResolvedValue([] as any)

    const wb = await getWorkbenchForCase('case-a')
    expect(wb.adjustments.map(a => a.status)).toEqual([
      'NEEDS_SUPPORT', 'PROPOSED', 'DRAFT', 'REJECTED', 'APPROVED',
    ])
    // Only the one APPROVED $100 hits the bridge for year1.
    expect(wb.bridge.perPeriod.year1.netAdjustment).toBe('100')
    expect(wb.bridge.approvedCount).toBe(1)
    expect(wb.bridge.ignoredCount).toBe(4)
    expect(wb.reviewerQueueCount).toBe(2)
  })
})

// Keep unused imports referenced.
void ForbiddenError
