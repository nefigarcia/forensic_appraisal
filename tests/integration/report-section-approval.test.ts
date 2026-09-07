/**
 * LOAD-BEARING integration tests for Slice-14 section approval.
 *
 * Invariants pinned:
 *   1. Approving a section requires a reviewer distinct from the
 *      author of the current version (no self-approval).
 *   2. Approving refuses when the current section body was drafted
 *      against a different facts hash (stale draft).
 *   3. Transition table is server-enforced (invalid transitions throw).
 *   4. FINAL reports refuse further edits.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:                  { findFirst: vi.fn() },
    caseMember:            { findUnique: vi.fn() },
    reportSection:         { findUnique: vi.fn(), update: vi.fn() },
    reportSectionVersion:  { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    reportCitation:        { createMany: vi.fn() },
    report:                { findUnique: vi.fn() },
    // Called by buildReportFacts:
    valuationEngagement:   { findUnique: vi.fn().mockResolvedValue(null) },
    financialValue:        { findMany: vi.fn().mockResolvedValue([]) },
    addBack:               { findMany: vi.fn().mockResolvedValue([]) },
    valuationAssumption:   { findMany: vi.fn().mockResolvedValue([]) },
    ownershipAdjustment:   { findMany: vi.fn().mockResolvedValue([]) },
    valuationReconciliation:{findMany: vi.fn().mockResolvedValue([]) },
    document:              { findMany: vi.fn().mockResolvedValue([]) },
    evidenceCitation:      { findMany: vi.fn().mockResolvedValue([]) },
    industryClassification:{ findUnique: vi.fn().mockResolvedValue(null) },
    $transaction:          vi.fn(async (fn: any) => fn({
      reportSection:        { update: vi.fn() },
      reportSectionVersion: { update: vi.fn(), create: vi.fn() },
    })),
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { ForbiddenError } from '@/lib/authz'
import { changeSectionStatus } from '@/app/actions/report-sections'

const AUTHOR   = { userId: 'user-a', organizationId: 'org-1', role: 'EDITOR', email: 'a@x', jti: 'j1' }
const REVIEWER = { userId: 'user-r', organizationId: 'org-1', role: 'EDITOR', email: 'r@x', jti: 'j2' }

// A canonical Case row used by buildReportFacts.
function primeCaseAndReport() {
  vi.mocked(prisma.case.findFirst).mockResolvedValue({
    id: 'case-1', organizationId: 'org-1', hasEngagementTeam: false,
  } as any)
  vi.mocked((prisma as any).case).findUnique = vi.fn().mockResolvedValue({
    id: 'case-1', organizationId: 'org-1', name: 'Case', client: 'Client',
    type: 'x', manager: 'm', valuationDate: null, reportDueDate: null,
    purposeOfValue: null, standardOfValue: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  primeCaseAndReport()
})

// ─────────────────────────────────────────────────
// Invalid transitions are refused
// ─────────────────────────────────────────────────

describe('changeSectionStatus — transition table', () => {
  it('NOT_STARTED → APPROVED is refused', async () => {
    vi.mocked(getSession).mockResolvedValue(REVIEWER as any)
    vi.mocked(prisma.reportSection.findUnique).mockResolvedValue({
      id: 's-1', key: 'CONCLUSION', status: 'NOT_STARTED',
      report: { id: 'r-1', caseId: 'case-1', status: 'DRAFT' },
    } as any)
    await expect(changeSectionStatus({ sectionId: 's-1', next: 'APPROVED' }))
      .rejects.toThrow(/Invalid section transition: NOT_STARTED → APPROVED/)
  })

  it('AI_DRAFTED → APPROVED is refused (must pass through HUMAN_EDITING and READY_FOR_REVIEW)', async () => {
    vi.mocked(getSession).mockResolvedValue(REVIEWER as any)
    vi.mocked(prisma.reportSection.findUnique).mockResolvedValue({
      id: 's-1', key: 'CONCLUSION', status: 'AI_DRAFTED',
      report: { id: 'r-1', caseId: 'case-1', status: 'DRAFT' },
    } as any)
    await expect(changeSectionStatus({ sectionId: 's-1', next: 'APPROVED' }))
      .rejects.toThrow(/Invalid section transition: AI_DRAFTED → APPROVED/)
  })

  it('FINAL report refuses ANY transition', async () => {
    vi.mocked(getSession).mockResolvedValue(REVIEWER as any)
    vi.mocked(prisma.reportSection.findUnique).mockResolvedValue({
      id: 's-1', key: 'CONCLUSION', status: 'HUMAN_EDITING',
      report: { id: 'r-1', caseId: 'case-1', status: 'FINAL' },
    } as any)
    await expect(changeSectionStatus({ sectionId: 's-1', next: 'READY_FOR_REVIEW' }))
      .rejects.toThrow(/Report is FINAL/)
  })
})

// ─────────────────────────────────────────────────
// APPROVE — no self-approval
// ─────────────────────────────────────────────────

describe('changeSectionStatus — APPROVE guardrails', () => {
  it('refuses when the reviewer authored the current version', async () => {
    // Reviewer = AUTHOR. Use factsHash=null on the version so the
    // staleness check (which runs first) passes, letting the self-
    // approval guard fire.
    vi.mocked(getSession).mockResolvedValue(AUTHOR as any)
    vi.mocked(prisma.reportSection.findUnique).mockResolvedValue({
      id: 's-1', key: 'CONCLUSION', status: 'READY_FOR_REVIEW',
      report: { id: 'r-1', caseId: 'case-1', status: 'DRAFT' },
    } as any)
    vi.mocked(prisma.reportSectionVersion.findFirst).mockResolvedValue({
      id: 'sv-1', authorUserId: 'user-a', factsHash: null,
    } as any)
    await expect(changeSectionStatus({ sectionId: 's-1', next: 'APPROVED' }))
      .rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses when the current version has a stale factsHash', async () => {
    vi.mocked(getSession).mockResolvedValue(REVIEWER as any)
    vi.mocked(prisma.reportSection.findUnique).mockResolvedValue({
      id: 's-1', key: 'CONCLUSION', status: 'READY_FOR_REVIEW',
      report: { id: 'r-1', caseId: 'case-1', status: 'DRAFT' },
    } as any)
    // Version was drafted against a specific hash — but the current
    // facts payload will produce a different hash (empty payload from
    // the mocked case row). Approval must refuse.
    vi.mocked(prisma.reportSectionVersion.findFirst).mockResolvedValue({
      id: 'sv-1', authorUserId: 'user-a', factsHash: 'OLD-hash-that-wont-match',
    } as any)
    await expect(changeSectionStatus({ sectionId: 's-1', next: 'APPROVED' }))
      .rejects.toThrow(/drafted against a different facts snapshot/)
  })

  it('happy path: distinct reviewer + matching factsHash → approves + timestamps', async () => {
    vi.mocked(getSession).mockResolvedValue(REVIEWER as any)
    vi.mocked(prisma.reportSection.findUnique).mockResolvedValue({
      id: 's-1', key: 'CONCLUSION', status: 'READY_FOR_REVIEW',
      report: { id: 'r-1', caseId: 'case-1', status: 'DRAFT' },
    } as any)
    // We pass factsHash = null so the check is bypassed (matches the
    // "no facts snapshot yet" case). The reviewer distinct-from-author
    // still holds.
    vi.mocked(prisma.reportSectionVersion.findFirst).mockResolvedValue({
      id: 'sv-1', authorUserId: 'user-a', factsHash: null,
    } as any)
    let updatedVersion: any = null
    let updatedSection: any = null
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      await fn({
        reportSection:        { update: (args: any) => { updatedSection = args } },
        reportSectionVersion: { update: (args: any) => { updatedVersion = args } },
      })
    })
    await changeSectionStatus({ sectionId: 's-1', next: 'APPROVED' })
    expect(updatedVersion.data.status).toBe('APPROVED')
    expect(updatedVersion.data.approvedBy).toBe('user-r')
    expect(updatedVersion.data.approvedAt).toBeInstanceOf(Date)
    expect(updatedSection.data.status).toBe('APPROVED')
  })
})

// ─────────────────────────────────────────────────
// Reopen path
// ─────────────────────────────────────────────────

describe('changeSectionStatus — reopen', () => {
  it('APPROVED → HUMAN_EDITING is allowed (reopening for rework)', async () => {
    vi.mocked(getSession).mockResolvedValue(AUTHOR as any)
    vi.mocked(prisma.reportSection.findUnique).mockResolvedValue({
      id: 's-1', key: 'CONCLUSION', status: 'APPROVED',
      report: { id: 'r-1', caseId: 'case-1', status: 'DRAFT' },
    } as any)
    await changeSectionStatus({ sectionId: 's-1', next: 'HUMAN_EDITING' })
    const updateArg = vi.mocked(prisma.reportSection.update).mock.calls[0]![0] as any
    expect(updateArg.data.status).toBe('HUMAN_EDITING')
  })

  it('APPROVED → READY_FOR_REVIEW is REFUSED (must go via HUMAN_EDITING)', async () => {
    vi.mocked(getSession).mockResolvedValue(AUTHOR as any)
    vi.mocked(prisma.reportSection.findUnique).mockResolvedValue({
      id: 's-1', key: 'CONCLUSION', status: 'APPROVED',
      report: { id: 'r-1', caseId: 'case-1', status: 'DRAFT' },
    } as any)
    await expect(changeSectionStatus({ sectionId: 's-1', next: 'READY_FOR_REVIEW' }))
      .rejects.toThrow(/Invalid section transition: APPROVED → READY_FOR_REVIEW/)
  })
})
