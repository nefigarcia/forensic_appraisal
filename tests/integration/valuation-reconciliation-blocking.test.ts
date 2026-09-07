/**
 * LOAD-BEARING: `runScenarioReconciliation` refuses to compute while
 * any material assumption or ownership adjustment is not APPROVED.
 *
 * Enforcement points:
 *   - Non-APPROVED assumption → refuse.
 *   - DRAFT / PROPOSED ownership adjustment → refuse.
 *   - `allowBlocking: true` overrides but forces the resulting row to
 *     record `hasBlockingAssumptions = true`.
 *   - APPROVED ownership rows are still passed through, so the
 *     preview honestly reflects the reviewer's approved discounts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:                    { findFirst: vi.fn() },
    caseMember:              { findUnique: vi.fn() },
    valuationScenario:       { findUnique: vi.fn() },
    equityBridgeItem:        { findMany: vi.fn() },
    valuationReconciliation: { upsert: vi.fn() },
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { runScenarioReconciliation } from '@/app/actions/valuation-compute'

const editor = { userId: 'user-e', organizationId: 'org-a', role: 'EDITOR', email: 'e@a', jti: 'j' }

function primeScenario(overrides: {
  assumptions?:         Array<{ key: string; status: string }>
  ownershipAdjustments?: Array<{ kind: string; status: string; percent: string; rationale?: string | null; source?: string | null }>
  approaches?:          Array<{ id: string; kind: string; isIncluded: boolean; weight: string; indicatedValue: string | null }>
  bridge?:              Array<{ category: string; label: string; amount: string; displayOrder?: number }>
} = {}) {
  vi.mocked(prisma.valuationScenario.findUnique).mockResolvedValue({
    id: 's-1', key: 'BASE',
    engagementId: 'e-1',
    engagement: {
      caseId: 'case-a',
      case:   { id: 'case-a' },
      assumptions: overrides.assumptions ?? [],
      ownershipAdjustments: overrides.ownershipAdjustments ?? [],
    },
    approaches: overrides.approaches ?? [
      { id: 'ap-1', kind: 'INCOME_DCF', isIncluded: true, weight: '1', indicatedValue: '10000000' },
    ],
  } as any)
  vi.mocked(prisma.equityBridgeItem.findMany).mockResolvedValue((overrides.bridge ?? []) as any)
  vi.mocked(prisma.valuationReconciliation.upsert).mockResolvedValue({} as any)
  vi.mocked(prisma.case.findFirst).mockResolvedValue({
    id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false,
  } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(editor as any)
})

// ─────────────────────────────────────────────────
// Refuses on blocking assumptions
// ─────────────────────────────────────────────────

describe('runScenarioReconciliation — blocking guardrail', () => {
  it('refuses to run when any assumption is PROPOSED', async () => {
    primeScenario({
      assumptions: [{ key: 'wacc', status: 'PROPOSED' }],
    })
    await expect(runScenarioReconciliation({ scenarioId: 's-1' }))
      .rejects.toThrow(/Assumption "wacc" is PROPOSED/)
    // No row was upserted.
    expect(prisma.valuationReconciliation.upsert).not.toHaveBeenCalled()
  })

  it('refuses when an ownership adjustment is DRAFT / PROPOSED', async () => {
    primeScenario({
      ownershipAdjustments: [{ kind: 'DLOM', status: 'PROPOSED', percent: '0.20', rationale: 'x', source: 's' }],
    })
    await expect(runScenarioReconciliation({ scenarioId: 's-1' }))
      .rejects.toThrow(/Ownership adjustment DLOM is PROPOSED/)
  })

  it('allowBlocking: true persists the row with hasBlockingAssumptions=true', async () => {
    primeScenario({
      assumptions: [{ key: 'growth', status: 'DRAFT' }],
    })
    const r = await runScenarioReconciliation({ scenarioId: 's-1', allowBlocking: true })
    expect(r.hasBlockingAssumptions).toBe(true)
    expect(r.blockingReasons.length).toBeGreaterThan(0)
    // A row WAS upserted with hasBlockingAssumptions=true.
    const upsertArg = vi.mocked(prisma.valuationReconciliation.upsert).mock.calls[0]![0] as any
    expect(upsertArg.create.hasBlockingAssumptions).toBe(true)
  })
})

// ─────────────────────────────────────────────────
// Happy path: every assumption is APPROVED
// ─────────────────────────────────────────────────

describe('runScenarioReconciliation — happy path', () => {
  it('computes enterprise + bridge + APPROVED ownership discount into equity value', async () => {
    primeScenario({
      assumptions: [],  // no blocking rows
      approaches: [
        { id: 'ap-1', kind: 'INCOME_DCF',  isIncluded: true, weight: '2', indicatedValue: '10000000' },
        { id: 'ap-2', kind: 'MARKET_GPCM', isIncluded: true, weight: '1', indicatedValue: '13000000' },
      ],
      bridge: [
        { category: 'CASH', label: 'cash',  amount: '1000000',  displayOrder: 0 },
        { category: 'DEBT', label: 'loans', amount: '-3000000', displayOrder: 1 },
      ],
      ownershipAdjustments: [
        { kind: 'DLOM', status: 'APPROVED', percent: '0.20', rationale: 'Restricted stock', source: 'Longstaff 2019' },
      ],
    })
    const r = await runScenarioReconciliation({ scenarioId: 's-1' })
    // Enterprise = (2/3)*10M + (1/3)*13M = 6.666... + 4.333... = 11M
    expect(r.enterpriseValue).toBe('11000000')
    expect(r.bridgeNet).toBe('-2000000')
    expect(r.equityValue).toBe('9000000')
    // DLOM = 20 % → 9M * 0.8 = 7.2M
    expect(r.ownershipDiscount).toBe('0.2')
    expect(r.ownershipValue).toBe('7200000')
    expect(r.hasBlockingAssumptions).toBe(false)
  })

  it('an APPROVED assumption does not surface in blocking (the Prisma WHERE prunes it before we see it)', async () => {
    // Real code passes { status: { in: ['DRAFT','PROPOSED','REJECTED'] } }
    // in the include — so the returned assumptions list only contains
    // rows that WOULD block. The mocked list is what the WHERE returns.
    primeScenario({ assumptions: [] })
    const r = await runScenarioReconciliation({ scenarioId: 's-1' })
    expect(r.blockingReasons).toEqual([])
    expect(r.hasBlockingAssumptions).toBe(false)
  })
})
