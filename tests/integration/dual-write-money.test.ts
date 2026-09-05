import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:              { findFirst: vi.fn(), findUnique: vi.fn() },
    financialValue:    { findFirst: vi.fn(), update: vi.fn(), createMany: vi.fn() },
    addBack:           { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    valuationModel:    { create: vi.fn() },
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAction: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { saveValuation } from '@/app/actions/cases'
import { overrideFinancialValue, updateFinancialValue } from '@/app/actions/ai-actions'
import { createAddBack, updateAddBack } from '@/app/actions/addback-actions'
import { money } from '@/lib/money'
import { Prisma } from '@prisma/client'

const sessionOrgA = {
  userId: 'user-a', organizationId: 'org-a', role: 'ADMIN', email: 'a@b.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(sessionOrgA as any)
})

describe('FinancialValue mutations write BOTH value (Float) AND valueDecimal (Decimal)', () => {
  it('overrideFinancialValue populates both columns', async () => {
    vi.mocked(prisma.financialValue.findFirst).mockResolvedValue({
      id: 'fv-a', caseId: 'case-a', isLocked: false, value: 999,
    } as any)
    vi.mocked(prisma.financialValue.update).mockResolvedValue({} as any)

    await overrideFinancialValue('fv-a', 1234.5678, 'client override')

    const arg = vi.mocked(prisma.financialValue.update).mock.calls[0]![0]!
    expect((arg.data as any).value).toBe(1234.5678)
    expect((arg.data as any).valueDecimal).toBeInstanceOf(Prisma.Decimal)
    expect((arg.data as any).valueDecimal.toString()).toBe('1234.5678')
  })

  it('updateFinancialValue populates both columns', async () => {
    vi.mocked(prisma.financialValue.findFirst).mockResolvedValue({
      id: 'fv-a', caseId: 'case-a', isLocked: false, value: 100,
    } as any)
    vi.mocked(prisma.financialValue.update).mockResolvedValue({ caseId: 'case-a' } as any)

    await updateFinancialValue('fv-a', 42.0001, 'Revenue')

    const arg = vi.mocked(prisma.financialValue.update).mock.calls[0]![0]!
    expect((arg.data as any).value).toBe(42.0001)
    expect((arg.data as any).valueDecimal.toString()).toBe('42.0001')
  })
})

describe('AddBack mutations write BOTH Float columns AND Decimal shadow columns', () => {
  it('createAddBack populates year2Decimal / year1Decimal / ttmDecimal', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.addBack.create).mockResolvedValue({ id: 'ab-a' } as any)

    await createAddBack('case-a', {
      category: 'OWNER_COMP',
      description: 'x',
      year2: 100_000,
      year1: 110_000.5,
      ttm:   120_000.25,
    })

    const data = vi.mocked(prisma.addBack.create).mock.calls[0]![0]!.data as any
    expect(data.year2).toBe(100_000)
    expect(data.year1).toBe(110_000.5)
    expect(data.ttm).toBe(120_000.25)
    expect(data.year2Decimal.toString()).toBe('100000')
    expect(data.year1Decimal.toString()).toBe('110000.5')
    expect(data.ttmDecimal.toString()).toBe('120000.25')
  })

  it('updateAddBack respects tri-state semantics for both Float and Decimal shadows', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue({
      id: 'ab-a', caseId: 'case-a', description: 'x',
    } as any)
    vi.mocked(prisma.addBack.update).mockResolvedValue({ caseId: 'case-a' } as any)

    // Passing null explicitly should CLEAR both columns.
    await updateAddBack('ab-a', { ttm: null })
    const data = vi.mocked(prisma.addBack.update).mock.calls[0]![0]!.data as any
    expect(data.ttm).toBeNull()
    expect(data.ttmDecimal).toBeNull()
  })

  it('updateAddBack: omitting a field leaves BOTH columns unchanged', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue({
      id: 'ab-a', caseId: 'case-a', description: 'x',
    } as any)
    vi.mocked(prisma.addBack.update).mockResolvedValue({ caseId: 'case-a' } as any)

    await updateAddBack('ab-a', {}) // no fields
    const data = vi.mocked(prisma.addBack.update).mock.calls[0]![0]!.data as any
    // Float side: undefined (no-op)
    expect(data.ttm).toBeUndefined()
    // Decimal side: undefined (no-op) — matches the Float side's semantic
    expect(data.ttmDecimal).toBeUndefined()
  })
})

describe('saveValuation: authoritative server-side Decimal recompute', () => {
  it('ignores client-supplied indicatedValue and stores the server-computed Decimal', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.valuationModel.create).mockResolvedValue({ id: 'vm-a' } as any)

    // Client sends a nonsense indicatedValue (10). Server recomputes as
    // ebitda × multiplier = 1_000_000 × 5.5 = 5_500_000.
    await saveValuation('case-a', {
      valuationType: 'MARKET_APPROACH',
      ebitda:        1_000_000,
      multiplier:    5.5,
      indicatedValue: 10,   // ← the client lie
    })

    const data = vi.mocked(prisma.valuationModel.create).mock.calls[0]![0]!.data as any
    // Decimal shadow reflects the SERVER computation, not the client input.
    expect(data.indicatedValueDecimal.toString()).toBe('5500000')
    // Float legacy also reflects the server computation (kept in sync).
    expect(data.indicatedValue).toBe(5_500_000)
  })

  it('reconciles market + DCF when DCF inputs are present', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.valuationModel.create).mockResolvedValue({ id: 'vm-a' } as any)

    await saveValuation('case-a', {
      valuationType: 'HYBRID',
      ebitda:        1_000_000,
      multiplier:    6.0,
      dcfYear1: 1_000_000, dcfYear2: 1_100_000, dcfYear3: 1_200_000,
      dcfYear4: 1_300_000, dcfYear5: 1_400_000,
      discountRate:   0.20,
      terminalGrowth: 0.03,
      weight: 50, // 50 % market, 50 % DCF
    })

    const data = vi.mocked(prisma.valuationModel.create).mock.calls[0]![0]!.data as any
    // Server-computed indicatedValueDecimal is a Prisma.Decimal.
    expect(data.indicatedValueDecimal).toBeInstanceOf(Prisma.Decimal)
    // Sanity: hybrid is between market-only (6M) and roughly DCF-only.
    const v = Number(data.indicatedValueDecimal.toString())
    expect(v).toBeGreaterThan(3_000_000)
    expect(v).toBeLessThan(12_000_000)
  })

  it('falls back to market-only when discount rate is invalid (r <= g)', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.valuationModel.create).mockResolvedValue({ id: 'vm-a' } as any)

    // r == g → computeDcf throws; saveValuation swallows and defaults DCF
    // to 0, so with 100% weight to market, indicated equals market value.
    await saveValuation('case-a', {
      valuationType: 'HYBRID',
      ebitda:     1_000_000,
      multiplier: 5.0,
      dcfYear1:   500_000, dcfYear5: 500_000,
      discountRate:   0.03,
      terminalGrowth: 0.03,   // invalid; DCF collapses to 0
      weight:     100,        // all-market weighting
    })

    const data = vi.mocked(prisma.valuationModel.create).mock.calls[0]![0]!.data as any
    expect(data.indicatedValueDecimal.toString()).toBe('5000000')
  })

  it('populates every Decimal shadow for every provided Float', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.valuationModel.create).mockResolvedValue({ id: 'vm-a' } as any)

    await saveValuation('case-a', {
      valuationType: 'HYBRID',
      ebitda:            1_000_000,
      multiplier:        5.0,
      dcfYear1:          100_000,
      terminalGrowth:    0.03,
      discountRate:      0.20,
      riskFreeRate:      0.04,
      equityRiskPremium: 0.055,
      sizePremium:       0.02,
      specificRisk:      0.03,
      weight:            50,
    })

    const data = vi.mocked(prisma.valuationModel.create).mock.calls[0]![0]!.data as any
    for (const decColumn of [
      'ebitdaDecimal', 'multiplierDecimal', 'dcfYear1Decimal',
      'terminalGrowthDecimal', 'discountRateDecimal',
      'riskFreeRateDecimal', 'equityRiskPremiumDecimal',
      'sizePremiumDecimal', 'specificRiskDecimal',
      'weightDecimal', 'indicatedValueDecimal',
    ]) {
      expect(data[decColumn]).toBeInstanceOf(Prisma.Decimal)
    }
  })
})
