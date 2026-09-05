import { describe, it, expect, vi, beforeEach } from 'vitest'

// Every authz helper needs prisma + getSession. Mock them at module scope.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:              { findFirst: vi.fn() },
    document:          { findFirst: vi.fn() },
    financialValue:    { findFirst: vi.fn() },
    addBack:           { findFirst: vi.fn() },
    valuationModel:    { findFirst: vi.fn() },
    anomalyFlag:       { findFirst: vi.fn() },
    caseInsight:       { findFirst: vi.fn() },
    externalConnector: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import {
  requireSession,
  requireCaseAccess,
  requireDocumentAccess,
  requireFinancialValueAccess,
  requireAddBackAccess,
  requireValuationModelAccess,
  requireAnomalyFlagAccess,
  requireCaseInsightAccess,
  requireConnectorAccess,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/authz'

const sessionA = {
  userId: 'user-a',
  organizationId: 'org-a',
  role: 'ADMIN',
  email: 'a@a.com',
}

beforeEach(() => {
  vi.mocked(getSession).mockReset()
  Object.values(prisma).forEach((model: any) => {
    Object.values(model).forEach((fn: any) => (fn as any).mockReset?.())
  })
})

describe('requireSession', () => {
  it('throws UnauthorizedError when no session cookie is present', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('throws UnauthorizedError when the payload is missing organizationId', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'u', role: 'ADMIN', email: 'x' })
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('returns the payload for a well-formed session', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionA)
    await expect(requireSession()).resolves.toMatchObject({ organizationId: 'org-a' })
  })
})

describe('requireCaseAccess', () => {
  it('scopes the Prisma query to the session organization', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionA)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    await requireCaseAccess('case-a', 'case:read')
    expect(prisma.case.findFirst).toHaveBeenCalledWith({
      where: { id: 'case-a', organizationId: 'org-a' },
    })
  })

  it('throws NotFoundError when the case is not in the caller org (indistinguishable from missing)', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionA)
    vi.mocked(prisma.case.findFirst).mockResolvedValue(null)
    await expect(requireCaseAccess('case-b', 'case:read')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ForbiddenError when tenant checks pass but permission is missing', async () => {
    vi.mocked(getSession).mockResolvedValue({ ...sessionA, role: 'VIEWER' })
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    await expect(requireCaseAccess('case-a', 'case:create')).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('returns the case row when both tenant and permission pass', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionA)
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', name: 'Alpha' } as any)
    const { case: c } = await requireCaseAccess('case-a', 'case:read')
    expect(c.id).toBe('case-a')
  })

  it('is happy with no permission argument (session + tenant only)', async () => {
    vi.mocked(getSession).mockResolvedValue({ ...sessionA, role: 'VIEWER' })
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    await expect(requireCaseAccess('case-a')).resolves.toBeDefined()
  })
})

describe.each([
  ['document',       'document',          requireDocumentAccess],
  ['financial-value','financialValue',    requireFinancialValueAccess],
  ['addBack',        'addBack',           requireAddBackAccess],
  ['valuationModel', 'valuationModel',    requireValuationModelAccess],
  ['anomalyFlag',    'anomalyFlag',       requireAnomalyFlagAccess],
  ['caseInsight',    'caseInsight',       requireCaseInsightAccess],
] as const)('%s helper', (_label, model, helper) => {
  it('returns NotFoundError when the row is missing OR in another org', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionA)
    vi.mocked((prisma as any)[model].findFirst).mockResolvedValue(null)
    await expect((helper as any)('some-id')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('uses a case-scoped filter tied to the session org', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionA)
    vi.mocked((prisma as any)[model].findFirst).mockResolvedValue({ id: 'x' } as any)
    await (helper as any)('x')
    expect((prisma as any)[model].findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'x',
          case: { organizationId: 'org-a' },
        }),
      }),
    )
  })
})

describe('requireConnectorAccess', () => {
  it('filters by session.organizationId directly (no case relation)', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionA)
    vi.mocked(prisma.externalConnector.findFirst).mockResolvedValue({ id: 'c1' } as any)
    await requireConnectorAccess('c1')
    expect(prisma.externalConnector.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'org-a' },
    })
  })

  it('throws NotFoundError for a connector belonging to another org', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionA)
    vi.mocked(prisma.externalConnector.findFirst).mockResolvedValue(null)
    await expect(requireConnectorAccess('c-other')).rejects.toBeInstanceOf(NotFoundError)
  })
})
