/**
 * LOAD-BEARING integration tests for the Slice-13 assumption workflow.
 *
 * Invariants exercised through the real action code path:
 *   1. APPROVE requires a rationale.
 *   2. Proposer cannot approve their own assumption (no self-approval).
 *   3. Approving a new value with the same key SUPERSEDES the older
 *      APPROVED row atomically.
 *   4. Every mutation writes an AssumptionEvent (append-only history).
 *   5. Editing an APPROVED row is refused — you must supersede it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:                  { findFirst: vi.fn() },
    caseMember:            { findUnique: vi.fn() },
    valuationEngagement:   { findUnique: vi.fn() },
    valuationAssumption:   { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    assumptionEvent:       { create: vi.fn() },
    $transaction:          vi.fn(async (fn: any) => fn({
      valuationAssumption: { create: vi.fn(), update: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      assumptionEvent:     { create: vi.fn() },
    })),
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { ForbiddenError } from '@/lib/authz'
import {
  createAssumption,
  updateAssumptionValue,
  changeAssumptionStatus,
} from '@/app/actions/valuation-assumptions'

const proposer = { userId: 'user-p', organizationId: 'org-a', role: 'EDITOR', email: 'p@a', jti: 'j1' }
const reviewer = { userId: 'user-r', organizationId: 'org-a', role: 'EDITOR', email: 'r@a', jti: 'j2' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.case.findFirst).mockResolvedValue({
    id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false,
  } as any)
  vi.mocked(prisma.valuationEngagement.findUnique).mockResolvedValue({ caseId: 'case-a' } as any)
})

// ─────────────────────────────────────────────────
// APPROVE requires a rationale
// ─────────────────────────────────────────────────

describe('APPROVE requires rationale', () => {
  it('refuses to approve a row with a null rationale', async () => {
    vi.mocked(getSession).mockResolvedValue(reviewer as any)
    vi.mocked(prisma.valuationAssumption.findUnique).mockResolvedValue({
      id: 'a-1', engagementId: 'e-1', status: 'PROPOSED',
      proposedBy: 'user-p', rationale: null,
      engagement: { caseId: 'case-a' },
    } as any)
    await expect(changeAssumptionStatus({ id: 'a-1', next: 'APPROVED' }))
      .rejects.toThrow(/rationale/i)
  })

  it('refuses to approve a row with whitespace-only rationale', async () => {
    vi.mocked(getSession).mockResolvedValue(reviewer as any)
    vi.mocked(prisma.valuationAssumption.findUnique).mockResolvedValue({
      id: 'a-1', engagementId: 'e-1', status: 'PROPOSED',
      proposedBy: 'user-p', rationale: '   ',
      engagement: { caseId: 'case-a' },
    } as any)
    await expect(changeAssumptionStatus({ id: 'a-1', next: 'APPROVED' }))
      .rejects.toThrow(/rationale/i)
  })
})

// ─────────────────────────────────────────────────
// Proposer cannot self-approve
// ─────────────────────────────────────────────────

describe('proposer cannot self-approve', () => {
  it('throws ForbiddenError when the reviewer === proposedBy', async () => {
    vi.mocked(getSession).mockResolvedValue(proposer as any)
    vi.mocked(prisma.valuationAssumption.findUnique).mockResolvedValue({
      id: 'a-1', engagementId: 'e-1', status: 'PROPOSED',
      proposedBy: 'user-p',
      rationale: 'Blue-book median WACC for the industry.',
      engagement: { caseId: 'case-a' },
    } as any)
    await expect(changeAssumptionStatus({ id: 'a-1', next: 'APPROVED' }))
      .rejects.toBeInstanceOf(ForbiddenError)
  })

  it('allows a different reviewer to approve', async () => {
    vi.mocked(getSession).mockResolvedValue(reviewer as any)
    vi.mocked(prisma.valuationAssumption.findUnique).mockResolvedValue({
      id: 'a-1', engagementId: 'e-1', key: 'wacc', status: 'PROPOSED',
      proposedBy: 'user-p',
      rationale: 'Blue-book median WACC for the industry.',
      engagement: { caseId: 'case-a' },
    } as any)
    // Capture the write inside the transaction.
    let updated: any = null
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      await fn({
        valuationAssumption: {
          update:    (args: any) => { updated = args },
          findMany:  vi.fn().mockResolvedValue([]),
        },
        assumptionEvent: { create: vi.fn() },
      })
    })
    await changeAssumptionStatus({ id: 'a-1', next: 'APPROVED' })
    expect(updated.data.status).toBe('APPROVED')
    expect(updated.data.approvedBy).toBe('user-r')
  })
})

// ─────────────────────────────────────────────────
// Approving a new value supersedes the older APPROVED with same key
// ─────────────────────────────────────────────────

describe('supersession — new APPROVED replaces older APPROVED with same key', () => {
  it('atomically flips the older row to SUPERSEDED with a back-pointer', async () => {
    vi.mocked(getSession).mockResolvedValue(reviewer as any)
    vi.mocked(prisma.valuationAssumption.findUnique).mockResolvedValue({
      id: 'a-new', engagementId: 'e-1', key: 'wacc', status: 'PROPOSED',
      proposedBy: 'user-p',
      rationale: 'Refreshed on 2026-08-01 CAPM inputs.',
      engagement: { caseId: 'case-a' },
    } as any)

    const supersedeUpdates: any[] = []
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      await fn({
        valuationAssumption: {
          update:   (args: any) => { supersedeUpdates.push(args); return {} },
          findMany: vi.fn().mockResolvedValue([{ id: 'a-old' }]),  // one older APPROVED
        },
        assumptionEvent: { create: vi.fn() },
      })
    })
    await changeAssumptionStatus({ id: 'a-new', next: 'APPROVED' })
    // Expect two updates: the older row flipped to SUPERSEDED, and the
    // new row set to APPROVED.
    expect(supersedeUpdates).toHaveLength(2)
    const older = supersedeUpdates.find(u => u.where?.id === 'a-old')
    expect(older?.data.status).toBe('SUPERSEDED')
    expect(older?.data.supersededBy).toBe('a-new')
    const newer = supersedeUpdates.find(u => u.where?.id === 'a-new')
    expect(newer?.data.status).toBe('APPROVED')
  })
})

// ─────────────────────────────────────────────────
// Editing an APPROVED / SUPERSEDED row is refused
// ─────────────────────────────────────────────────

describe('edits are refused on frozen statuses', () => {
  it('APPROVED row rejects updateAssumptionValue', async () => {
    vi.mocked(getSession).mockResolvedValue(reviewer as any)
    vi.mocked(prisma.valuationAssumption.findUnique).mockResolvedValue({
      id: 'a-1', engagementId: 'e-1', status: 'APPROVED',
      engagement: { caseId: 'case-a' },
    } as any)
    await expect(updateAssumptionValue({ id: 'a-1', valueString: '0.15' }))
      .rejects.toThrow(/Cannot edit assumption in status APPROVED/)
  })

  it('SUPERSEDED row rejects updateAssumptionValue', async () => {
    vi.mocked(getSession).mockResolvedValue(reviewer as any)
    vi.mocked(prisma.valuationAssumption.findUnique).mockResolvedValue({
      id: 'a-2', engagementId: 'e-1', status: 'SUPERSEDED',
      engagement: { caseId: 'case-a' },
    } as any)
    await expect(updateAssumptionValue({ id: 'a-2', valueString: '0.15' }))
      .rejects.toThrow(/SUPERSEDED/)
  })
})

// ─────────────────────────────────────────────────
// createAssumption writes a CREATE AssumptionEvent
// ─────────────────────────────────────────────────

describe('createAssumption writes an event', () => {
  it('every create fires a CREATE event with newValue populated', async () => {
    vi.mocked(getSession).mockResolvedValue(proposer as any)

    const events: any[] = []
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      return fn({
        valuationAssumption: {
          create: vi.fn().mockResolvedValue({ id: 'a-99' }),
          update: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
        },
        assumptionEvent: { create: (args: any) => { events.push(args); return Promise.resolve({}) } },
      })
    })
    await createAssumption({
      engagementId: 'e-1',
      targetType: 'ENGAGEMENT',
      key: 'wacc.riskFreeRate', label: 'WACC — Risk-free rate',
      valueString: '0.045', unit: 'RATE',
      source: 'US 10-yr Treasury as of 2026-01-15',
      rationale: 'Consistent with the valuation date.',
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.data.action).toBe('CREATE')
    expect(JSON.parse(events[0]!.data.newValue)).toEqual({ value: '0.045', unit: 'RATE' })
  })
})

// ─────────────────────────────────────────────────
// Transition guardrails
// ─────────────────────────────────────────────────

describe('assumption transition guardrails', () => {
  it('DRAFT → APPROVED is refused (must go through PROPOSED)', async () => {
    vi.mocked(getSession).mockResolvedValue(reviewer as any)
    vi.mocked(prisma.valuationAssumption.findUnique).mockResolvedValue({
      id: 'a-1', engagementId: 'e-1', status: 'DRAFT',
      proposedBy: 'user-p', rationale: 'x',
      engagement: { caseId: 'case-a' },
    } as any)
    await expect(changeAssumptionStatus({ id: 'a-1', next: 'APPROVED' }))
      .rejects.toThrow(/Invalid assumption transition: DRAFT → APPROVED/)
  })

  it('REJECT requires a note', async () => {
    vi.mocked(getSession).mockResolvedValue(reviewer as any)
    vi.mocked(prisma.valuationAssumption.findUnique).mockResolvedValue({
      id: 'a-1', engagementId: 'e-1', status: 'PROPOSED',
      proposedBy: 'user-p', rationale: 'x',
      engagement: { caseId: 'case-a' },
    } as any)
    await expect(changeAssumptionStatus({ id: 'a-1', next: 'REJECTED' }))
      .rejects.toThrow(/requires a note/)
  })
})
