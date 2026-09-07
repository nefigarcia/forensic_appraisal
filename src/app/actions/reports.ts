'use server'

/**
 * Report + section CRUD + reads.
 *
 * The draft/edit/approve workflow lives in
 * `src/app/actions/report-sections.ts`. Snapshot/export live in
 * `src/app/actions/report-export.ts`. This file is the read-and-shape
 * surface plus lifecycle initialization + section listing.
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError } from '@/lib/authz'
import {
  DEFAULT_SECTION_ORDER, SECTION_CATALOG,
  isReportSectionKey, isReportStatus,
  type ReportSectionKey,
} from '@/lib/reports/sections'
import { buildReportFacts } from '@/lib/reports/facts'
import { computeReadiness, type ReadinessSummary } from '@/lib/reports/readiness'
import {
  SEED_CHECKLISTS, findSeedChecklist,
  isChecklistItemStatus, isStandardsFamily,
  CHECKLIST_DISCLAIMER,
} from '@/lib/reports/checklists'

// ─────────────────────────────────────────────────
// Client DTOs
// ─────────────────────────────────────────────────

export interface ReportForClient {
  id:              string
  caseId:          string
  title:           string
  status:          string
  standardsFamily: string | null
  templateKey:     string | null
  createdBy:       string
  createdAt:       Date
  updatedAt:       Date
  currentVersionId: string | null
  currentFactsHash: string | null
  sections: Array<{
    id:             string
    key:            ReportSectionKey
    title:          string
    status:         string
    isRequired:     boolean
    displayOrder:   number
    isStale:        boolean
    hasBody:        boolean
    currentFactsHash: string | null
    updatedAt:      Date
  }>
  readiness:  ReadinessSummary
  disclaimer: string
}

export interface ReportChecklistItemForClient {
  id:              string
  standardsFamily: string
  key:             string
  title:           string
  guidance:        string | null
  status:          string
  note:            string | null
  addressedBy:     string | null
  addressedAt:     Date | null
}

// ─────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────

export async function getReport(caseId: string): Promise<ReportForClient | null> {
  await requireCaseAccess(caseId, 'case:read')
  const report = await prisma.report.findUnique({
    where: { caseId },
    include: { sections: true, checklistItems: true },
  })
  if (!report) return null

  const { factsHash } = await buildReportFacts(caseId)
  const checklistCounts = {
    atRisk:  report.checklistItems.filter(i => i.status === 'AT_RISK').length,
    pending: report.checklistItems.filter(i => i.status === 'PENDING').length,
  }
  const readiness = computeReadiness(
    report.sections.map(s => ({
      key: s.key, status: s.status,
      currentFactsHash: s.currentFactsHash, currentBody: s.currentBody,
    })),
    factsHash,
    checklistCounts,
  )

  return {
    id:              report.id,
    caseId:          report.caseId,
    title:           report.title,
    status:          report.status,
    standardsFamily: report.standardsFamily,
    templateKey:     report.templateKey,
    createdBy:       report.createdBy,
    createdAt:       report.createdAt,
    updatedAt:       report.updatedAt,
    currentVersionId: report.currentVersionId,
    currentFactsHash: factsHash,
    sections: report.sections
      .filter(s => isReportSectionKey(s.key))
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(s => ({
        id:             s.id,
        key:            s.key as ReportSectionKey,
        title:          s.title,
        status:         s.status,
        isRequired:     s.isRequired,
        displayOrder:   s.displayOrder,
        isStale:        !!s.currentFactsHash && s.currentFactsHash !== factsHash,
        hasBody:        !!s.currentBody && s.currentBody.trim().length > 0,
        currentFactsHash: s.currentFactsHash,
        updatedAt:      s.updatedAt,
      })),
    readiness,
    disclaimer: CHECKLIST_DISCLAIMER,
  }
}

export async function getReportChecklistItems(reportId: string): Promise<ReportChecklistItemForClient[]> {
  const report = await prisma.report.findUnique({
    where: { id: reportId }, select: { caseId: true },
  })
  if (!report) throw new NotFoundError()
  await requireCaseAccess(report.caseId, 'case:read')
  const rows = await prisma.reportChecklistItem.findMany({
    where: { reportId }, orderBy: [{ standardsFamily: 'asc' }, { displayOrder: 'asc' }],
  })
  return rows.map(r => ({
    id: r.id, standardsFamily: r.standardsFamily, key: r.key, title: r.title,
    guidance: r.guidance, status: r.status, note: r.note,
    addressedBy: r.addressedBy, addressedAt: r.addressedAt,
  }))
}

// ─────────────────────────────────────────────────
// Initialize
// ─────────────────────────────────────────────────

/**
 * Initialize a Report for a case. Seeds one ReportSection per
 * canonical key + optionally attaches a system-standards checklist
 * whose items are cloned into `ReportChecklistItem` rows.
 */
export async function initializeReport(input: {
  caseId:           string
  title?:           string
  standardsFamily?: string
  attachChecklistKey?: string
}): Promise<{ id: string }> {
  const { session, case: c } = await requireCaseAccess(input.caseId, 'report:generate')

  const existing = await prisma.report.findUnique({ where: { caseId: input.caseId } })
  if (existing) return { id: existing.id }

  const title = input.title?.trim() || `Valuation Report — ${c.name}`
  const family = input.standardsFamily && isStandardsFamily(input.standardsFamily) ? input.standardsFamily : null

  const created = await prisma.$transaction(async (tx) => {
    const report = await tx.report.create({
      data: {
        caseId:          input.caseId,
        title,
        standardsFamily: family,
        templateKey:     input.attachChecklistKey ?? null,
        createdBy:       session.userId,
      },
    })
    // Seed one section per canonical key.
    await tx.reportSection.createMany({
      data: DEFAULT_SECTION_ORDER.map((key, i) => ({
        reportId:     report.id,
        key,
        title:        SECTION_CATALOG[key].title,
        displayOrder: i,
        isRequired:   SECTION_CATALOG[key].isRequired,
        status:       'NOT_STARTED',
      })),
    })
    // Optionally attach a system checklist as per-report copies.
    if (input.attachChecklistKey) {
      const seed = findSeedChecklist(input.attachChecklistKey)
      if (seed) {
        await tx.reportChecklistItem.createMany({
          data: seed.items.map((item, i) => ({
            reportId:        report.id,
            standardsFamily: seed.standardsFamily,
            key:             item.key,
            title:           item.title,
            guidance:        item.guidance ?? null,
            displayOrder:    i,
          })),
        })
      }
    }
    return report
  })

  await logAction({
    userId: session.userId, action: 'GENERATE_REPORT',
    caseId: input.caseId, targetModel: 'Report', targetId: created.id,
    note: `initialized report${input.attachChecklistKey ? ` with checklist ${input.attachChecklistKey}` : ''}`,
  })
  revalidatePath(`/projects/${input.caseId}`)
  return { id: created.id }
}

// ─────────────────────────────────────────────────
// Report status
// ─────────────────────────────────────────────────

export async function changeReportStatus(input: { reportId: string; status: string }): Promise<void> {
  if (!isReportStatus(input.status)) throw new Error(`Unknown report status: ${input.status}`)
  const report = await prisma.report.findUnique({
    where: { id: input.reportId }, select: { id: true, caseId: true, status: true },
  })
  if (!report) throw new NotFoundError()
  const { session } = await requireCaseAccess(report.caseId, 'report:generate')

  const data: Record<string, unknown> = { status: input.status }
  if (input.status === 'FINAL') {
    data.finalizedBy = session.userId
    data.finalizedAt = new Date()
  }
  await prisma.report.update({ where: { id: report.id }, data })
  await logAction({
    userId: session.userId, action: 'GENERATE_REPORT',
    caseId: report.caseId, targetModel: 'Report', targetId: report.id,
    oldValue: { status: report.status }, newValue: { status: input.status },
  })
  revalidatePath(`/projects/${report.caseId}`)
}

// ─────────────────────────────────────────────────
// Checklists — attach / update
// ─────────────────────────────────────────────────

export async function listSeedChecklists() {
  return SEED_CHECKLISTS.map(c => ({
    key: c.key, standardsFamily: c.standardsFamily, name: c.name,
    description: c.description, itemCount: c.items.length,
  }))
}

export async function attachSeedChecklist(input: {
  reportId: string
  seedKey:  string
}): Promise<{ added: number }> {
  const seed = findSeedChecklist(input.seedKey)
  if (!seed) throw new NotFoundError()
  const report = await prisma.report.findUnique({
    where: { id: input.reportId }, select: { id: true, caseId: true },
  })
  if (!report) throw new NotFoundError()
  const { session } = await requireCaseAccess(report.caseId, 'report:generate')

  // Skip items already present by (standardsFamily, key).
  const existing = await prisma.reportChecklistItem.findMany({
    where: { reportId: report.id, standardsFamily: seed.standardsFamily },
    select: { key: true },
  })
  const existingKeys = new Set(existing.map(e => e.key))
  const toAdd = seed.items.filter(i => !existingKeys.has(i.key))
  if (toAdd.length === 0) return { added: 0 }

  await prisma.reportChecklistItem.createMany({
    data: toAdd.map((item, i) => ({
      reportId:        report.id,
      standardsFamily: seed.standardsFamily,
      key:             item.key,
      title:           item.title,
      guidance:        item.guidance ?? null,
      displayOrder:    existingKeys.size + i,
    })),
  })
  await logAction({
    userId: session.userId, action: 'GENERATE_REPORT',
    caseId: report.caseId, targetModel: 'Report', targetId: report.id,
    note: `attached ${toAdd.length} checklist items from ${seed.key}`,
  })
  revalidatePath(`/projects/${report.caseId}`)
  return { added: toAdd.length }
}

export async function updateChecklistItemStatus(input: {
  itemId: string
  status: string
  note?:  string
}): Promise<void> {
  if (!isChecklistItemStatus(input.status)) throw new Error(`Unknown checklist status: ${input.status}`)
  const row = await prisma.reportChecklistItem.findUnique({
    where: { id: input.itemId },
    include: { report: { select: { caseId: true } } },
  })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.report.caseId, 'report:generate')

  const data: Record<string, unknown> = { status: input.status, note: input.note ?? row.note }
  if (input.status === 'ADDRESSED' || input.status === 'AT_RISK') {
    data.addressedBy = session.userId
    data.addressedAt = new Date()
  }
  await prisma.reportChecklistItem.update({ where: { id: row.id }, data })
  await logAction({
    userId: session.userId, action: 'GENERATE_REPORT',
    caseId: row.report.caseId, targetModel: 'ReportChecklistItem', targetId: row.id,
    oldValue: { status: row.status }, newValue: { status: input.status },
    note: input.note?.slice(0, 200),
  })
  revalidatePath(`/projects/${row.report.caseId}`)
}
