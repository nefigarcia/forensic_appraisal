import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The wrapper's job:
 *   1. Insert an AiExecution row with status=RUNNING, resolved metadata,
 *      scrubbed inputHash, and the caller's DocumentVersion ids.
 *   2. On success, update the row to SUCCESS with an outputHash and
 *      duration.
 *   3. On failure, update the row to FAILURE with a categorized error
 *      and re-throw so the caller sees the exception.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiExecution: { create: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { withAIExecution, hashScrubbed } from '@/lib/ai/execution'
import { FLOW_METADATA } from '@/lib/ai/flow-metadata'

const sessionOrgA = {
  userId: 'user-a', organizationId: 'org-a', role: 'ADMIN', email: 'a@b.com', jti: 'j',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.aiExecution.create).mockResolvedValue({ id: 'exe-1' } as any)
  vi.mocked(prisma.aiExecution.update).mockResolvedValue({} as any)
})

describe('withAIExecution — happy path', () => {
  it('inserts RUNNING then updates to SUCCESS with outputHash + duration', async () => {
    const input = { documentDataUri: 'data:application/pdf;base64,AAAA', documentName: 'q1.pdf' }

    const { output, executionId } = await withAIExecution(
      { session: sessionOrgA as any, caseId: 'case-a', flowName: 'financialDocumentExtractionFlow', documentVersionIds: ['ver-1'] },
      input,
      async () => ({ extractedData: [{ lineItem: 'Revenue', value: 1_000 }] }),
    )

    expect(executionId).toBe('exe-1')
    expect(output).toEqual({ extractedData: [{ lineItem: 'Revenue', value: 1_000 }] })

    // Create call: resolved from FLOW_METADATA + scrubbed input hash.
    const createArg = vi.mocked(prisma.aiExecution.create).mock.calls[0]![0]!.data as any
    expect(createArg.organizationId).toBe('org-a')
    expect(createArg.userId).toBe('user-a')
    expect(createArg.caseId).toBe('case-a')
    expect(createArg.flowName).toBe('financialDocumentExtractionFlow')
    expect(createArg.flowVersion).toBe(FLOW_METADATA['financialDocumentExtractionFlow']!.flowVersion)
    expect(createArg.promptTemplateKey).toBe(FLOW_METADATA['financialDocumentExtractionFlow']!.promptTemplateKey)
    expect(createArg.modelName).toBe('gemini-2.5-flash')
    expect(createArg.status).toBe('RUNNING')
    expect(createArg.inputHash).toBe(hashScrubbed(input))
    expect(createArg.documentVersionIds).toEqual(['ver-1'])

    // Update call: SUCCESS + outputHash + durationMs >= 0.
    const updateArg = vi.mocked(prisma.aiExecution.update).mock.calls[0]![0]!
    expect(updateArg.where).toEqual({ id: 'exe-1' })
    const updateData = updateArg.data as any
    expect(updateData.status).toBe('SUCCESS')
    expect(updateData.outputHash).toBe(hashScrubbed({ extractedData: [{ lineItem: 'Revenue', value: 1_000 }] }))
    expect(typeof updateData.durationMs).toBe('number')
    expect(updateData.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('withAIExecution — failure', () => {
  it('updates to FAILURE with categorized error and re-throws', async () => {
    const err = Object.assign(new Error('rate limit exceeded'), { status: 429 })
    await expect(
      withAIExecution(
        { session: sessionOrgA as any, flowName: 'reportNarrativeFlow' },
        { section: 'EXECUTIVE_SUMMARY' },
        async () => { throw err },
      ),
    ).rejects.toBe(err)

    const updateData = vi.mocked(prisma.aiExecution.update).mock.calls[0]![0]!.data as any
    expect(updateData.status).toBe('FAILURE')
    expect(updateData.errorCategory).toBe('RATE_LIMIT')
    expect(updateData.errorMessage).toContain('rate limit')
  })

  it('categorizes a Zod validation failure as SCHEMA_VALIDATION', async () => {
    const err = Object.assign(new Error('Invalid schema output'), { name: 'ZodError' })
    await expect(
      withAIExecution(
        { session: sessionOrgA as any, flowName: 'anomalyDetectionFlow' },
        { foo: 'bar' },
        async () => { throw err },
      ),
    ).rejects.toBe(err)
    const updateData = vi.mocked(prisma.aiExecution.update).mock.calls[0]![0]!.data as any
    expect(updateData.errorCategory).toBe('SCHEMA_VALIDATION')
  })
})

describe('withAIExecution — chain-of-custody + secret scrub', () => {
  it('input hash never encodes secret substrings', async () => {
    const input = {
      documentDataUri: 'data:application/pdf;base64,' + 'A'.repeat(1_000),
      accessToken:     'sk_live_secret_that_must_not_survive',
      note:            'ok',
    }
    vi.mocked(prisma.aiExecution.create).mockResolvedValueOnce({ id: 'exe-1' } as any)
    await withAIExecution(
      { session: sessionOrgA as any, flowName: 'binderQueryFlow' },
      input,
      async () => ({ answer: 'ok' }),
    )
    const createArg = vi.mocked(prisma.aiExecution.create).mock.calls[0]![0]!.data as any
    // We're storing only the sha256 — assert it matches the scrubbed serialization.
    expect(createArg.inputHash).toBe(hashScrubbed(input))
    // And that changing the secret does NOT change the hash (it's dropped).
    const inputSameShapeOtherSecret = { ...input, accessToken: 'DIFFERENT-secret' }
    expect(hashScrubbed(input)).toBe(hashScrubbed(inputSameShapeOtherSecret))
  })

  it('two identical inputs across different DocumentVersions still differentiate via documentVersionIds', async () => {
    const create = vi.mocked(prisma.aiExecution.create)
    create.mockResolvedValueOnce({ id: 'exe-a' } as any).mockResolvedValueOnce({ id: 'exe-b' } as any)
    await withAIExecution(
      { session: sessionOrgA as any, flowName: 'financialDocumentExtractionFlow', documentVersionIds: ['ver-1'] },
      { documentDataUri: 'data:x;base64,AAAA', documentName: 'x' }, async () => ({}),
    )
    await withAIExecution(
      { session: sessionOrgA as any, flowName: 'financialDocumentExtractionFlow', documentVersionIds: ['ver-2'] },
      { documentDataUri: 'data:x;base64,AAAA', documentName: 'x' }, async () => ({}),
    )
    const a = create.mock.calls[0]![0]!.data as any
    const b = create.mock.calls[1]![0]!.data as any
    // Same scrubbed hash — content shape didn't change — but distinct
    // documentVersionIds preserves the "which document" signal.
    expect(a.inputHash).toBe(b.inputHash)
    expect(a.documentVersionIds).toEqual(['ver-1'])
    expect(b.documentVersionIds).toEqual(['ver-2'])
  })
})
