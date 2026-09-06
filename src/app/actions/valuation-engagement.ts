'use server'

/**
 * ValuationEngagement + scenario + approach CRUD for the Slice-13
 * workbench.
 *
 * Every action goes through Slice-1 tenant scoping and, when the case
 * has an engagement team, the Slice-11 gate.
 *
 * Compute actions (DCF, cap-earnings, market, asset, reconciliation)
 * live in `src/app/actions/valuation-compute.ts` so this file stays
 * focused on state.
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { requireCaseAccess, NotFoundError } from '@/lib/authz'
import {
  APPROACH_KINDS, isApproachKind, APPROACH_LABEL,
  isEngagementStatus,
} from '@/lib/valuation-v2/statuses'

// ─────────────────────────────────────────────────
// Client DTOs
// ─────────────────────────────────────────────────

export interface ValuationEngagementForClient {
  id:              string
  caseId:          string
  status:          string
  standardOfValue: string | null
  premiseOfValue:  string | null
  interestType:    string | null
  marketability:   string | null
  reportingCurrency: string
  valuationDate:   Date | null
  scenarios: Array<{
    id:          string
    key:         string
    name:        string
    probability: string | null
    approaches: Array<{
      id:             string
      kind:           string
      label:          string
      weight:         string
      isIncluded:     boolean
      indicatedValue: string | null
      computedAt:     Date | null
    }>
  }>
}

// ─────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────

export async function getValuationEngagement(caseId: string): Promise<ValuationEngagementForClient | null> {
  await requireCaseAccess(caseId, 'case:read')
  const row = await prisma.valuationEngagement.findUnique({
    where: { caseId },
    include: {
      scenarios: {
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          approaches: { orderBy: { kind: 'asc' } },
        },
      },
    },
  })
  if (!row) return null
  return {
    id: row.id, caseId: row.caseId, status: row.status,
    standardOfValue: row.standardOfValue, premiseOfValue: row.premiseOfValue,
    interestType: row.interestType, marketability: row.marketability,
    reportingCurrency: row.reportingCurrency, valuationDate: row.valuationDate,
    scenarios: row.scenarios.map(s => ({
      id: s.id, key: s.key, name: s.name,
      probability: s.probability?.toString() ?? null,
      approaches: s.approaches.map(a => ({
        id: a.id, kind: a.kind,
        label: a.label ?? APPROACH_LABEL[a.kind as keyof typeof APPROACH_LABEL] ?? a.kind,
        weight: a.weight.toString(),
        isIncluded: a.isIncluded,
        indicatedValue: a.indicatedValue?.toString() ?? null,
        computedAt: a.computedAt,
      })),
    })),
  }
}

// ─────────────────────────────────────────────────
// Create / initialize
// ─────────────────────────────────────────────────

/**
 * Create the ValuationEngagement for a case and seed BASE / LOW /
 * HIGH scenarios plus an empty ValuationApproach row per approach
 * kind on the BASE scenario. Approaches on LOW / HIGH are added by
 * the analyst on demand (avoids cluttering scenarios that may never
 * be used).
 */
export async function initializeValuationEngagement(input: { caseId: string }): Promise<{ id: string }> {
  const { session, case: c } = await requireCaseAccess(input.caseId, 'valuation:write')

  const existing = await prisma.valuationEngagement.findUnique({ where: { caseId: input.caseId } })
  if (existing) return { id: existing.id }

  const created = await prisma.$transaction(async (tx) => {
    const engagement = await tx.valuationEngagement.create({
      data: {
        caseId:          input.caseId,
        standardOfValue: c.standardOfValue ?? 'FMV',
        valuationDate:   c.valuationDate,
        createdBy:       session.userId,
      },
    })
    // Seed three scenarios.
    const scenarios = await Promise.all(['BASE', 'LOW', 'HIGH'].map((key, i) => tx.valuationScenario.create({
      data: {
        engagementId: engagement.id,
        key, name: key.charAt(0) + key.slice(1).toLowerCase(),
        displayOrder: i,
      },
    })))
    // Seed one empty approach per kind on BASE.
    const base = scenarios[0]!
    await tx.valuationApproach.createMany({
      data: APPROACH_KINDS.map(k => ({
        scenarioId: base.id, kind: k, weight: 0, isIncluded: false,
      })),
    })
    return engagement
  })

  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: input.caseId,
    targetModel: 'ValuationEngagement', targetId: created.id,
    note: 'initialized professional valuation workbench',
  })
  revalidatePath(`/projects/${input.caseId}`)
  return { id: created.id }
}

// ─────────────────────────────────────────────────
// Engagement status
// ─────────────────────────────────────────────────

export async function changeEngagementStatus(input: {
  engagementId: string
  status:       string
}): Promise<void> {
  if (!isEngagementStatus(input.status)) throw new Error(`Unknown engagement status: ${input.status}`)
  const row = await prisma.valuationEngagement.findUnique({
    where: { id: input.engagementId }, select: { id: true, caseId: true, status: true },
  })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.caseId, 'valuation:write')

  const data: Record<string, unknown> = { status: input.status }
  if (input.status === 'FINAL') {
    data.finalizedBy = session.userId
    data.finalizedAt = new Date()
  }
  await prisma.valuationEngagement.update({ where: { id: row.id }, data })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: row.caseId,
    targetModel: 'ValuationEngagement', targetId: row.id,
    oldValue: { status: row.status }, newValue: { status: input.status },
  })
  revalidatePath(`/projects/${row.caseId}`)
}

// ─────────────────────────────────────────────────
// Scenario CRUD
// ─────────────────────────────────────────────────

export async function addScenario(input: {
  engagementId: string
  key:  string
  name: string
  probability?: string
}): Promise<{ id: string }> {
  if (!input.key.trim() || !input.name.trim()) throw new Error('key and name required')
  const eng = await prisma.valuationEngagement.findUnique({
    where: { id: input.engagementId }, select: { id: true, caseId: true },
  })
  if (!eng) throw new NotFoundError()
  const { session } = await requireCaseAccess(eng.caseId, 'valuation:write')
  const count = await prisma.valuationScenario.count({ where: { engagementId: eng.id } })
  const created = await prisma.valuationScenario.create({
    data: {
      engagementId: eng.id,
      key:          input.key.trim().toUpperCase(),
      name:         input.name.trim(),
      probability:  input.probability ? input.probability : null,
      displayOrder: count,
    },
  })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: eng.caseId, targetModel: 'ValuationScenario', targetId: created.id,
    note: `added scenario ${input.key}`,
  })
  revalidatePath(`/projects/${eng.caseId}`)
  return { id: created.id }
}

// ─────────────────────────────────────────────────
// Approach CRUD
// ─────────────────────────────────────────────────

export async function addApproachToScenario(input: {
  scenarioId: string
  kind:       string
}): Promise<{ id: string }> {
  if (!isApproachKind(input.kind)) throw new Error(`Unknown approach kind: ${input.kind}`)
  const scenario = await prisma.valuationScenario.findUnique({
    where: { id: input.scenarioId },
    include: { engagement: { select: { caseId: true } } },
  })
  if (!scenario) throw new NotFoundError()
  const { session } = await requireCaseAccess(scenario.engagement.caseId, 'valuation:write')
  try {
    const created = await prisma.valuationApproach.create({
      data: {
        scenarioId: input.scenarioId, kind: input.kind,
        weight: 0, isIncluded: false,
      },
    })
    await logAction({
      userId: session.userId, action: 'SAVE_VALUATION',
      caseId: scenario.engagement.caseId,
      targetModel: 'ValuationApproach', targetId: created.id,
      note: `added ${input.kind} approach`,
    })
    revalidatePath(`/projects/${scenario.engagement.caseId}`)
    return { id: created.id }
  } catch (e: any) {
    if (e?.code === 'P2002') {
      const existing = await prisma.valuationApproach.findUnique({
        where: {
          ValuationApproach_scenario_kind: { scenarioId: input.scenarioId, kind: input.kind },
        },
        select: { id: true },
      })
      if (existing) return existing
    }
    throw e
  }
}

export async function updateApproachInclusion(input: {
  approachId: string
  isIncluded: boolean
  weight?:    string
}): Promise<void> {
  const row = await prisma.valuationApproach.findUnique({
    where: { id: input.approachId },
    include: { scenario: { include: { engagement: { select: { caseId: true } } } } },
  })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.scenario.engagement.caseId, 'valuation:write')

  const data: Record<string, unknown> = { isIncluded: input.isIncluded }
  if (input.weight != null) data.weight = input.weight
  await prisma.valuationApproach.update({ where: { id: row.id }, data })
  await logAction({
    userId: session.userId, action: 'SAVE_VALUATION',
    caseId: row.scenario.engagement.caseId,
    targetModel: 'ValuationApproach', targetId: row.id,
    note: `approach ${input.isIncluded ? 'included' : 'excluded'}`,
  })
  revalidatePath(`/projects/${row.scenario.engagement.caseId}`)
}
