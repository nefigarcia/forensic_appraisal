import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Cross-tenant isolation matrix.
 *
 * Every retrofitted server action is exercised with an Org A session against
 * a resource that belongs to Org B. Each action must throw NotFoundError —
 * indistinguishable from a truly-missing id.
 *
 * Prisma, S3, and every AI flow are mocked. We do not assert on downstream
 * side effects here; the goal is: *does the tenant gate close before the
 * side effect happens?*
 */

// ─────────────────────────────────────────────────
// Module mocks (must be set up before importing the actions)
// ─────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:              { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    document:          { findFirst: vi.fn(), delete: vi.fn(), update: vi.fn(), create: vi.fn() },
    financialValue:    { findFirst: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    addBack:           { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    valuationModel:    { findFirst: vi.fn(), create: vi.fn() },
    anomalyFlag:       { findFirst: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    caseInsight:       { findFirst: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    externalConnector: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
    industryClassification: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog:          { create: vi.fn(), findMany: vi.fn() },
    organization:      { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction:  vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/s3-client',  () => ({
  s3Client:   { send: vi.fn().mockResolvedValue({ Body: { on: () => {} } }) },
  BUCKET_NAME: 'test-bucket',
}))
vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand:    vi.fn(),
  DeleteObjectCommand: vi.fn(),
  GetObjectCommand:    vi.fn(),
}))
vi.mock('@/ai/flows/ai-financial-statement-extraction-flow', () => ({ extractFinancialData:   vi.fn() }))
vi.mock('@/ai/flows/ai-industry-code-suggestion-flow',       () => ({ aiIndustryCodeSuggestion: vi.fn() }))
vi.mock('@/ai/flows/binder-query-flow',                       () => ({ queryBinder:            vi.fn() }))
vi.mock('@/ai/flows/normalize-ttm-flow',                      () => ({ normalizeTtmData:       vi.fn() }))
vi.mock('@/ai/flows/anomaly-detection-flow',                  () => ({ detectAnomalies:        vi.fn() }))
vi.mock('@/ai/flows/insights-flow',                           () => ({ generateCaseInsights:   vi.fn() }))
vi.mock('@/ai/flows/report-narrative-flow',                   () => ({ generateReportNarrative: vi.fn() }))

// ─────────────────────────────────────────────────
// Imports (after mocks)
// ─────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { NotFoundError } from '@/lib/authz'
import * as cases      from '@/app/actions/cases'
import * as documents  from '@/app/actions/documents'
import * as ai         from '@/app/actions/ai-actions'
import * as addbacks   from '@/app/actions/addback-actions'
import * as connectors from '@/app/actions/connectors'

const sessionOrgA = {
  userId: 'user-a',
  organizationId: 'org-a',
  role: 'ADMIN',
  email: 'a@a.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(sessionOrgA)
  // Default: every tenant-scoped fetch returns null (i.e. resource not in Org A).
  Object.values(prisma).forEach((model: any) => {
    if (model?.findFirst)  model.findFirst.mockResolvedValue(null)
    if (model?.findUnique) model.findUnique.mockResolvedValue(null)
  })
})

// ─────────────────────────────────────────────────
// The matrix
// ─────────────────────────────────────────────────

describe('cross-tenant enforcement — Org A cannot reach Org B resources', () => {
  describe('Case (owned by Org B)', () => {
    it('cannot read Case B — getCaseDetails throws NotFoundError', async () => {
      await expect(cases.getCaseDetails('case-b')).rejects.toBeInstanceOf(NotFoundError)
      expect(prisma.case.findFirst).toHaveBeenCalledWith({
        where: { id: 'case-b', organizationId: 'org-a' },
      })
    })

    it('cannot save valuation for Case B', async () => {
      await expect(
        cases.saveValuation('case-b', { valuationType: 'DCF' } as any),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(prisma.valuationModel.create).not.toHaveBeenCalled()
    })

    it('cannot request completeness for Case B', async () => {
      await expect(cases.getCaseCompleteness('case-b')).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('Document (owned by Org B)', () => {
    it('cannot upload into Case B', async () => {
      const fd = new FormData()
      fd.set('file', new Blob(['x']) as any, 'x.pdf')
      fd.set('name', 'x.pdf')
      fd.set('type', 'pdf')
      await expect(documents.addDocument('case-b', fd)).rejects.toBeInstanceOf(NotFoundError)
      expect(prisma.document.create).not.toHaveBeenCalled()
    })

    it('cannot delete Document B', async () => {
      await expect(documents.deleteDocument('doc-b')).rejects.toBeInstanceOf(NotFoundError)
      expect(prisma.document.delete).not.toHaveBeenCalled()
    })

    it('cannot extract Document B (documentId form)', async () => {
      await expect(ai.runFinancialExtraction('case-b', 'doc-b')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('cannot extract Case B (caseId-only form)', async () => {
      await expect(ai.runFinancialExtraction('case-b')).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('FinancialValue (owned by Org B)', () => {
    it.each([
      ['acceptFinancialValue',    async () => ai.acceptFinancialValue('fv-b')],
      ['overrideFinancialValue',  async () => ai.overrideFinancialValue('fv-b', 10, 'reason')],
      ['rejectFinancialValue',    async () => ai.rejectFinancialValue('fv-b', 'reason')],
      ['toggleLockFinancialValue',async () => ai.toggleLockFinancialValue('fv-b')],
      ['updateFinancialValue',    async () => ai.updateFinancialValue('fv-b', 10, 'Revenue')],
    ])('%s throws NotFoundError', async (_name, run) => {
      await expect(run()).rejects.toBeInstanceOf(NotFoundError)
      expect(prisma.financialValue.update).not.toHaveBeenCalled()
    })

    it('cannot batch-approve Case B values', async () => {
      await expect(
        ai.approveFinancialValues('case-b', 'Income Statement', '2024'),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(prisma.financialValue.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('AddBack (owned by Org B)', () => {
    it('cannot list add-backs for Case B', async () => {
      await expect(addbacks.getAddBacks('case-b')).rejects.toBeInstanceOf(NotFoundError)
    })
    it('cannot create an add-back on Case B', async () => {
      await expect(
        addbacks.createAddBack('case-b', { category: 'OWNER_COMP', description: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(prisma.addBack.create).not.toHaveBeenCalled()
    })
    it('cannot update AddBack B', async () => {
      await expect(addbacks.updateAddBack('addback-b', { ttm: 1 })).rejects.toBeInstanceOf(NotFoundError)
      expect(prisma.addBack.update).not.toHaveBeenCalled()
    })
    it('cannot delete AddBack B', async () => {
      await expect(addbacks.deleteAddBack('addback-b')).rejects.toBeInstanceOf(NotFoundError)
      expect(prisma.addBack.delete).not.toHaveBeenCalled()
    })
    it('cannot approve AddBack B', async () => {
      await expect(addbacks.approveAddBack('addback-b')).rejects.toBeInstanceOf(NotFoundError)
      expect(prisma.addBack.update).not.toHaveBeenCalled()
    })
  })

  describe('AI / report / audit surfaces on Case B', () => {
    it('cannot ask the binder for Case B', async () => {
      await expect(ai.askBinder('case-b', 'anything?')).rejects.toBeInstanceOf(NotFoundError)
    })
    it('cannot run industry analysis on Case B', async () => {
      await expect(ai.runIndustryAnalysis('case-b', 'desc')).rejects.toBeInstanceOf(NotFoundError)
    })
    it('cannot run TTM normalization on Case B', async () => {
      await expect(ai.runTtmNormalization('case-b')).rejects.toBeInstanceOf(NotFoundError)
    })
    it('cannot run anomaly detection on Case B', async () => {
      await expect(ai.runAnomalyDetection('case-b')).rejects.toBeInstanceOf(NotFoundError)
    })
    it('cannot resolve an anomaly flag on Case B', async () => {
      await expect(
        ai.resolveAnomalyFlag('flag-b', 'ok', 'INVESTIGATED'),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
    it('cannot refresh insights on Case B', async () => {
      await expect(ai.refreshCaseInsights('case-b')).rejects.toBeInstanceOf(NotFoundError)
    })
    it('cannot dismiss an insight on Case B', async () => {
      await expect(ai.dismissInsight('insight-b')).rejects.toBeInstanceOf(NotFoundError)
    })
    it('cannot draft a report section for Case B', async () => {
      await expect(
        ai.draftReportSection('case-b', 'EXECUTIVE_SUMMARY'),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
    it('cannot read the audit log for Case B', async () => {
      await expect(ai.getAuditLog('case-b')).rejects.toBeInstanceOf(NotFoundError)
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
    })
  })

  describe('Connector (owned by Org B)', () => {
    it('cannot fetch Connector B by id', async () => {
      await expect(connectors.getConnector('conn-b')).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})

// ─────────────────────────────────────────────────
// Positive path — Org A CAN reach its own resources
// (guards against my helpers being tighter than intended)
// ─────────────────────────────────────────────────

describe('positive path — Org A can reach Org A resources', () => {
  it('getCaseDetails succeeds for a case in Org A', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.case.findUnique).mockResolvedValue({
      id: 'case-a', organizationId: 'org-a', documents: [], financialData: [],
      addBacks: [], valuationModels: [], anomalyFlags: [], insights: [], industry: null,
    } as any)
    await expect(cases.getCaseDetails('case-a')).resolves.toMatchObject({ id: 'case-a' })
  })

  it('acceptFinancialValue succeeds for a value in Org A', async () => {
    vi.mocked(prisma.financialValue.findFirst).mockResolvedValue({
      id: 'fv-a', caseId: 'case-a', isLocked: false,
    } as any)
    vi.mocked(prisma.financialValue.update).mockResolvedValue({ id: 'fv-a' } as any)
    await expect(ai.acceptFinancialValue('fv-a')).resolves.toBeUndefined()
    expect(prisma.financialValue.update).toHaveBeenCalledOnce()
  })

  it('deleteAddBack succeeds for an addback in Org A', async () => {
    vi.mocked(prisma.addBack.findFirst).mockResolvedValue({
      id: 'ab-a', caseId: 'case-a', description: 'meals',
    } as any)
    vi.mocked(prisma.addBack.delete).mockResolvedValue({} as any)
    await expect(addbacks.deleteAddBack('ab-a')).resolves.toBeUndefined()
    expect(prisma.addBack.delete).toHaveBeenCalledWith({ where: { id: 'ab-a' } })
  })
})

// ─────────────────────────────────────────────────
// Unauthenticated (no session) — non-mutating readers degrade to []/null;
// every mutation refuses.
// ─────────────────────────────────────────────────

describe('no session — mutations refuse, list readers degrade gracefully', () => {
  beforeEach(() => {
    vi.mocked(getSession).mockResolvedValue(null)
  })

  it('getCases returns [] without querying by "any" org', async () => {
    const rows = await cases.getCases()
    expect(rows).toEqual([])
    expect(prisma.case.findMany).not.toHaveBeenCalled()
  })

  it('searchCases returns [] without querying', async () => {
    const rows = await cases.searchCases('foo')
    expect(rows).toEqual([])
    expect(prisma.case.findMany).not.toHaveBeenCalled()
  })

  it('any mutation refuses (getCaseDetails is a read but uses requireCaseAccess)', async () => {
    await expect(cases.getCaseDetails('case-a')).rejects.toThrow()
    await expect(documents.deleteDocument('doc-a')).rejects.toThrow()
    await expect(ai.overrideFinancialValue('fv-a', 1, 'r')).rejects.toThrow()
    await expect(addbacks.approveAddBack('ab-a')).rejects.toThrow()
  })
})
