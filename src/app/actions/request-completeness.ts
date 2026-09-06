'use server'

/**
 * AI-assisted completeness check for a request item.
 *
 * Reads the item + its attached documents, invokes the Slice-12
 * completeness flow through the Slice-8 `withAIExecution` wrapper, and
 * writes the (suggestion, isConfident, note) back to the RequestItem.
 *
 * NEVER auto-transitions the status. The reviewer sees the suggestion
 * and decides.
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError } from '@/lib/authz'
import { withAIExecution } from '@/lib/ai/execution'
import { assessCompleteness } from '@/ai/flows/request-completeness-flow'

export async function runRequestCompletenessCheck(input: { requestItemId: string }): Promise<{
  verdict:     'AUTO_COMPLETE' | 'NEEDS_HUMAN' | 'INSUFFICIENT'
  isConfident: boolean
  reason:      string
  executionId: string
}> {
  const row = await prisma.requestItem.findUnique({
    where: { id: input.requestItemId },
    include: {
      documents: {
        include: {
          document: {
            select: {
              name: true, type: true, size: true,
              currentVersion: { select: { id: true, sizeBytes: true, mimeType: true } },
            },
          },
        },
      },
    },
  })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.caseId, 'anomaly:run')

  if (row.documents.length === 0) {
    throw new Error('No documents attached — nothing to assess')
  }

  const attachedFiles = row.documents.map(rd => ({
    name:     rd.document.name,
    mimeType: rd.document.currentVersion?.mimeType ?? rd.document.type ?? undefined,
    sizeKb:   rd.document.currentVersion?.sizeBytes
      ? Number(rd.document.currentVersion.sizeBytes / BigInt(1024))
      : undefined,
  }))

  const documentVersionIds = row.documents
    .map(rd => rd.document.currentVersion?.id)
    .filter((id): id is string => !!id)

  const { output, executionId } = await withAIExecution(
    {
      session,
      caseId:   row.caseId,
      flowName: 'requestCompletenessFlow',
      documentVersionIds,
    },
    {
      requestTitle:       row.title,
      requestDescription: row.description ?? undefined,
      requestCategory:    row.category ?? undefined,
      attachedFiles,
    },
    assessCompleteness,
  )

  // Defense-in-depth: coerce output.isConfident=false → NEEDS_HUMAN.
  // Even if the model returned AUTO_COMPLETE with low confidence, the
  // reviewer's queue must still show it.
  const finalVerdict = output.isConfident ? output.verdict : 'NEEDS_HUMAN'

  await prisma.requestItem.update({
    where: { id: row.id },
    data: {
      aiCompleteness:          finalVerdict,
      aiCompletenessConfident: !!output.isConfident,
      aiCompletenessNote:      output.reason?.slice(0, 500) ?? null,
      aiExecutionId:           executionId,
    },
  })

  await logAction({
    userId: session.userId, action: 'RUN_ANOMALY_DETECTION',
    caseId: row.caseId,
    targetModel: 'RequestItem', targetId: row.id,
    note: `completeness: ${finalVerdict}${output.isConfident ? '' : ' (unconfident)'}`,
  })
  revalidatePath(`/projects/${row.caseId}`)

  return {
    verdict:     finalVerdict,
    isConfident: !!output.isConfident,
    reason:      output.reason ?? '',
    executionId,
  }
}
