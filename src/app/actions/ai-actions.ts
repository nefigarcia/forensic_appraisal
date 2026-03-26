'use server'

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { guardAction } from '@/lib/rbac'
import { logAction } from '@/lib/audit'
import { extractFinancialData } from '@/ai/flows/ai-financial-statement-extraction-flow'
import { aiIndustryCodeSuggestion } from '@/ai/flows/ai-industry-code-suggestion-flow'
import { queryBinder } from '@/ai/flows/binder-query-flow'
import { normalizeTtmData } from '@/ai/flows/normalize-ttm-flow'
import { detectAnomalies } from '@/ai/flows/anomaly-detection-flow'
import { generateCaseInsights } from '@/ai/flows/insights-flow'
import { generateReportNarrative } from '@/ai/flows/report-narrative-flow'
import { revalidatePath } from 'next/cache'
import { s3Client, BUCKET_NAME } from '@/lib/s3-client'
import { GetObjectCommand } from '@aws-sdk/client-s3'

async function streamToBuffer(stream: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = []
    stream.on('data', (c: any) => chunks.push(c))
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

// ─────────────────────────────────────────────────
// FINANCIAL EXTRACTION
// ─────────────────────────────────────────────────

export async function runFinancialExtraction(caseId: string, documentId?: string) {
  const session = await getSession()
  guardAction(session, 'extraction:run')

  const doc = await prisma.document.findFirst({
    where: documentId ? { id: documentId } : { caseId },
    orderBy: { createdAt: 'desc' },
  })
  if (!doc?.s3Key) throw new Error('No document found in custody binder.')

  let documentDataUri: string
  try {
    const res    = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: doc.s3Key }))
    const buffer = await streamToBuffer(res.Body)
    const ext    = doc.s3Key.split('.').pop()?.toLowerCase() ?? ''
    const mime   = ['png','jpg','jpeg','webp','gif'].includes(ext)
      ? (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`)
      : 'application/pdf'
    documentDataUri = `data:${mime};base64,${buffer.toString('base64')}`
  } catch (e) {
    throw new Error('Failed to retrieve document from secure storage.')
  }

  const result = await extractFinancialData({
    documentDataUri, documentName: doc.name, documentTypeHint: doc.type || 'Forensic Financial Summary',
  })

  if (result.extractedData?.length) {
    await prisma.financialValue.createMany({
      data: result.extractedData.map((item) => ({
        caseId,
        documentId: doc.id,
        year:          item.year          ?? 'Unknown',
        statementType: item.statementType ?? 'N/A',
        lineItem:      item.lineItem,
        value:         item.value         ?? 0,
        aiSuggestedValue: item.value      ?? 0,
        confidence:    item.confidence    ?? 0.8,
        sourceRef:     item.sourceRef,
        currency:      item.currency      ?? 'USD',
        isVerified:    false,
        reviewStatus:  'PENDING',
      })),
    })
    await prisma.document.update({ where: { id: doc.id }, data: { status: 'EXTRACTED' } })
  }

  await logAction({
    userId: session!.userId, action: 'RUN_EXTRACTION', caseId,
    targetModel: 'Document', targetId: doc.id,
    note: `Extracted ${result.extractedData?.length ?? 0} values`,
  })

  revalidatePath(`/projects/${caseId}`)
  return result
}

// ─────────────────────────────────────────────────
// HYBRID UX — accept / override / reject / lock
// ─────────────────────────────────────────────────

export async function acceptFinancialValue(id: string) {
  const session = await getSession()
  guardAction(session, 'value:accept')

  const before = await prisma.financialValue.findUnique({ where: { id } })
  await prisma.financialValue.update({
    where: { id },
    data: { reviewStatus: 'ACCEPTED', isVerified: true, overriddenBy: session!.userId, overriddenAt: new Date() },
  })
  await logAction({ userId: session!.userId, action: 'ACCEPT_VALUE', caseId: before?.caseId, targetModel: 'FinancialValue', targetId: id })
  revalidatePath(`/projects/${before?.caseId}`)
}

export async function overrideFinancialValue(id: string, newValue: number, reason: string) {
  const session = await getSession()
  guardAction(session, 'value:override')

  const before = await prisma.financialValue.findUnique({ where: { id } })
  if (before?.isLocked) throw new Error('This value is locked and cannot be overridden.')

  await prisma.financialValue.update({
    where: { id },
    data: {
      value: newValue, reviewStatus: 'OVERRIDDEN', isVerified: true,
      overrideReason: reason, overriddenBy: session!.userId, overriddenAt: new Date(),
    },
  })
  await logAction({
    userId: session!.userId, action: 'OVERRIDE_VALUE', caseId: before?.caseId,
    targetModel: 'FinancialValue', targetId: id,
    oldValue: { value: before?.value }, newValue: { value: newValue, reason },
  })
  revalidatePath(`/projects/${before?.caseId}`)
}

export async function rejectFinancialValue(id: string, reason: string) {
  const session = await getSession()
  guardAction(session, 'value:reject')

  const before = await prisma.financialValue.findUnique({ where: { id } })
  await prisma.financialValue.update({
    where: { id },
    data: { reviewStatus: 'REJECTED', overrideReason: reason, overriddenBy: session!.userId, overriddenAt: new Date() },
  })
  await logAction({
    userId: session!.userId, action: 'REJECT_VALUE', caseId: before?.caseId,
    targetModel: 'FinancialValue', targetId: id, note: reason,
  })
  revalidatePath(`/projects/${before?.caseId}`)
}

export async function toggleLockFinancialValue(id: string) {
  const session = await getSession()
  guardAction(session, 'value:lock')

  const rec    = await prisma.financialValue.findUnique({ where: { id } })
  const locked = !rec?.isLocked
  await prisma.financialValue.update({ where: { id }, data: { isLocked: locked } })
  await logAction({
    userId: session!.userId, action: locked ? 'LOCK_VALUE' : 'UNLOCK_VALUE',
    caseId: rec?.caseId, targetModel: 'FinancialValue', targetId: id,
  })
  revalidatePath(`/projects/${rec?.caseId}`)
}

export async function updateFinancialValue(id: string, value: number, lineItem: string) {
  const session = await getSession()
  guardAction(session, 'value:override')

  const before  = await prisma.financialValue.findUnique({ where: { id } })
  if (before?.isLocked) throw new Error('Value is locked.')
  const updated = await prisma.financialValue.update({ where: { id }, data: { value, lineItem } })
  revalidatePath(`/projects/${updated.caseId}`)
  return updated
}

export async function approveFinancialValues(caseId: string, statementType: string, year: string) {
  const session = await getSession()
  guardAction(session, 'value:approve_batch')

  await prisma.financialValue.updateMany({
    where: { caseId, statementType, year, isLocked: false },
    data: { isVerified: true, reviewStatus: 'ACCEPTED' },
  })
  await logAction({ userId: session!.userId, action: 'APPROVE_BATCH', caseId, note: `${statementType} ${year}` })
  revalidatePath(`/projects/${caseId}`)
}

// ─────────────────────────────────────────────────
// BINDER CHAT
// ─────────────────────────────────────────────────

export async function askBinder(caseId: string, query: string) {
  const session = await getSession()
  guardAction(session, 'case:read')

  const financialData = await prisma.financialValue.findMany({ where: { caseId }, take: 50 })
  return queryBinder({
    query,
    contextData: [{ documentName: 'Consolidated Forensic Ledger', extractedText: financialData.map(f => `${f.year} ${f.statementType}: ${f.lineItem} = ${f.value}`).join('\n') }],
  })
}

// ─────────────────────────────────────────────────
// INDUSTRY ANALYSIS
// ─────────────────────────────────────────────────

export async function runIndustryAnalysis(caseId: string, description: string) {
  const session = await getSession()
  guardAction(session, 'extraction:run')

  const result = await aiIndustryCodeSuggestion({ businessDescription: description })
  const naics  = result.industryCodes.find(c => c.type === 'NAICS')?.code
  const sic    = result.industryCodes.find(c => c.type === 'SIC')?.code

  await prisma.industryClassification.upsert({
    where:  { caseId },
    update: { suggestedIndustry: result.suggestedIndustry, naicsCode: naics, sicCode: sic },
    create: { caseId, suggestedIndustry: result.suggestedIndustry, naicsCode: naics, sicCode: sic },
  })
  await logAction({ userId: session!.userId, action: 'RUN_INDUSTRY_ANALYSIS', caseId })
  revalidatePath(`/projects/${caseId}`)
  return result
}

// ─────────────────────────────────────────────────
// TTM NORMALIZATION
// ─────────────────────────────────────────────────

export async function runTtmNormalization(caseId: string) {
  const session = await getSession()
  guardAction(session, 'extraction:run')

  const rawItems = await prisma.financialValue.findMany({ where: { caseId }, orderBy: { year: 'asc' } })
  if (!rawItems.length) throw new Error('No financial data found to normalize.')

  const result = await normalizeTtmData({ rawItems: rawItems.map(i => ({ year: i.year, statementType: i.statementType, lineItem: i.lineItem, value: i.value, currency: i.currency })) })
  await logAction({ userId: session!.userId, action: 'RUN_TTM_NORMALIZATION', caseId })
  revalidatePath(`/projects/${caseId}`)
  return result
}

// ─────────────────────────────────────────────────
// ANOMALY DETECTION
// ─────────────────────────────────────────────────

export async function runAnomalyDetection(caseId: string) {
  const session = await getSession()
  guardAction(session, 'anomaly:run')

  const financialData = await prisma.financialValue.findMany({ where: { caseId }, orderBy: { year: 'asc' } })
  if (!financialData.length) throw new Error('No financial data to analyze.')

  const industry = await prisma.industryClassification.findUnique({ where: { caseId } })
  const result   = await detectAnomalies({
    financialData: financialData.map(f => ({ id: f.id, year: f.year, statementType: f.statementType, lineItem: f.lineItem, value: f.value })),
    industryContext: industry?.suggestedIndustry,
  })

  // Clear old open flags, insert new ones
  await prisma.anomalyFlag.deleteMany({ where: { caseId, status: 'OPEN' } })
  if (result.flags?.length) {
    await prisma.anomalyFlag.createMany({
      data: result.flags.map(f => ({
        caseId, severity: f.severity, category: f.category,
        title: f.title, description: f.description,
        affectedRows: JSON.stringify(f.affectedIds),
        status: 'OPEN',
      })),
    })
  }

  await logAction({ userId: session!.userId, action: 'RUN_ANOMALY_DETECTION', caseId, note: `${result.flags?.length ?? 0} flags` })
  revalidatePath(`/projects/${caseId}`)
  return result
}

export async function resolveAnomalyFlag(flagId: string, resolution: string, status: 'INVESTIGATED' | 'EXPLAINED' | 'ESCALATED') {
  const session = await getSession()
  guardAction(session, 'anomaly:run')

  const flag = await prisma.anomalyFlag.findUnique({ where: { id: flagId } })
  await prisma.anomalyFlag.update({
    where: { id: flagId },
    data: { status, resolution, resolvedBy: session!.userId, resolvedAt: new Date() },
  })
  await logAction({ userId: session!.userId, action: 'RESOLVE_FLAG', caseId: flag?.caseId ?? undefined, targetId: flagId, note: `${status}: ${resolution}` })
  revalidatePath(`/projects/${flag?.caseId}`)
}

// ─────────────────────────────────────────────────
// PROACTIVE INSIGHTS
// ─────────────────────────────────────────────────

export async function refreshCaseInsights(caseId: string) {
  const session = await getSession()
  guardAction(session, 'case:read')

  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      documents: true, financialData: true, industry: true,
      valuationModels: true, addBacks: true,
      anomalyFlags: { where: { status: 'OPEN' } },
    },
  })
  if (!c) throw new Error('Case not found')

  const years = [...new Set(c.financialData.map(f => f.year))]
  const { score, missing } = await (async () => {
    const checks = [
      c.documents.length > 0, c.financialData.length > 0, years.length >= 2,
      !!c.industry, !!c.industry?.naicsCode, c.addBacks.length > 0,
      c.valuationModels.length > 0, !!c.standardOfValue, !!c.purposeOfValue, !!c.valuationDate,
    ]
    const labels = ['Documents uploaded','Financial data extracted','2+ years of data','Industry classified','NAICS code assigned','Add-backs created','Valuation saved','Standard of value set','Purpose set','Valuation date set']
    return { score: Math.round(checks.filter(Boolean).length / checks.length * 100), missing: labels.filter((_, i) => !checks[i]) }
  })()

  const result = await generateCaseInsights({
    caseName: c.name, caseType: c.type, completeness: score, missingItems: missing,
    documentCount: c.documents.length, dataPointCount: c.financialData.length,
    yearsOfData: years, industry: c.industry?.suggestedIndustry,
    anomalyCount: c.anomalyFlags.length, addBackCount: c.addBacks.length,
    valuationCount: c.valuationModels.length,
  })

  // Replace non-dismissed insights
  await prisma.caseInsight.deleteMany({ where: { caseId, isDismissed: false } })
  if (result.insights?.length) {
    await prisma.caseInsight.createMany({
      data: result.insights.map(i => ({
        caseId, type: i.type, title: i.title, body: i.body,
        actionLabel: i.actionLabel, actionPath: i.actionPath,
      })),
    })
  }

  revalidatePath(`/projects/${caseId}`)
  return result
}

export async function dismissInsight(insightId: string) {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  await prisma.caseInsight.update({ where: { id: insightId }, data: { isDismissed: true } })
}

// ─────────────────────────────────────────────────
// REPORT NARRATIVE (AI draft per section)
// ─────────────────────────────────────────────────

export async function draftReportSection(caseId: string, section: Parameters<typeof generateReportNarrative>[0]['section'], existingText?: string) {
  const session = await getSession()
  guardAction(session, 'report:generate')

  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: { industry: true, valuationModels: { orderBy: { createdAt: 'desc' }, take: 1 }, addBacks: true, financialData: true },
  })
  if (!c) throw new Error('Case not found')

  const latestModel = c.valuationModels[0]
  const addBackTotal = c.addBacks.reduce((s, a) => s + ((a.ttm ?? 0)), 0)
  const years = [...new Set(c.financialData.map(f => f.year))].sort()

  return generateReportNarrative({
    section, caseName: c.name, caseType: c.type, clientName: c.client,
    valuationDate:   c.valuationDate?.toISOString().split('T')[0],
    standardOfValue: c.standardOfValue ?? 'FMV',
    purposeOfValue:  c.purposeOfValue ?? undefined,
    industry:        c.industry?.suggestedIndustry,
    naicsCode:       c.industry?.naicsCode ?? undefined,
    concludedValue:  latestModel?.indicatedValue ?? undefined,
    ebitda:          latestModel?.ebitda ?? undefined,
    multiplier:      latestModel?.multiplier ?? undefined,
    financialSummary: `${years.length} years of data (${years.join(', ')})`,
    addBackSummary:  `${c.addBacks.length} add-backs, total TTM: $${addBackTotal.toLocaleString()}`,
    existingText,
  })
}

// ─────────────────────────────────────────────────
// AUDIT LOG READER
// ─────────────────────────────────────────────────

export async function getAuditLog(caseId: string) {
  const session = await getSession()
  guardAction(session, 'audit:read')

  return prisma.auditLog.findMany({
    where: { caseId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { name: true, email: true, role: true } } },
  })
}
