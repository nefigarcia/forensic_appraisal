import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiExecution: {
      findMany:   vi.fn(),
      findFirst:  vi.fn(),
      update:     vi.fn(),
    },
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import {
  getRecentAiExecutions,
  getAiExecutionDetail,
  setAiExecutionReviewStatus,
} from '@/app/actions/ai-executions'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '@/lib/authz'

const adminSession = {
  userId: 'user-a', organizationId: 'org-a', role: 'ADMIN', email: 'a@b.com', jti: 'j',
}
const editorSession = {
  userId: 'user-b', organizationId: 'org-a', role: 'EDITOR', email: 'b@b.com', jti: 'j',
}

beforeEach(() => { vi.clearAllMocks() })

describe('getRecentAiExecutions — admin gating', () => {
  it('refuses an unauthenticated caller', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    await expect(getRecentAiExecutions()).rejects.toBeInstanceOf(UnauthorizedError)
    expect(prisma.aiExecution.findMany).not.toHaveBeenCalled()
  })

  it('refuses a non-admin caller with ForbiddenError', async () => {
    vi.mocked(getSession).mockResolvedValue(editorSession as any)
    await expect(getRecentAiExecutions()).rejects.toBeInstanceOf(ForbiddenError)
    expect(prisma.aiExecution.findMany).not.toHaveBeenCalled()
  })

  it('scopes reads to the admin\'s organization', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession as any)
    vi.mocked(prisma.aiExecution.findMany).mockResolvedValue([] as any)
    await getRecentAiExecutions()
    const arg = vi.mocked(prisma.aiExecution.findMany).mock.calls[0]![0]!
    expect(arg.where).toMatchObject({ organizationId: 'org-a' })
  })

  it('applies the flowName / status / caseId filters when supplied', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession as any)
    vi.mocked(prisma.aiExecution.findMany).mockResolvedValue([] as any)
    await getRecentAiExecutions({ flowName: 'binderQueryFlow', status: 'FAILURE', caseId: 'case-x' })
    const arg = vi.mocked(prisma.aiExecution.findMany).mock.calls[0]![0]!
    expect(arg.where).toMatchObject({
      organizationId: 'org-a',
      flowName: 'binderQueryFlow',
      status: 'FAILURE',
      caseId: 'case-x',
    })
  })

  it('clamps the limit to [1, 200]', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession as any)
    vi.mocked(prisma.aiExecution.findMany).mockResolvedValue([] as any)
    await getRecentAiExecutions({ limit: 500 })
    expect(vi.mocked(prisma.aiExecution.findMany).mock.calls[0]![0]!.take).toBe(200)
    await getRecentAiExecutions({ limit: -50 })
    expect(vi.mocked(prisma.aiExecution.findMany).mock.calls[1]![0]!.take).toBe(1)
  })
})

describe('getAiExecutionDetail — tenant + summary', () => {
  it('refuses a cross-org id with NotFoundError (org-scoped findFirst returns null)', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession as any)
    vi.mocked(prisma.aiExecution.findFirst).mockResolvedValue(null)
    await expect(getAiExecutionDetail('exe-other-org')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('summarizes FinancialValue reviewStatus counts', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession as any)
    vi.mocked(prisma.aiExecution.findFirst).mockResolvedValue({
      id: 'exe-1', organizationId: 'org-a',
      flowName: 'financialDocumentExtractionFlow', flowVersion: 'v1-slice7',
      promptTemplateKey: 'extract-financial-data.v2-citations',
      modelProvider: 'googleai', modelName: 'gemini-2.5-flash', modelVersion: null,
      status: 'SUCCESS', reviewStatus: 'PENDING',
      startedAt: new Date(), completedAt: new Date(), durationMs: 1234,
      errorCategory: null, errorMessage: null,
      inputHash: 'x'.repeat(64), outputHash: 'y'.repeat(64),
      documentVersionIds: ['ver-1', 'ver-2'],
      inputTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: null,
      user: { email: 'a@b.com' }, case: { name: 'Alpha Case' },
      financialValues: [
        { reviewStatus: 'PENDING' },
        { reviewStatus: 'ACCEPTED' },
        { reviewStatus: 'ACCEPTED' },
        { reviewStatus: 'OVERRIDDEN' },
        { reviewStatus: 'REJECTED' },
      ],
    } as any)

    const detail = await getAiExecutionDetail('exe-1')
    expect(detail.financialValueSummary).toEqual({
      total: 5, pending: 1, accepted: 2, overridden: 1, rejected: 1,
    })
    expect(detail.documentVersionIds).toEqual(['ver-1', 'ver-2'])
    expect(detail.userEmail).toBe('a@b.com')
    expect(detail.caseName).toBe('Alpha Case')
  })
})

describe('setAiExecutionReviewStatus', () => {
  it('refuses non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(editorSession as any)
    await expect(setAiExecutionReviewStatus('exe-1', 'ACCEPTED')).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses a cross-org id', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession as any)
    vi.mocked(prisma.aiExecution.findFirst).mockResolvedValue(null)
    await expect(setAiExecutionReviewStatus('exe-other', 'ACCEPTED')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('persists the verdict + reviewer + timestamp for a valid org-scoped id', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession as any)
    vi.mocked(prisma.aiExecution.findFirst).mockResolvedValue({ id: 'exe-1' } as any)
    vi.mocked(prisma.aiExecution.update).mockResolvedValue({} as any)
    await setAiExecutionReviewStatus('exe-1', 'OVERRIDDEN')
    const arg = vi.mocked(prisma.aiExecution.update).mock.calls[0]![0]!.data as any
    expect(arg.reviewStatus).toBe('OVERRIDDEN')
    expect(arg.reviewedBy).toBe('user-a')
    expect(arg.reviewedAt).toBeInstanceOf(Date)
  })
})
