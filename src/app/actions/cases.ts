'use server'

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { guardAction } from '@/lib/rbac'
import { logAction } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

export async function getCases() {
  const session = await getSession()
  if (!session) return []
  return prisma.case.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { documents: true, financialData: true, anomalyFlags: true, addBacks: true, valuationModels: true } },
      insights: { where: { isDismissed: false }, orderBy: { createdAt: 'desc' }, take: 3 },
    },
  })
}

export async function createCase(formData: FormData) {
  const session = await getSession()
  guardAction(session, 'case:create')

  // ── Plan limit enforcement ──────────────────────────────────────────────
  // @ts-ignore — casesLimit added by schema migration; resolves after `prisma generate`
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    include: { _count: { select: { cases: true } } },
  }) as any
  if (org) {
    const limit = org.casesLimit ?? 3
    if (org._count.cases >= limit) {
      throw new Error(
        `Case limit reached (${limit} cases on the ${org.plan} plan). ` +
        `Upgrade your plan at Settings → Billing to create more cases.`
      )
    }
  }
  // ───────────────────────────────────────────────────────────────────────

  const name            = formData.get('name') as string
  const client          = formData.get('client') as string
  const type            = formData.get('type') as string
  const manager         = formData.get('manager') as string
  const purposeOfValue  = formData.get('purposeOfValue') as string | null
  const standardOfValue = (formData.get('standardOfValue') as string) || 'FMV'
  const valuationDate   = formData.get('valuationDate') as string | null
  const reportDueDate   = formData.get('reportDueDate') as string | null

  const newCase = await prisma.case.create({
    data: {
      name, client, type, manager,
      purposeOfValue:  purposeOfValue  || undefined,
      standardOfValue: standardOfValue || 'FMV',
      valuationDate:   valuationDate   ? new Date(valuationDate)  : undefined,
      reportDueDate:   reportDueDate   ? new Date(reportDueDate)  : undefined,
      organizationId:  session.organizationId,
      status: 'ACTIVE',
    },
  })

  await logAction({ userId: session.userId, action: 'CREATE_CASE', caseId: newCase.id, newValue: { name, client, type } })

  revalidatePath('/projects')
  revalidatePath('/dashboard')
  return newCase
}

export async function getCaseDetails(id: string) {
  const session = await getSession()
  guardAction(session, 'case:read')

  return prisma.case.findUnique({
    where: { id },
    include: {
      documents:      { orderBy: { createdAt: 'desc' } },
      financialData:  { orderBy: { year: 'desc' } },
      addBacks:       { orderBy: { createdAt: 'asc' } },
      industry:       true,
      valuationModels:{ orderBy: { createdAt: 'desc' } },
      anomalyFlags:   { orderBy: { severity: 'asc' }, where: { status: { not: 'INVESTIGATED' } } },
      insights:       { orderBy: { createdAt: 'desc' }, where: { isDismissed: false } },
    },
  })
}

export async function saveValuation(
  caseId: string,
  data: {
    valuationType: string; label?: string; ebitda?: number; multiplier?: number
    growthRate?: number; indicatedValue?: number; weight?: number
    dcfYear1?: number; dcfYear2?: number; dcfYear3?: number; dcfYear4?: number; dcfYear5?: number
    terminalGrowth?: number; discountRate?: number
    riskFreeRate?: number; equityRiskPremium?: number; sizePremium?: number; specificRisk?: number
    reconciliationNote?: string
  },
) {
  const session = await getSession()
  guardAction(session, 'valuation:write')

  const model = await prisma.valuationModel.create({ data: { caseId, ...data } })

  await logAction({ userId: session.userId, action: 'SAVE_VALUATION', caseId, targetModel: 'ValuationModel', targetId: model.id, newValue: data })

  revalidatePath(`/projects/${caseId}/valuation`)
  return model
}

export async function searchCases(query: string) {
  const session = await getSession()
  if (!session) return []
  return prisma.case.findMany({
    where: {
      organizationId: session.organizationId,
      OR: [{ name: { contains: query } }, { client: { contains: query } }, { type: { contains: query } }],
    },
    include: { documents: true },
    take: 10,
  })
}

export async function getCaseCompleteness(caseId: string): Promise<{ score: number; missing: string[] }> {
  const session = await getSession()
  guardAction(session, 'case:read')

  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      documents: true,
      financialData: true,
      industry: true,
      valuationModels: true,
      addBacks: true,
    },
  })
  if (!c) return { score: 0, missing: ['Case not found'] }

  const checks: { label: string; pass: boolean }[] = [
    { label: 'Documents uploaded',            pass: c.documents.length > 0 },
    { label: 'Financial data extracted',      pass: c.financialData.length > 0 },
    { label: 'At least 2 years of data',      pass: new Set(c.financialData.map(f => f.year)).size >= 2 },
    { label: 'Industry classification run',   pass: !!c.industry },
    { label: 'NAICS code assigned',           pass: !!c.industry?.naicsCode },
    { label: 'Normalization add-backs added', pass: c.addBacks.length > 0 },
    { label: 'Valuation model saved',         pass: c.valuationModels.length > 0 },
    { label: 'Standard of value set',         pass: !!c.standardOfValue },
    { label: 'Purpose of engagement set',     pass: !!c.purposeOfValue },
    { label: 'Valuation date set',            pass: !!c.valuationDate },
  ]

  const passed  = checks.filter(c => c.pass).length
  const missing = checks.filter(c => !c.pass).map(c => c.label)
  return { score: Math.round((passed / checks.length) * 100), missing }
}
