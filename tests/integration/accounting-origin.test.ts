/**
 * LOAD-BEARING: promoting a QBO / Xero / Sage / NetSuite / Excel
 * source row into a `FinancialValue` stamps `origin` with the
 * provider name. This preserves the "do not mix QBO values with
 * AI-extracted values without showing origin" invariant.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:                  { findFirst: vi.fn() },
    caseMember:            { findUnique: vi.fn() },
    accountingSourceRow:   { findUnique: vi.fn(), update: vi.fn() },
    financialValue:        { create: vi.fn() },
    $transaction:          vi.fn(async (fn: any) => fn({
      financialValue:      { create: vi.fn() },
      accountingSourceRow: { update: vi.fn() },
    })),
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { promoteSourceRow } from '@/app/actions/accounting-connectors'

const editor = { userId: 'user-e', organizationId: 'org-1', role: 'EDITOR', email: 'e@x', jti: 'j' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(editor as any)
  vi.mocked(prisma.case.findFirst).mockResolvedValue({
    id: 'case-1', organizationId: 'org-1', hasEngagementTeam: false,
  } as any)
})

describe('promoteSourceRow — origin tagging', () => {
  it('stamps FinancialValue.origin = provider and points sourceRowId at the row', async () => {
    vi.mocked(prisma.accountingSourceRow.findUnique).mockResolvedValue({
      id: 'sr-1', case: { id: 'case-1' },
      provider: 'QUICKBOOKS',
      amountDecimal: '10000',
      currency: 'USD',
    } as any)
    let created: any = null
    let sourceUpdated: any = null
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      return fn({
        financialValue: {
          create: (args: any) => { created = args; return Promise.resolve({ id: 'fv-1' }) },
        },
        accountingSourceRow: {
          update: (args: any) => { sourceUpdated = args },
        },
      })
    })
    await promoteSourceRow({
      sourceRowId:   'sr-1',
      year:          '2024',
      statementType: 'IS',
      lineItem:      'Revenue',
    })
    // Origin comes from the source row's provider, NEVER defaults to 'AI'.
    expect(created.data.origin).toBe('QUICKBOOKS')
    expect(created.data.sourceRowId).toBe('sr-1')
    // Fresh promotion is unverified/unlocked — a human still has to
    // approve the value.
    expect(created.data.isVerified).toBe(false)
    expect(created.data.isLocked).toBe(false)
    // The source row is flipped to PROMOTED so it does not accidentally
    // fold in twice.
    expect(sourceUpdated.data.status).toBe('PROMOTED')
  })

  it('works for any provider — origin follows the source row', async () => {
    for (const provider of ['XERO', 'SAGE', 'NETSUITE', 'EXCEL'] as const) {
      vi.mocked(prisma.accountingSourceRow.findUnique).mockResolvedValue({
        id: `sr-${provider}`, case: { id: 'case-1' },
        provider, amountDecimal: '100', currency: 'USD',
      } as any)
      let created: any = null
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn({
        financialValue: { create: (args: any) => { created = args; return Promise.resolve({ id: 'fv-x' }) } },
        accountingSourceRow: { update: vi.fn() },
      }))
      await promoteSourceRow({
        sourceRowId: `sr-${provider}`, year: '2024', statementType: 'IS', lineItem: 'x',
      })
      expect(created.data.origin).toBe(provider)
    }
  })
})
