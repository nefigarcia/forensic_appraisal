'use server'

import { prisma } from '@/lib/prisma'
import { logAction } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import {
  requireSession,
  requireOrganization,
  requirePermission,
  requireCaseAccess,
} from '@/lib/authz'
import { money, serializeMoney, moneyMul } from '@/lib/money'
import { computeDcf, computeWacc, marketApproachValue, reconcileValues } from '@/lib/valuation'

export async function getCases() {
  let session
  try { session = await requireOrganization() } catch { return [] }
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
  const session = await requireSession()
  requirePermission(session, 'case:create')

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
  await requireCaseAccess(id, 'case:read')

  const row = await prisma.case.findUnique({
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
  return serializeForClient(row)
}

/**
 * Next.js 15 refuses to send `Prisma.Decimal`, `BigInt`, or other
 * non-plain objects across the server→client server-action boundary.
 * Slice-4 introduced Decimal shadow columns on FinancialValue,
 * AddBack, and ValuationModel; this helper converts them to strings
 * so the case detail payload round-trips cleanly.
 *
 * BigInt (used by DocumentVersion.sizeBytes) is also converted.
 */
function serializeForClient<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return (value.toString() as unknown) as T
  if (typeof value !== 'object') return value
  // decimal.js / Prisma.Decimal instances are objects with a `.toString()`
  // that produces a decimal-safe string. Detect by constructor name.
  const ctor = (value as { constructor?: { name?: string } }).constructor?.name
  if (ctor === 'Decimal') return ((value as any).toString() as unknown) as T
  if (value instanceof Date) return value
  if (Array.isArray(value)) return value.map(serializeForClient) as unknown as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = serializeForClient(v)
  }
  return out as T
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
  const { session } = await requireCaseAccess(caseId, 'valuation:write')

  // ── Slice 4: authoritative server-side Decimal recompute ─────────────────
  // The client sends its own advisory `indicatedValue` computed with JS
  // floats. We ignore that and recompute here using Prisma.Decimal so the
  // stored concluded value is exact. UI display of a slightly different
  // preview is harmless; storage is what matters for the forensic report.
  const ebitdaD    = money(data.ebitda    ?? 0)
  const multipleD  = money(data.multiplier ?? 0)
  const marketValueD = marketApproachValue(ebitdaD, multipleD)

  let dcfIndicatedD = money(0)
  const hasDcfInputs =
    data.dcfYear1 !== undefined || data.dcfYear2 !== undefined ||
    data.dcfYear3 !== undefined || data.dcfYear4 !== undefined ||
    data.dcfYear5 !== undefined
  if (hasDcfInputs && data.discountRate !== undefined && data.terminalGrowth !== undefined) {
    try {
      const dcf = computeDcf({
        cashflows:      [data.dcfYear1, data.dcfYear2, data.dcfYear3, data.dcfYear4, data.dcfYear5].map(v => v ?? 0),
        discountRate:   data.discountRate,
        terminalGrowth: data.terminalGrowth,
      })
      dcfIndicatedD = dcf.indicatedValue
    } catch (e) {
      // discountRate ≤ terminalGrowth diverges; fall back to market-only.
      dcfIndicatedD = money(0)
    }
  }

  // Reconcile market and DCF using the client's weight if present, else
  // 100 % market. Weight is expressed on the same scale the UI used.
  const marketWeight = money(data.weight ?? 100)
  const indicatedD = hasDcfInputs
    ? reconcileValues([
        { value: marketValueD,  weight: marketWeight },
        { value: dcfIndicatedD, weight: money(100).minus(marketWeight) },
      ])
    : marketValueD

  const waccD = computeWacc({
    riskFreeRate:      data.riskFreeRate,
    equityRiskPremium: data.equityRiskPremium,
    sizePremium:       data.sizePremium,
    specificRisk:      data.specificRisk,
  })
  void waccD // Not persisted separately; components live on the model.

  // ── Dual-write: Float columns for legacy UI, Decimal columns as truth ─
  const model = await prisma.valuationModel.create({
    data: {
      caseId,
      valuationType:      data.valuationType,
      label:              data.label,
      reconciliationNote: data.reconciliationNote,
      // Float legacy columns (kept during migration window)
      ebitda:             data.ebitda,
      multiplier:         data.multiplier,
      growthRate:         data.growthRate,
      dcfYear1:           data.dcfYear1,
      dcfYear2:           data.dcfYear2,
      dcfYear3:           data.dcfYear3,
      dcfYear4:           data.dcfYear4,
      dcfYear5:           data.dcfYear5,
      terminalGrowth:     data.terminalGrowth,
      discountRate:       data.discountRate,
      riskFreeRate:       data.riskFreeRate,
      equityRiskPremium:  data.equityRiskPremium,
      sizePremium:        data.sizePremium,
      specificRisk:       data.specificRisk,
      weight:             data.weight,
      indicatedValue:     Number(indicatedD.toFixed(4)),
      // Decimal shadow columns (authoritative)
      ebitdaDecimal:            data.ebitda            != null ? ebitdaD                    : null,
      multiplierDecimal:        data.multiplier        != null ? multipleD                  : null,
      growthRateDecimal:        data.growthRate        != null ? money(data.growthRate)     : null,
      dcfYear1Decimal:          data.dcfYear1          != null ? money(data.dcfYear1)       : null,
      dcfYear2Decimal:          data.dcfYear2          != null ? money(data.dcfYear2)       : null,
      dcfYear3Decimal:          data.dcfYear3          != null ? money(data.dcfYear3)       : null,
      dcfYear4Decimal:          data.dcfYear4          != null ? money(data.dcfYear4)       : null,
      dcfYear5Decimal:          data.dcfYear5          != null ? money(data.dcfYear5)       : null,
      terminalGrowthDecimal:    data.terminalGrowth    != null ? money(data.terminalGrowth) : null,
      discountRateDecimal:      data.discountRate      != null ? money(data.discountRate)   : null,
      riskFreeRateDecimal:      data.riskFreeRate      != null ? money(data.riskFreeRate)   : null,
      equityRiskPremiumDecimal: data.equityRiskPremium != null ? money(data.equityRiskPremium) : null,
      sizePremiumDecimal:       data.sizePremium       != null ? money(data.sizePremium)    : null,
      specificRiskDecimal:      data.specificRisk      != null ? money(data.specificRisk)   : null,
      weightDecimal:            data.weight            != null ? money(data.weight)         : null,
      indicatedValueDecimal:    indicatedD,
    },
  })

  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION', caseId,
    targetModel: 'ValuationModel', targetId: model.id,
    newValue: {
      ...data,
      indicatedValue: serializeMoney(indicatedD),   // authoritative for the audit trail
    },
  })

  revalidatePath(`/projects/${caseId}/valuation`)
  return model
}

export async function searchCases(query: string) {
  let session
  try { session = await requireOrganization() } catch { return [] }
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
  await requireCaseAccess(caseId, 'case:read')

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
