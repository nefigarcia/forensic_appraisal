'use server'

/**
 * ReportSection drafting + approval workflow.
 *
 * The invariants this file enforces:
 *   1. AI drafts are grounded — the flow only sees the section's
 *      scoped subset of the APPROVED-only ReportFacts payload
 *      (see `src/lib/reports/facts.ts::scopeForSection`).
 *   2. Every citation the AI returns is validated against the payload;
 *      unknown citations are dropped (see `citation-validator.ts`).
 *   3. AI wrapping goes through Slice-8 `withAIExecution` so every
 *      draft creates a traceable AiExecution row.
 *   4. Approving a section requires:
 *        - `report:generate` permission
 *        - a reviewer distinct from the author of the current version
 *        - the current body's factsHash matches the current facts
 *          (no approving stale drafts).
 *   5. Editing an APPROVED section drops it back to HUMAN_EDITING —
 *      never straight to READY_FOR_REVIEW.
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError, ForbiddenError } from '@/lib/authz'
import {
  isReportSectionKey, isReportSectionStatus,
  canSectionTransition,
  SECTION_CATALOG,
  type ReportSectionKey,
} from '@/lib/reports/sections'
import {
  buildReportFacts,
  scopeForSection,
} from '@/lib/reports/facts'
import { validateCitations, type CandidateCitation } from '@/lib/reports/citation-validator'
import { withAIExecution } from '@/lib/ai/execution'
import { generateGroundedSectionNarrative } from '@/ai/flows/report-section-narrative-flow'

// ─────────────────────────────────────────────────
// Section reads
// ─────────────────────────────────────────────────

export interface SectionVersionForClient {
  id:                string
  status:            string
  body:              string
  isConfident:       boolean
  factsHash:         string | null
  missingInformation: string[] | null
  aiExecutionId:     string | null
  authorUserId:      string
  approvedBy:        string | null
  approvedAt:        Date | null
  createdAt:         Date
  citations: Array<{
    id: string; targetType: string; targetId: string; snippet: string | null; isConfident: boolean
  }>
}

export async function getSectionVersions(input: { sectionId: string }): Promise<SectionVersionForClient[]> {
  const section = await prisma.reportSection.findUnique({
    where: { id: input.sectionId },
    include: { report: { select: { caseId: true } } },
  })
  if (!section) throw new NotFoundError()
  await requireCaseAccess(section.report.caseId, 'case:read')

  const rows = await prisma.reportSectionVersion.findMany({
    where: { sectionId: input.sectionId },
    orderBy: { createdAt: 'desc' },
    include: { citations: true },
  })
  return rows.map(r => ({
    id:            r.id,
    status:        r.status,
    body:          r.body,
    isConfident:   r.isConfident,
    factsHash:     r.factsHash,
    missingInformation: (r.missingInformation as string[] | null) ?? null,
    aiExecutionId: r.aiExecutionId,
    authorUserId:  r.authorUserId,
    approvedBy:    r.approvedBy,
    approvedAt:    r.approvedAt,
    createdAt:     r.createdAt,
    citations: r.citations.map(c => ({
      id: c.id, targetType: c.targetType, targetId: c.targetId,
      snippet: c.snippet, isConfident: c.isConfident,
    })),
  }))
}

// ─────────────────────────────────────────────────
// AI draft
// ─────────────────────────────────────────────────

export interface DraftSectionResult {
  sectionVersionId:  string
  aiExecutionId:     string
  isConfident:       boolean
  missingInformation: string[]
  citationsSaved:    number
  citationsDropped:  number
  factsHash:         string
}

/**
 * Ask the AI to draft the given section against the CURRENT approved
 * facts. Persists an immutable ReportSectionVersion in status
 * `AI_DRAFTED`. The section's current* pointers are updated to point
 * at the fresh draft.
 *
 * Refuses when the caller passes an unknown section key or when the
 * report is `FINAL` (no more edits).
 */
export async function draftSectionWithAI(input: {
  sectionId: string
}): Promise<DraftSectionResult> {
  const section = await prisma.reportSection.findUnique({
    where: { id: input.sectionId },
    include: {
      report: { select: { id: true, caseId: true, status: true } },
    },
  })
  if (!section) throw new NotFoundError()
  if (!isReportSectionKey(section.key)) throw new Error(`Unknown section key: ${section.key}`)
  if (section.report.status === 'FINAL') throw new Error('Report is FINAL — cannot draft')

  const { session } = await requireCaseAccess(section.report.caseId, 'report:generate')
  const sectionKey = section.key as ReportSectionKey

  // Build the approved-only payload and scope it to the section.
  const { payload, factsHash } = await buildReportFacts(section.report.caseId)
  const scoped = scopeForSection(payload, sectionKey)

  // Fact index handed to the AI so it knows the legitimate citation ids.
  const factIndex: Array<{ type: string; id: string }> = []
  scoped.financials?.values.forEach(v => factIndex.push({ type: 'FINANCIAL_VALUE', id: v.id }))
  scoped.normalization?.approvedAddBacks.forEach(a => factIndex.push({ type: 'ADDBACK', id: a.id }))
  scoped.assumptions?.approved.forEach(a => factIndex.push({ type: 'VALUATION_ASSUMPTION', id: a.id }))
  scoped.ownership?.approvedAdjustments.forEach(o => factIndex.push({ type: 'OWNERSHIP_ADJUSTMENT', id: o.id }))
  scoped.valuation?.scenarios.forEach(s => factIndex.push({ type: 'RECONCILIATION', id: s.scenarioId }))
  scoped.evidence?.documents.forEach(d => {
    if (d.currentVersionId) factIndex.push({ type: 'DOCUMENT_VERSION', id: d.currentVersionId })
  })
  scoped.evidence?.citations.forEach(c => factIndex.push({ type: 'EVIDENCE_CITATION', id: c.id }))

  const meta = SECTION_CATALOG[sectionKey]

  // DocumentVersionIds — used by AiExecution for provenance.
  const documentVersionIds = (scoped.evidence?.documents ?? [])
    .map(d => d.currentVersionId)
    .filter((id): id is string => !!id)

  const { output, executionId } = await withAIExecution(
    {
      session,
      caseId:   section.report.caseId,
      flowName: 'reportSectionNarrativeV2Flow',
      documentVersionIds,
    },
    {
      sectionKey,
      sectionTitle: meta.title,
      guidance:     meta.guidance,
      factsJson:    JSON.stringify(scoped),
      factIndex:    JSON.stringify(factIndex),
    },
    generateGroundedSectionNarrative,
  )

  // Validate citations against the fact index — drop any hallucinated ones.
  const validation = validateCitations(
    (output.citations ?? []) as CandidateCitation[],
    scoped,
  )

  // Defense-in-depth: if the AI returned isConfident=true but the
  // narrative body is empty, downgrade to false.
  const isConfident = !!output.isConfident && !!(output.narrative && output.narrative.trim().length > 0)

  const now = new Date()
  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.reportSectionVersion.create({
      data: {
        sectionId:          section.id,
        status:             'AI_DRAFTED',
        body:               output.narrative ?? '',
        aiExecutionId:      executionId,
        missingInformation: (output.missingInformation ?? []) as any,
        isConfident,
        factsHash,
        authorUserId:       session.userId,
      },
    })
    if (validation.valid.length > 0) {
      await tx.reportCitation.createMany({
        data: validation.valid.map(c => ({
          sectionVersionId: created.id,
          targetType:       c.targetType,
          targetId:         c.targetId,
          snippet:          c.snippet ?? null,
          isConfident:      true,
        })),
      })
    }
    // Point the section at the new draft.
    await tx.reportSection.update({
      where: { id: section.id },
      data: {
        status:           'AI_DRAFTED',
        currentBody:      output.narrative ?? '',
        currentFactsHash: factsHash,
      },
    })
    return created
  })

  await logAction({
    userId: session.userId, action: 'GENERATE_REPORT',
    caseId: section.report.caseId,
    targetModel: 'ReportSectionVersion', targetId: version.id,
    note: `AI drafted ${sectionKey} (${validation.valid.length} citations, ${validation.dropped.length} dropped)`,
  })
  revalidatePath(`/projects/${section.report.caseId}`)

  return {
    sectionVersionId:   version.id,
    aiExecutionId:      executionId,
    isConfident,
    missingInformation: (output.missingInformation ?? []) as string[],
    citationsSaved:     validation.valid.length,
    citationsDropped:   validation.dropped.length,
    factsHash,
  }
}

// ─────────────────────────────────────────────────
// Human edit (create a new HUMAN_EDITING version)
// ─────────────────────────────────────────────────

export async function saveSectionEdit(input: {
  sectionId: string
  body:      string
  missingInformation?: string[]
}): Promise<{ sectionVersionId: string }> {
  const section = await prisma.reportSection.findUnique({
    where: { id: input.sectionId },
    include: { report: { select: { id: true, caseId: true, status: true } } },
  })
  if (!section) throw new NotFoundError()
  if (section.report.status === 'FINAL') throw new Error('Report is FINAL — cannot edit')
  const { session } = await requireCaseAccess(section.report.caseId, 'report:generate')

  const { factsHash } = await buildReportFacts(section.report.caseId)

  const now = new Date()
  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.reportSectionVersion.create({
      data: {
        sectionId:          section.id,
        status:             'HUMAN_EDITING',
        body:               input.body,
        isConfident:        true,   // human-authored — confidence tracked separately if desired
        factsHash,
        missingInformation: (input.missingInformation ?? []) as any,
        authorUserId:       session.userId,
      },
    })
    await tx.reportSection.update({
      where: { id: section.id },
      data: {
        status:           'HUMAN_EDITING',
        currentBody:      input.body,
        currentFactsHash: factsHash,
      },
    })
    return created
  })
  await logAction({
    userId: session.userId, action: 'GENERATE_REPORT',
    caseId: section.report.caseId,
    targetModel: 'ReportSectionVersion', targetId: version.id,
    note: `human edit for ${section.key}`,
  })
  revalidatePath(`/projects/${section.report.caseId}`)
  return { sectionVersionId: version.id }
}

// ─────────────────────────────────────────────────
// Status transitions (submit for review, approve, reopen)
// ─────────────────────────────────────────────────

export async function changeSectionStatus(input: {
  sectionId: string
  next:      string
  note?:     string
}): Promise<void> {
  if (!isReportSectionStatus(input.next)) throw new Error(`Unknown section status: ${input.next}`)
  const section = await prisma.reportSection.findUnique({
    where: { id: input.sectionId },
    include: {
      report:   { select: { id: true, caseId: true, status: true } },
    },
  })
  if (!section) throw new NotFoundError()
  if (section.report.status === 'FINAL') throw new Error('Report is FINAL — cannot transition')

  const from = section.status
  const to   = input.next
  if (from === to) return
  if (!isReportSectionStatus(from) || !canSectionTransition(from as any, to as any)) {
    throw new Error(`Invalid section transition: ${from} → ${to}`)
  }

  // Approving requires a distinct reviewer AND a non-stale body.
  if (to === 'APPROVED') {
    const currentVersion = await prisma.reportSectionVersion.findFirst({
      where: { sectionId: section.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, authorUserId: true, factsHash: true },
    })
    if (!currentVersion) throw new Error('No section version to approve')
    // Check staleness first — cheaper than any auth query.
    const { factsHash } = await buildReportFacts(section.report.caseId)
    if (currentVersion.factsHash && currentVersion.factsHash !== factsHash) {
      throw new Error(
        'Section body was drafted against a different facts snapshot. ' +
        'Re-draft or re-edit before approving.',
      )
    }
    const { session } = await requireCaseAccess(section.report.caseId, 'report:generate')
    if (currentVersion.authorUserId === session.userId) {
      throw new ForbiddenError('The section author cannot approve their own draft.')
    }
    await prisma.$transaction(async (tx) => {
      await tx.reportSectionVersion.update({
        where: { id: currentVersion.id },
        data:  { status: 'APPROVED', approvedBy: session.userId, approvedAt: new Date() },
      })
      await tx.reportSection.update({
        where: { id: section.id },
        data:  { status: 'APPROVED' },
      })
    })
    await logAction({
      userId: session.userId, action: 'GENERATE_REPORT',
      caseId: section.report.caseId,
      targetModel: 'ReportSection', targetId: section.id,
      oldValue: { status: from }, newValue: { status: to },
    })
    revalidatePath(`/projects/${section.report.caseId}`)
    return
  }

  // Non-APPROVED transitions.
  const { session } = await requireCaseAccess(section.report.caseId, 'report:generate')
  await prisma.reportSection.update({
    where: { id: section.id },
    data:  { status: to },
  })
  await logAction({
    userId: session.userId, action: 'GENERATE_REPORT',
    caseId: section.report.caseId,
    targetModel: 'ReportSection', targetId: section.id,
    oldValue: { status: from }, newValue: { status: to },
    note: input.note?.slice(0, 200),
  })
  revalidatePath(`/projects/${section.report.caseId}`)
}
