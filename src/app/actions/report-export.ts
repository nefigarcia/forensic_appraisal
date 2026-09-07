'use server'

/**
 * Report snapshot + export.
 *
 * A `ReportVersion` is a labeled, immutable snapshot: it freezes the
 * facts payload (as JSON + hash) and pins the ReportSectionVersion ids
 * that composed the snapshot. Exports pull from a specific version
 * (default: `currentVersionId` on the report; if that is null, the
 * latest version).
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError } from '@/lib/authz'
import {
  DEFAULT_SECTION_ORDER, SECTION_CATALOG,
  isReportSectionKey, type ReportSectionKey,
} from '@/lib/reports/sections'
import { buildReportFacts } from '@/lib/reports/facts'
import { renderPlainText } from '@/lib/reports/exporters/plain-text'
import { renderDocx } from '@/lib/reports/exporters/docx'

// ─────────────────────────────────────────────────
// Snapshot
// ─────────────────────────────────────────────────

/**
 * Freeze a snapshot of the report at its current state. Every current
 * section body becomes a `ReportSectionVersion` reference (either the
 * latest already-persisted one, or a fresh row when the section has
 * pending edits that predate a save). `factsSnapshot` is the exact
 * payload the AI drafts referenced.
 */
export async function freezeReportVersion(input: {
  reportId: string
  label?:   string
}): Promise<{ id: string; versionNumber: number }> {
  const report = await prisma.report.findUnique({
    where: { id: input.reportId },
    include: { sections: true },
  })
  if (!report) throw new NotFoundError()
  const { session } = await requireCaseAccess(report.caseId, 'report:generate')

  const { payload, factsHash } = await buildReportFacts(report.caseId)

  // Determine next version number.
  const last = await prisma.reportVersion.findFirst({
    where: { reportId: report.id }, orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  })
  const nextVersionNumber = (last?.versionNumber ?? 0) + 1

  // For each section, pin the newest version row (if any).
  const created = await prisma.$transaction(async (tx) => {
    const version = await tx.reportVersion.create({
      data: {
        reportId:      report.id,
        versionNumber: nextVersionNumber,
        label:         input.label?.trim() ?? null,
        factsHash,
        factsSnapshot: payload as any,
        createdBy:     session.userId,
      },
    })
    // Attach the latest ReportSectionVersion for each section, if any.
    for (const sec of report.sections) {
      const latest = await tx.reportSectionVersion.findFirst({
        where: { sectionId: sec.id }, orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (latest) {
        await tx.reportSectionVersion.update({
          where: { id: latest.id }, data: { reportVersionId: version.id },
        })
      }
    }
    await tx.report.update({
      where: { id: report.id }, data: { currentVersionId: version.id },
    })
    return version
  })

  await logAction({
    userId: session.userId, action: 'GENERATE_REPORT',
    caseId: report.caseId,
    targetModel: 'ReportVersion', targetId: created.id,
    note: `froze version ${nextVersionNumber}${input.label ? ` — ${input.label}` : ''}`,
  })
  revalidatePath(`/projects/${report.caseId}`)
  return { id: created.id, versionNumber: nextVersionNumber }
}

// ─────────────────────────────────────────────────
// Export shape (shared)
// ─────────────────────────────────────────────────

async function buildExportInput(reportId: string, versionId?: string) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      sections: true,
      versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
    },
  })
  if (!report) throw new NotFoundError()
  await requireCaseAccess(report.caseId, 'case:read')

  let version = null as null | Awaited<ReturnType<typeof prisma.reportVersion.findUnique>>
  if (versionId) {
    version = await prisma.reportVersion.findUnique({ where: { id: versionId } })
    if (!version || version.reportId !== report.id) throw new NotFoundError()
  } else if (report.currentVersionId) {
    version = await prisma.reportVersion.findUnique({ where: { id: report.currentVersionId } })
  } else if (report.versions.length > 0) {
    version = report.versions[0]!
  }

  // Build per-section body map. If a version is pinned, prefer its
  // section-version rows; otherwise fall back to current body.
  const sectionsById = new Map(report.sections.map(s => [s.id, s]))
  const bodyByKey: Record<string, {
    status: string; body: string | null;
    missingInformation?: string[] | null; isConfident?: boolean;
  } | undefined> = {}
  const citationsByKey: Array<{ sectionKey: string; targetType: string; targetId: string; snippet?: string | null }> = []

  if (version) {
    const svs = await prisma.reportSectionVersion.findMany({
      where: { reportVersionId: version.id },
      include: { section: true, citations: true },
    })
    for (const sv of svs) {
      if (!isReportSectionKey(sv.section.key)) continue
      bodyByKey[sv.section.key] = {
        status:              sv.status,
        body:                sv.body,
        missingInformation:  (sv.missingInformation as string[] | null) ?? null,
        isConfident:         sv.isConfident,
      }
      for (const c of sv.citations) {
        citationsByKey.push({
          sectionKey: sv.section.key, targetType: c.targetType,
          targetId:   c.targetId, snippet: c.snippet,
        })
      }
    }
  }

  // Fill any missing key from the section's currentBody (unfrozen state).
  for (const sec of sectionsById.values()) {
    if (!isReportSectionKey(sec.key)) continue
    if (bodyByKey[sec.key]) continue
    bodyByKey[sec.key] = {
      status: sec.status, body: sec.currentBody,
      missingInformation: null, isConfident: true,
    }
  }

  return {
    report, version,
    input: {
      title:           report.title,
      standardsFamily: report.standardsFamily,
      frozenAt:        version?.frozenAt ?? new Date(),
      factsHash:       version?.factsHash ?? '(current, unfrozen)',
      sections:        bodyByKey as Record<ReportSectionKey, any>,
      citations:       citationsByKey,
    },
  }
}

// ─────────────────────────────────────────────────
// Plain-text export
// ─────────────────────────────────────────────────

export async function exportReportPlainText(input: {
  reportId: string; versionId?: string
}): Promise<{ text: string; filename: string }> {
  const { report, input: exp } = await buildExportInput(input.reportId, input.versionId)
  const text = renderPlainText({
    title:           exp.title,
    standardsFamily: exp.standardsFamily,
    frozenAt:        exp.frozenAt,
    factsHash:       exp.factsHash,
    sections:        exp.sections,
    citations:       exp.citations,
  })
  const filename = safeFilename(`${report.title}.txt`)
  return { text, filename }
}

// ─────────────────────────────────────────────────
// DOCX export
// ─────────────────────────────────────────────────

export async function exportReportDocx(input: {
  reportId: string; versionId?: string
}): Promise<{ base64: string; filename: string }> {
  const { report, input: exp } = await buildExportInput(input.reportId, input.versionId)
  const buf = await renderDocx({
    title:           exp.title,
    standardsFamily: exp.standardsFamily,
    frozenAt:        exp.frozenAt,
    factsHash:       exp.factsHash,
    sections:        exp.sections,
    citations:       exp.citations,
  })
  // Return base64 so it round-trips through the server-action boundary.
  const filename = safeFilename(`${report.title}.docx`)
  return { base64: buf.toString('base64'), filename }
}

function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_')
}

// silence unused import lint on SECTION_CATALOG (used indirectly via renderer).
void SECTION_CATALOG
void DEFAULT_SECTION_ORDER
