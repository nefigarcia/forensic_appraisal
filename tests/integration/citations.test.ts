import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── mocks ────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:            { findFirst: vi.fn() },
    document:        { findFirst: vi.fn(), update: vi.fn() },
    documentVersion: { findFirst: vi.fn(), findUnique: vi.fn() },
    financialValue:  { findFirst: vi.fn(), create: vi.fn(), createMany: vi.fn() },
    addBack:         { findFirst: vi.fn() },
    valuationModel:  { findFirst: vi.fn() },
    evidenceCitation:{ findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    // Slice 8 — runFinancialExtraction wraps the AI call in withAIExecution.
    aiExecution: {
      create: vi.fn().mockResolvedValue({ id: 'exe-cite-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/s3-client', () => {
  // Body needs a working event emitter for streamToBuffer to resolve.
  // We emit `end` on the next microtask so the extraction path returns
  // an empty buffer (its contents don't matter — the AI flow is mocked).
  const makeBody = () => ({
    on(event: string, cb: (...a: any[]) => void) {
      if (event === 'end') queueMicrotask(cb)
      return this
    },
  })
  return {
    s3Client: { send: vi.fn().mockImplementation(async () => ({ Body: makeBody() })) },
    BUCKET_NAME: 'test-bucket',
  }
})
vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/signed-url'),
}))
vi.mock('@/ai/flows/ai-financial-statement-extraction-flow', () => ({
  extractFinancialData: vi.fn(),
}))
vi.mock('@/ai/flows/ai-industry-code-suggestion-flow', () => ({ aiIndustryCodeSuggestion: vi.fn() }))
vi.mock('@/ai/flows/binder-query-flow',                 () => ({ queryBinder: vi.fn() }))
vi.mock('@/ai/flows/normalize-ttm-flow',                () => ({ normalizeTtmData: vi.fn() }))
vi.mock('@/ai/flows/anomaly-detection-flow',            () => ({ detectAnomalies: vi.fn() }))
vi.mock('@/ai/flows/insights-flow',                     () => ({ generateCaseInsights: vi.fn() }))
vi.mock('@/ai/flows/report-narrative-flow',             () => ({ generateReportNarrative: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { extractFinancialData } from '@/ai/flows/ai-financial-statement-extraction-flow'
import { runFinancialExtraction } from '@/app/actions/ai-actions'
import {
  getCitationsForFinancialValue,
  getCitationSourceUrl,
} from '@/app/actions/citations'
import { NotFoundError } from '@/lib/authz'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const sessionOrgA = { userId: 'user-a', organizationId: 'org-a', role: 'ADMIN', email: 'a@b.com', jti: 'j' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(sessionOrgA as any)
})

// ─────────────────────────────────────────────────
// runFinancialExtraction — populates EvidenceCitation rows
// ─────────────────────────────────────────────────

describe('runFinancialExtraction — citation writes', () => {
  it('creates one EvidenceCitation per extracted value, pointing at the Document.currentVersionId', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.document.findFirst).mockResolvedValue({
      id: 'doc-a', caseId: 'case-a', s3Key: 'orgs/org-a/cases/case-a/documents/doc-a/versions/1/x.pdf',
      status: 'PENDING', name: 'x.pdf', type: 'application/pdf',
      currentVersionId: 'ver-1',
      case: { id: 'case-a', organizationId: 'org-a' },
    } as any)
    vi.mocked(extractFinancialData).mockResolvedValue({
      extractedData: [
        {
          year: '2024', statementType: 'Income Statement', lineItem: 'Revenue',
          value: 1_000_000, confidence: 0.92,
          sourceRef: 'page 2, IS row Revenue',
          citation: {
            isConfident: true, pageNumber: 2,
            tableName: 'Income Statement', rowLabel: 'Revenue', columnLabel: '2024',
            boundingBox: { x: 0.1, y: 0.4, w: 0.3, h: 0.04, unit: 'norm' },
            rawText: '$1,000,000',
          },
        },
        {
          year: '2024', statementType: 'Income Statement', lineItem: 'Interest Expense',
          value: 12_345, confidence: 0.55,
          sourceRef: 'somewhere on the last few pages',
          citation: {
            isConfident: false, pageNumber: null,
            tableName: null, rowLabel: null, columnLabel: null,
            boundingBox: null, rawText: 'saw the number, could not localize',
          },
        },
      ],
    } as any)
    // FinancialValue.create returns fresh ids we control.
    vi.mocked(prisma.financialValue.create)
      .mockResolvedValueOnce({ id: 'fv-1' } as any)
      .mockResolvedValueOnce({ id: 'fv-2' } as any)
    vi.mocked(prisma.evidenceCitation.create).mockResolvedValue({} as any)
    vi.mocked(prisma.document.update).mockResolvedValue({} as any)

    await runFinancialExtraction('case-a', 'doc-a')

    // Two FinancialValue.create calls, one per item.
    expect(prisma.financialValue.create).toHaveBeenCalledTimes(2)
    // Two evidence citations, one per value.
    expect(prisma.evidenceCitation.create).toHaveBeenCalledTimes(2)

    const cite1 = vi.mocked(prisma.evidenceCitation.create).mock.calls[0]![0]!.data as any
    expect(cite1.documentVersionId).toBe('ver-1')
    expect(cite1.financialValueId).toBe('fv-1')
    expect(cite1.isConfident).toBe(true)
    expect(cite1.pageNumber).toBe(2)
    expect(cite1.extractor).toBe('ai-genkit')

    const cite2 = vi.mocked(prisma.evidenceCitation.create).mock.calls[1]![0]!.data as any
    expect(cite2.financialValueId).toBe('fv-2')
    // Anti-hallucination guard fires: even though sourceRef is present,
    // isConfident=false means NO fabricated coordinates.
    expect(cite2.isConfident).toBe(false)
    expect(cite2.pageNumber).toBeNull()
    expect(cite2.tableName).toBeNull()
    expect(cite2.boundingBox).toBeNull()
    // sourceLabel preserves the human-readable free text.
    expect(cite2.sourceLabel).toBe('somewhere on the last few pages')
  })

  it('skips citation creation when the parent document has no currentVersionId (pre-Slice-5 doc)', async () => {
    vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
    vi.mocked(prisma.document.findFirst).mockResolvedValue({
      id: 'doc-legacy', caseId: 'case-a', s3Key: 'cases/case-a/legacy.pdf',
      status: 'PENDING', name: 'x.pdf', type: 'application/pdf',
      currentVersionId: null,
      case: { id: 'case-a', organizationId: 'org-a' },
    } as any)
    vi.mocked(extractFinancialData).mockResolvedValue({
      extractedData: [{
        year: '2024', statementType: 'IS', lineItem: 'Revenue', value: 100, confidence: 0.9,
        sourceRef: 'page 1', citation: { isConfident: true, pageNumber: 1, tableName: null, rowLabel: null, columnLabel: null, boundingBox: null, rawText: null },
      }],
    } as any)
    vi.mocked(prisma.financialValue.create).mockResolvedValue({ id: 'fv-1' } as any)
    vi.mocked(prisma.document.update).mockResolvedValue({} as any)

    await runFinancialExtraction('case-a', 'doc-legacy')

    // Financial values still get written; citations are skipped when no version exists.
    expect(prisma.financialValue.create).toHaveBeenCalledOnce()
    expect(prisma.evidenceCitation.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────
// getCitationsForFinancialValue — tenant scoped
// ─────────────────────────────────────────────────

describe('getCitationsForFinancialValue', () => {
  it('refuses cross-tenant reads via requireFinancialValueAccess', async () => {
    vi.mocked(prisma.financialValue.findFirst).mockResolvedValue(null)
    await expect(getCitationsForFinancialValue('fv-b')).rejects.toBeInstanceOf(NotFoundError)
    expect(prisma.evidenceCitation.findMany).not.toHaveBeenCalled()
  })

  it('returns citations in a client-safe shape (no S3 keys leaked)', async () => {
    vi.mocked(prisma.financialValue.findFirst).mockResolvedValue({
      id: 'fv-a', caseId: 'case-a',
    } as any)
    vi.mocked(prisma.evidenceCitation.findMany).mockResolvedValue([
      {
        id: 'cite-1', documentVersionId: 'ver-1',
        pageNumber: 3, sourceLabel: 'IS Revenue',
        tableName: 'IS', rowLabel: 'Revenue', columnLabel: '2024',
        boundingBox: null, rawText: '$1M',
        extractor: 'ai-genkit', extractorVersion: 'gemini-2.5-flash-v1',
        confidence: 0.9, isConfident: true, createdAt: new Date(),
        documentVersion: { versionNumber: 2, document: { name: 'Q1.pdf' } },
      } as any,
    ])
    const rows = await getCitationsForFinancialValue('fv-a')
    expect(rows[0]!.documentName).toBe('Q1.pdf')
    expect(rows[0]!.versionNumber).toBe(2)
    // No s3Key, no sha256Hash, no internal fields
    expect(rows[0]).not.toHaveProperty('s3Key')
    expect(rows[0]).not.toHaveProperty('sha256Hash')
  })
})

// ─────────────────────────────────────────────────
// getCitationSourceUrl — page fragment discipline
// ─────────────────────────────────────────────────

describe('getCitationSourceUrl — #page= discipline', () => {
  function primeCitation(cite: {
    documentVersionId?: string; pageNumber?: number | null; isConfident?: boolean
  } = {}) {
    vi.mocked(prisma.evidenceCitation.findUnique).mockResolvedValue({
      documentVersionId: cite.documentVersionId ?? 'ver-a',
      pageNumber: cite.pageNumber ?? null,
      isConfident: cite.isConfident ?? true,
    } as any)
  }
  function primeVersion(v: {
    isArchived?: boolean; scanStatus?: string; s3Key?: string
  } = {}) {
    vi.mocked(prisma.documentVersion.findFirst).mockResolvedValue({
      id: 'ver-a',
      s3Key: v.s3Key ?? 'orgs/org-a/cases/case-a/documents/doc-a/versions/1/x.pdf',
      versionNumber: 1, sha256Hash: 'h',
      isArchived: v.isArchived ?? false,
      scanStatus: v.scanStatus ?? 'CLEAN',
      document: { id: 'doc-a', caseId: 'case-a', isArchived: false },
    } as any)
  }

  it('appends #page=N when the citation is confident AND has a page number', async () => {
    primeCitation({ pageNumber: 5, isConfident: true })
    primeVersion()
    const res = await getCitationSourceUrl('cite-1')
    expect(res.url).toBe('https://s3.example.com/signed-url#page=5')
  })

  it('does NOT append a page fragment when isConfident=false', async () => {
    primeCitation({ pageNumber: 5, isConfident: false })
    primeVersion()
    const res = await getCitationSourceUrl('cite-1')
    // Anti-hallucination: the model wasn't sure, so we don't navigate.
    expect(res.url).toBe('https://s3.example.com/signed-url')
  })

  it('does NOT append when there is no page number', async () => {
    primeCitation({ pageNumber: null, isConfident: true })
    primeVersion()
    const res = await getCitationSourceUrl('cite-1')
    expect(res.url).toBe('https://s3.example.com/signed-url')
  })

  it('refuses to sign when the DocumentVersion is archived', async () => {
    primeCitation()
    primeVersion({ isArchived: true })
    await expect(getCitationSourceUrl('cite-1')).rejects.toBeInstanceOf(NotFoundError)
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it('refuses to sign when scan status is not CLEAN', async () => {
    primeCitation()
    primeVersion({ scanStatus: 'INFECTED' })
    await expect(getCitationSourceUrl('cite-1')).rejects.toThrow(/scan status/)
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it('rejects a missing citation with NotFoundError', async () => {
    vi.mocked(prisma.evidenceCitation.findUnique).mockResolvedValue(null)
    await expect(getCitationSourceUrl('cite-x')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rejects cross-tenant version even when the citation exists', async () => {
    primeCitation({ documentVersionId: 'ver-b' })
    // Cross-tenant: version.findFirst returns null.
    vi.mocked(prisma.documentVersion.findFirst).mockResolvedValue(null)
    await expect(getCitationSourceUrl('cite-1')).rejects.toBeInstanceOf(NotFoundError)
    expect(getSignedUrl).not.toHaveBeenCalled()
  })
})
