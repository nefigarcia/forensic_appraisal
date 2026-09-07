import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:            { findFirst: vi.fn() },
    financialValue:  { findMany: vi.fn() },
    tieOut: {
      findMany:   vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(),
      upsert:     vi.fn(),
    },
    tieOutItem: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => {
      const tx = {
        tieOut: {
          findUnique: vi.mocked((prisma as any).tieOut.findUnique),
          upsert:     vi.mocked((prisma as any).tieOut.upsert),
        },
        tieOutItem: {
          deleteMany: vi.mocked((prisma as any).tieOutItem.deleteMany),
          createMany: vi.mocked((prisma as any).tieOutItem.createMany),
        },
      }
      return fn(tx)
    }),
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import {
  getTieOutsForCase,
  runTieOutsForCase,
  resolveTieOut,
  reopenTieOut,
} from '@/app/actions/tie-outs'
import { NotFoundError } from '@/lib/authz'

const sessionOrgA = { userId: 'user-a', organizationId: 'org-a', role: 'ADMIN', email: 'a@b.com', jti: 'j' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(sessionOrgA as any)
})

// ─────────────────────────────────────────────────
// Cross-tenant refusal
// ─────────────────────────────────────────────────

describe('tenant scoping', () => {
  it('getTieOutsForCase refuses cross-org', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValueOnce(null) // not in org A
    await expect(getTieOutsForCase('case-b')).rejects.toBeInstanceOf(NotFoundError)
    expect(prisma.tieOut.findMany).not.toHaveBeenCalled()
  })

  it('runTieOutsForCase refuses cross-org', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValueOnce(null)
    await expect(runTieOutsForCase('case-b')).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ─────────────────────────────────────────────────
// getTieOutsForCase — sort discipline
// ─────────────────────────────────────────────────

describe('getTieOutsForCase — discrepancies always sort first', () => {
  it('reorders DB output so DISCREPANCY beats every other status regardless of alphabetic sort', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.tieOut.findMany).mockResolvedValue([
      row('t1', 'CASH',       '2024', 'TIED',             '0'),
      row('t2', 'REVENUE',    '2024', 'DISCREPANCY',      '15000'),
      row('t3', 'EBITDA',     '2024', 'WITHIN_TOLERANCE', '250'),
      row('t4', 'NET_INCOME', '2024', 'RESOLVED',         '2500'),
      row('t5', 'ACCOUNTS_RECEIVABLE', '2024', 'UNRESOLVED', '0'),
    ] as any)
    const out = await getTieOutsForCase('case-a')
    expect(out.map(r => r.status)).toEqual([
      'DISCREPANCY',       // rev
      'UNRESOLVED',        // AR
      'RESOLVED',          // NI
      'WITHIN_TOLERANCE',  // EBITDA
      'TIED',              // cash
    ])
  })
})

// ─────────────────────────────────────────────────
// runTieOutsForCase — build from classified FinancialValues
// ─────────────────────────────────────────────────

describe('runTieOutsForCase', () => {
  it('groups values by (concept, year) using the classifier', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.financialValue.findMany).mockResolvedValue([
      fv('Revenue',        '2024', 'Tax Return',       '4821309', 'doc-tax', 'ver-tax'),
      fv('Total Revenue',  '2024', 'Income Statement', '4821309', 'doc-is',  'ver-is'),
      fv('Gross Receipts or Sales', '2024', 'GL',      '4821307', 'doc-gl',  'ver-gl'),
      fv('Cash',           '2024', 'Balance Sheet',    '100000',  'doc-bs',  'ver-bs'),
      fv('Miscellaneous Line — unclassified', '2024', 'X', '1', 'doc-x', 'ver-x'),
    ] as any)
    vi.mocked(prisma.tieOut.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.tieOut.upsert).mockResolvedValue({ id: 'to-1' } as any)
    vi.mocked(prisma.tieOutItem.deleteMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.tieOutItem.createMany).mockResolvedValue({ count: 3 } as any)

    const res = await runTieOutsForCase('case-a')

    // Two groups: Revenue (3 sources) + Cash (1 source). Miscellaneous skipped.
    expect(res.built).toBe(2)
    expect(res.concepts).toBe(2)
    expect(prisma.tieOut.upsert).toHaveBeenCalledTimes(2)

    // Revenue upsert carried the correct status computation.
    const revenueUpsert = vi.mocked(prisma.tieOut.upsert).mock.calls.find(
      c => (c[0]!.where as any).caseId_concept_year?.concept === 'REVENUE',
    )!
    const createData = revenueUpsert[0]!.create as any
    expect(createData.concept).toBe('REVENUE')
    expect(createData.year).toBe('2024')
    // maxDifference across 4_821_309 / 4_821_309 / 4_821_307 = 2 → WITHIN_TOLERANCE
    expect(createData.status).toBe('WITHIN_TOLERANCE')
    expect(createData.maxDifference.toString()).toBe('2')

    // Cash has only one source → UNRESOLVED (never auto-hidden).
    const cashUpsert = vi.mocked(prisma.tieOut.upsert).mock.calls.find(
      c => (c[0]!.where as any).caseId_concept_year?.concept === 'CASH',
    )!
    expect((cashUpsert[0]!.create as any).status).toBe('UNRESOLVED')
  })

  it('NEVER auto-hides a discrepancy that a rebuild would otherwise fix', async () => {
    // Existing tie-out is RESOLVED. The classifier finds new values that
    // now tie exactly. Rule: the reviewer's explicit RESOLVED verdict is
    // preserved. But even if the row moved back to a green state, it
    // should never *silently* transition to TIED and hide the history.
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.financialValue.findMany).mockResolvedValue([
      fv('Revenue',   '2024', 'IS', '100', 'd1', 'v1'),
      fv('Net Sales', '2024', 'GL', '100', 'd2', 'v2'),
    ] as any)
    vi.mocked(prisma.tieOut.findUnique).mockResolvedValue({
      id: 't-existing', status: 'RESOLVED', concept: 'REVENUE', year: '2024',
    } as any)
    vi.mocked(prisma.tieOut.upsert).mockResolvedValue({ id: 't-existing' } as any)
    vi.mocked(prisma.tieOutItem.deleteMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prisma.tieOutItem.createMany).mockResolvedValue({ count: 2 } as any)

    await runTieOutsForCase('case-a')

    // The upsert.update must keep status=RESOLVED even though the
    // deterministic engine would have said TIED.
    const upsertCall = vi.mocked(prisma.tieOut.upsert).mock.calls[0]!
    expect((upsertCall[0]!.update as any).status).toBe('RESOLVED')
  })

  it('a rebuild that produces a DISCREPANCY sets DISCREPANCY (no auto-hide the other direction either)', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.financialValue.findMany).mockResolvedValue([
      fv('Revenue',      '2024', 'IS', '5000000',  'd1', 'v1'),
      fv('Total Revenue','2024', 'GL', '5100000',  'd2', 'v2'),
    ] as any)
    // Existing was TIED — but the new values are $100k apart, well past
    // Revenue tolerance. Must transition to DISCREPANCY, not stay TIED.
    vi.mocked(prisma.tieOut.findUnique).mockResolvedValue({
      id: 't-existing', status: 'TIED', concept: 'REVENUE', year: '2024',
    } as any)
    vi.mocked(prisma.tieOut.upsert).mockResolvedValue({ id: 't-existing' } as any)
    vi.mocked(prisma.tieOutItem.deleteMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.tieOutItem.createMany).mockResolvedValue({ count: 2 } as any)

    await runTieOutsForCase('case-a')
    const upsertCall = vi.mocked(prisma.tieOut.upsert).mock.calls[0]!
    expect((upsertCall[0]!.update as any).status).toBe('DISCREPANCY')
  })
})

// ─────────────────────────────────────────────────
// resolveTieOut — human-only, requires note, silent no-op for green states
// ─────────────────────────────────────────────────

describe('resolveTieOut', () => {
  it('requires a non-empty note', async () => {
    await expect(resolveTieOut('t-1', '')).rejects.toThrow(/note/i)
    await expect(resolveTieOut('t-1', '   ')).rejects.toThrow(/note/i)
  })

  it('refuses a non-existent tie-out', async () => {
    vi.mocked(prisma.tieOut.findUnique).mockResolvedValue(null)
    await expect(resolveTieOut('t-none', 'reason')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses cross-org', async () => {
    vi.mocked(prisma.tieOut.findUnique).mockResolvedValue({ caseId: 'case-b', status: 'DISCREPANCY' } as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue(null) // not in org A
    await expect(resolveTieOut('t-b', 'reason')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('marks a DISCREPANCY as RESOLVED with reviewer + timestamp + note', async () => {
    vi.mocked(prisma.tieOut.findUnique).mockResolvedValue({ caseId: 'case-a', status: 'DISCREPANCY' } as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.tieOut.update).mockResolvedValue({} as any)

    await resolveTieOut('t-1', '$2 timing diff between GL close and P&L run — immaterial.')

    const updateData = vi.mocked(prisma.tieOut.update).mock.calls[0]![0]!.data as any
    expect(updateData.status).toBe('RESOLVED')
    expect(updateData.resolvedBy).toBe('user-a')
    expect(updateData.resolvedAt).toBeInstanceOf(Date)
    expect(updateData.resolutionNote).toContain('timing diff')
  })

  it('silently no-ops for TIED / WITHIN_TOLERANCE (button should not have appeared)', async () => {
    vi.mocked(prisma.tieOut.findUnique).mockResolvedValue({ caseId: 'case-a', status: 'TIED' } as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    await resolveTieOut('t-1', 'irrelevant')
    expect(prisma.tieOut.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────
// reopenTieOut — recomputes status, never silently forces TIED
// ─────────────────────────────────────────────────

describe('reopenTieOut', () => {
  it('clears reviewer fields and recomputes status from current items', async () => {
    vi.mocked(prisma.tieOut.findUnique).mockResolvedValue({
      caseId: 'case-a', status: 'RESOLVED', concept: 'REVENUE', year: '2024',
      toleranceAbsolute: null, tolerancePercent: null,
      items: [
        { value: { toString: () => '5000000' } },
        { value: { toString: () => '5100000' } },
      ],
    } as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.tieOut.update).mockResolvedValue({} as any)

    await reopenTieOut('t-1')
    const updateData = vi.mocked(prisma.tieOut.update).mock.calls[0]![0]!.data as any
    // Values 100k apart on 5M base → outside Revenue tolerance → DISCREPANCY.
    expect(updateData.status).toBe('DISCREPANCY')
    expect(updateData.resolvedBy).toBeNull()
    expect(updateData.resolvedAt).toBeNull()
    expect(updateData.resolutionNote).toBeNull()
  })

  it('silently no-ops when the row was not RESOLVED', async () => {
    vi.mocked(prisma.tieOut.findUnique).mockResolvedValue({
      caseId: 'case-a', status: 'TIED', items: [],
    } as any)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    await reopenTieOut('t-1')
    expect(prisma.tieOut.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

function row(id: string, concept: string, year: string, status: string, maxDiff: string) {
  return {
    id, concept, year, status,
    maxDifference: { toString: () => maxDiff },
    toleranceAbsolute: null,
    tolerancePercent:  null,
    resolvedBy: null, resolvedAt: null, resolutionNote: null,
    updatedAt: new Date(),
    items: [],
  }
}
function fv(lineItem: string, year: string, statementType: string, value: string, _docId: string, versionId: string) {
  // Slice-4's readMoney prefers valueDecimal; we pass a plain string so the
  // decimal.js constructor accepts it. Legacy Float `value` is number.
  return {
    id: `fv-${lineItem.slice(0,3)}-${statementType.slice(0,2)}`,
    lineItem, year, statementType,
    value: Number(value), valueDecimal: value,
    document: { currentVersionId: versionId },
  }
}
