'use server'

/**
 * Compute actions — run the DCF / cap-earnings / market / asset math
 * and persist the results to the corresponding rows.
 *
 * The reconciliation action is the load-bearing "professional judgment"
 * step: it refuses to finalize while any material assumption or
 * ownership adjustment is not APPROVED. Callers can pass
 * `allowBlocking=true` to run a *preview* — the row is written with
 * `hasBlockingAssumptions = true` so the UI can flag it explicitly.
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError } from '@/lib/authz'
import { computeDcfDetail, type DcfYearInput } from '@/lib/valuation-v2/dcf'
import { computeCapEarnings } from '@/lib/valuation-v2/cap-earnings'
import {
  guidelineCompanyStats, guidelineTransactionStats,
  marketIndication,
} from '@/lib/valuation-v2/market'
import { computeAssetApproach } from '@/lib/valuation-v2/asset'
import { computeReconciliation } from '@/lib/valuation-v2/reconciliation'
import { isEffectiveAssumption, type AssumptionStatus, type BridgeCategory, isBridgeCategory } from '@/lib/valuation-v2/statuses'
import { money } from '@/lib/money'

// ─────────────────────────────────────────────────
// DCF
// ─────────────────────────────────────────────────

/**
 * Recompute a DCF approach from its persisted year rows + config, and
 * write per-year FCFF / discount factor / present value back plus the
 * approach-level `indicatedValue`.
 */
export async function computeDcfApproach(input: { approachId: string }): Promise<{ indicatedValue: string }> {
  const approach = await prisma.valuationApproach.findUnique({
    where: { id: input.approachId },
    include: {
      scenario: { include: { engagement: { select: { caseId: true } } } },
      dcf:      { include: { forecastYears: { orderBy: { yearIndex: 'asc' } } } },
    },
  })
  if (!approach || approach.kind !== 'INCOME_DCF') throw new NotFoundError()
  const { session } = await requireCaseAccess(approach.scenario.engagement.caseId, 'valuation:write')
  const detail = approach.dcf
  if (!detail) throw new Error('DCF detail row missing — call ensureDcfDetail first')
  if (detail.discountRate == null) throw new Error('DCF discountRate required')

  const yearsInput: DcfYearInput[] = detail.forecastYears.map(y => ({
    yearLabel:            y.yearLabel,
    yearIndex:            y.yearIndex,
    revenue:              y.revenue?.toString(),
    ebitdaMargin:         y.ebitdaMargin?.toString(),
    ebitda:               y.ebitda?.toString(),
    depreciation:         y.depreciation?.toString(),
    amortization:         y.amortization?.toString(),
    taxes:                y.taxes?.toString(),
    capex:                y.capex?.toString(),
    workingCapitalChange: y.workingCapitalChange?.toString(),
    fcff:                 y.fcff?.toString(),
  }))
  const result = computeDcfDetail({
    years: yearsInput,
    discountRate:      detail.discountRate.toString(),
    taxRate:           detail.taxRate?.toString() ?? '0',
    terminalMethod:    detail.terminalMethod as 'GORDON' | 'EXIT_MULTIPLE',
    terminalGrowth:    detail.terminalGrowth?.toString(),
    terminalExitMultiple: detail.terminalExitMultiple?.toString(),
    midyearConvention: detail.midyearConvention,
  })

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    for (const row of result.years) {
      await tx.dcfForecastYear.update({
        where: {
          DcfForecastYear_dcf_year: { dcfApproachId: detail.approachId, yearIndex: row.yearIndex },
        },
        data: {
          ebitda:         row.ebitda.toString(),
          ebit:           row.ebit.toString(),
          taxes:          row.taxes.toString(),
          fcff:           row.fcff.toString(),
          discountFactor: row.discountFactor.toString(),
          presentValue:   row.presentValue.toString(),
        },
      })
    }
    await tx.dcfDetail.update({
      where: { approachId: detail.approachId },
      data: {
        pvSum:          result.pvSum.toString(),
        pvTerminal:     result.pvTerminal.toString(),
        indicatedValue: result.indicatedValue.toString(),
      },
    })
    await tx.valuationApproach.update({
      where: { id: approach.id },
      data:  { indicatedValue: result.indicatedValue.toString(), computedAt: now },
    })
  })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: approach.scenario.engagement.caseId,
    targetModel: 'ValuationApproach', targetId: approach.id,
    note: `DCF computed → ${result.indicatedValue.toString()}`,
  })
  revalidatePath(`/projects/${approach.scenario.engagement.caseId}`)
  return { indicatedValue: result.indicatedValue.toString() }
}

// ─────────────────────────────────────────────────
// Capitalization of Earnings
// ─────────────────────────────────────────────────

export async function computeCapEarningsApproach(input: { approachId: string }): Promise<{ indicatedValue: string }> {
  const approach = await prisma.valuationApproach.findUnique({
    where: { id: input.approachId },
    include: {
      scenario: { include: { engagement: { select: { caseId: true } } } },
      capEarnings: true,
    },
  })
  if (!approach || approach.kind !== 'INCOME_CAP_EARNINGS') throw new NotFoundError()
  const { session } = await requireCaseAccess(approach.scenario.engagement.caseId, 'valuation:write')
  const cap = approach.capEarnings
  if (!cap) throw new Error('CapEarningsDetail missing')
  if (cap.normalizedEarnings == null) throw new Error('normalizedEarnings required')
  const result = computeCapEarnings({
    normalizedEarnings:  cap.normalizedEarnings.toString(),
    capitalizationRate:  cap.capitalizationRate?.toString(),
    discountRate:        cap.discountRate?.toString(),
    growthRate:          cap.growthRate?.toString(),
  })
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.capEarningsDetail.update({
      where: { approachId: cap.approachId },
      data:  { capitalizationRate: result.effectiveCapRate.toString() },
    })
    await tx.valuationApproach.update({
      where: { id: approach.id },
      data:  { indicatedValue: result.indicatedValue.toString(), computedAt: now },
    })
  })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: approach.scenario.engagement.caseId,
    targetModel: 'ValuationApproach', targetId: approach.id,
    note: `cap-earnings computed → ${result.indicatedValue.toString()}`,
  })
  revalidatePath(`/projects/${approach.scenario.engagement.caseId}`)
  return { indicatedValue: result.indicatedValue.toString() }
}

// ─────────────────────────────────────────────────
// Market — GPCM
// ─────────────────────────────────────────────────

/**
 * Compute EV/EBITDA-based indication using the median EV/EBITDA
 * multiple times the subject-company EBITDA passed as input. The
 * median vs. mean choice is a professional judgment; a follow-up slice
 * will surface a picker + tie it back to a ValuationAssumption row.
 */
export async function computeGpcmMedianEbitda(input: {
  approachId:     string
  subjectEbitda:  string
}): Promise<{ indicatedValue: string; medianEvEbitda: string }> {
  const approach = await prisma.valuationApproach.findUnique({
    where: { id: input.approachId },
    include: {
      scenario: { include: { engagement: { select: { caseId: true } } } },
      guidelineCompanies: true,
    },
  })
  if (!approach || approach.kind !== 'MARKET_GPCM') throw new NotFoundError()
  const { session } = await requireCaseAccess(approach.scenario.engagement.caseId, 'valuation:write')
  const stats = guidelineCompanyStats(approach.guidelineCompanies.map(c => ({
    evRevenue: c.evRevenue?.toString(), evEbitda: c.evEbitda?.toString(),
    peRatio:   c.peRatio?.toString(),   isIncluded: c.isIncluded,
  })))
  if (stats.evEbitda.count === 0) throw new Error('No included guideline companies with EV/EBITDA')
  const value = marketIndication({ subjectMetric: input.subjectEbitda, multiple: stats.evEbitda.median })
  const now = new Date()
  await prisma.valuationApproach.update({
    where: { id: approach.id },
    data:  { indicatedValue: value.toString(), computedAt: now },
  })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: approach.scenario.engagement.caseId,
    targetModel: 'ValuationApproach', targetId: approach.id,
    note: `GPCM (median EV/EBITDA=${stats.evEbitda.median.toString()}) → ${value.toString()}`,
  })
  revalidatePath(`/projects/${approach.scenario.engagement.caseId}`)
  return { indicatedValue: value.toString(), medianEvEbitda: stats.evEbitda.median.toString() }
}

// ─────────────────────────────────────────────────
// Market — Guideline Transactions
// ─────────────────────────────────────────────────

export async function computeGuidelineTransactionsMedian(input: {
  approachId: string
  subjectEbitda: string
}): Promise<{ indicatedValue: string; medianEvEbitda: string }> {
  const approach = await prisma.valuationApproach.findUnique({
    where: { id: input.approachId },
    include: {
      scenario: { include: { engagement: { select: { caseId: true } } } },
      guidelineTransactions: true,
    },
  })
  if (!approach || approach.kind !== 'MARKET_TRANSACTIONS') throw new NotFoundError()
  const { session } = await requireCaseAccess(approach.scenario.engagement.caseId, 'valuation:write')
  const stats = guidelineTransactionStats(approach.guidelineTransactions.map(t => ({
    evRevenue: t.evRevenue?.toString(), evEbitda: t.evEbitda?.toString(),
    isIncluded: t.isIncluded,
  })))
  if (stats.evEbitda.count === 0) throw new Error('No included transactions with EV/EBITDA')
  const value = marketIndication({ subjectMetric: input.subjectEbitda, multiple: stats.evEbitda.median })
  const now = new Date()
  await prisma.valuationApproach.update({
    where: { id: approach.id },
    data:  { indicatedValue: value.toString(), computedAt: now },
  })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: approach.scenario.engagement.caseId,
    targetModel: 'ValuationApproach', targetId: approach.id,
    note: `Transactions (median EV/EBITDA=${stats.evEbitda.median.toString()}) → ${value.toString()}`,
  })
  revalidatePath(`/projects/${approach.scenario.engagement.caseId}`)
  return { indicatedValue: value.toString(), medianEvEbitda: stats.evEbitda.median.toString() }
}

// ─────────────────────────────────────────────────
// Asset approach
// ─────────────────────────────────────────────────

export async function computeAssetApproachAction(input: { approachId: string }): Promise<{ indicatedValue: string }> {
  const approach = await prisma.valuationApproach.findUnique({
    where: { id: input.approachId },
    include: {
      scenario: { include: { engagement: { select: { caseId: true } } } },
      assetAdjustments: true,
    },
  })
  if (!approach || approach.kind !== 'ASSET') throw new NotFoundError()
  const { session } = await requireCaseAccess(approach.scenario.engagement.caseId, 'valuation:write')
  const result = computeAssetApproach(approach.assetAdjustments.map(a => ({
    side: a.side as 'ASSET' | 'LIABILITY',
    reportedValue: a.reportedValue.toString(),
    adjustment:    a.adjustment.toString(),
  })))
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    // Recompute row-level fair values from reportedValue + adjustment.
    for (const row of approach.assetAdjustments) {
      await tx.assetAdjustment.update({
        where: { id: row.id },
        data:  { fairValue: money(row.reportedValue).plus(money(row.adjustment)).toString() },
      })
    }
    await tx.valuationApproach.update({
      where: { id: approach.id },
      data:  { indicatedValue: result.adjustedNetAssets.toString(), computedAt: now },
    })
  })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: approach.scenario.engagement.caseId,
    targetModel: 'ValuationApproach', targetId: approach.id,
    note: `asset approach → ${result.adjustedNetAssets.toString()}`,
  })
  revalidatePath(`/projects/${approach.scenario.engagement.caseId}`)
  return { indicatedValue: result.adjustedNetAssets.toString() }
}

// ─────────────────────────────────────────────────
// Reconciliation
// ─────────────────────────────────────────────────

export interface RunReconciliationResult {
  scenarioId:              string
  enterpriseValue:         string
  bridgeNet:               string
  equityValue:             string
  ownershipDiscount:       string
  ownershipValue:          string
  hasBlockingAssumptions:  boolean
  blockingReasons:         string[]
}

export async function runScenarioReconciliation(input: {
  scenarioId:     string
  allowBlocking?: boolean
}): Promise<RunReconciliationResult> {
  const scenario = await prisma.valuationScenario.findUnique({
    where: { id: input.scenarioId },
    include: {
      engagement: {
        include: {
          case: { select: { id: true } },
          assumptions: { where: { status: { in: ['DRAFT', 'PROPOSED', 'REJECTED'] } } },
          ownershipAdjustments: true,
        },
      },
      approaches: true,
    },
  })
  if (!scenario) throw new NotFoundError()
  const { session, case: c } = await requireCaseAccess(scenario.engagement.caseId, 'valuation:write')

  const bridgeItems = await prisma.equityBridgeItem.findMany({
    where: { scenarioId: scenario.id }, orderBy: { displayOrder: 'asc' },
  })

  // Collect blocking reasons — every non-APPROVED assumption plus every
  // ownership adjustment that isn't APPROVED but is in a "trying to
  // apply" state (DRAFT / PROPOSED).
  const blockingReasons: string[] = []
  for (const a of scenario.engagement.assumptions) {
    blockingReasons.push(`Assumption "${a.key}" is ${a.status}`)
  }
  const approvedOwnership = scenario.engagement.ownershipAdjustments.filter(
    o => o.status === 'APPROVED',
  )
  const attemptedOwnership = scenario.engagement.ownershipAdjustments.filter(
    o => o.status === 'PROPOSED' || o.status === 'DRAFT',
  )
  for (const o of attemptedOwnership) {
    blockingReasons.push(`Ownership adjustment ${o.kind} is ${o.status}`)
  }

  const hasBlocking = blockingReasons.length > 0
  if (hasBlocking && !input.allowBlocking) {
    throw new Error(
      `Reconciliation refused — ${blockingReasons.length} blocking condition(s):\n  - ` +
      blockingReasons.join('\n  - ') +
      `\nPass allowBlocking=true to run a preview.`,
    )
  }

  // computeReconciliation refuses to apply non-APPROVED discounts,
  // so preview mode passes an empty ownership list. The reviewer must
  // approve the discount before it shows up in the persisted number.
  const result = computeReconciliation({
    approaches: scenario.approaches.map(a => ({
      id: a.id, kind: a.kind, isIncluded: a.isIncluded,
      weight: a.weight.toString(),
      indicatedValue: a.indicatedValue?.toString() ?? null,
    })),
    bridge: bridgeItems.map(b => ({
      category: (isBridgeCategory(b.category) ? b.category : 'OTHER') as BridgeCategory,
      label:    b.label,
      amount:   b.amount.toString(),
    })),
    ownership: approvedOwnership.map(o => ({
      id: o.id, kind: o.kind,
      percent:   o.percent.toString(),
      status:    o.status as AssumptionStatus,
      rationale: o.rationale,
      source:    o.source,
    })),
    strict: !input.allowBlocking,   // in preview, allow missing indicatedValues
  })

  await prisma.valuationReconciliation.upsert({
    where:  { scenarioId: scenario.id },
    create: {
      engagementId:             scenario.engagementId,
      scenarioId:               scenario.id,
      enterpriseValue:          result.enterpriseValue.toString(),
      bridgeNet:                result.bridgeNet.toString(),
      equityValue:              result.equityValue.toString(),
      ownershipDiscountApplied: result.ownershipDiscount.toString(),
      ownershipValue:           result.ownershipValue.toString(),
      hasBlockingAssumptions:   hasBlocking,
      computedAt:               new Date(),
      computedBy:               session.userId,
    },
    update: {
      enterpriseValue:          result.enterpriseValue.toString(),
      bridgeNet:                result.bridgeNet.toString(),
      equityValue:              result.equityValue.toString(),
      ownershipDiscountApplied: result.ownershipDiscount.toString(),
      ownershipValue:           result.ownershipValue.toString(),
      hasBlockingAssumptions:   hasBlocking,
      computedAt:               new Date(),
      computedBy:               session.userId,
    },
  })

  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: c.id, targetModel: 'ValuationReconciliation', targetId: scenario.id,
    note: `scenario ${scenario.key} reconciled — enterprise ${result.enterpriseValue.toString()}, equity ${result.equityValue.toString()}${hasBlocking ? ' (blocking)' : ''}`,
  })
  revalidatePath(`/projects/${c.id}`)

  return {
    scenarioId: scenario.id,
    enterpriseValue: result.enterpriseValue.toString(),
    bridgeNet:       result.bridgeNet.toString(),
    equityValue:     result.equityValue.toString(),
    ownershipDiscount: result.ownershipDiscount.toString(),
    ownershipValue:    result.ownershipValue.toString(),
    hasBlockingAssumptions: hasBlocking,
    blockingReasons,
  }
}

// silence isEffectiveAssumption import — used indirectly via math library.
void isEffectiveAssumption
