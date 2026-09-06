import { describe, it, expect } from 'vitest'
import {
  aggregateEquityValues,
  aggregateEnterpriseValues,
  probabilityWeightedEquityValue,
  probabilityWeightedOwnershipValue,
  type ScenarioResult,
} from '@/lib/valuation-v2/scenarios'
import {
  ASSUMPTION_STATUSES,
  ALLOWED_ASSUMPTION_TRANSITIONS,
  canAssumptionTransition,
  assumptionTransitionRequiresNote,
  isEffectiveAssumption,
  APPROACH_KINDS,
  isApproachKind,
  OWNERSHIP_ADJUSTMENT_KINDS,
  isOwnershipAdjustmentKind,
  BRIDGE_CATEGORIES,
  isBridgeCategory,
} from '@/lib/valuation-v2/statuses'

describe('scenario aggregation', () => {
  const rows: ScenarioResult[] = [
    { scenarioKey: 'BASE', scenarioName: 'Base', probability: '0.5',  equityValue: '10000000', ownershipValue: '8000000' },
    { scenarioKey: 'LOW',  scenarioName: 'Low',  probability: '0.3',  equityValue: '6000000',  ownershipValue: '4800000' },
    { scenarioKey: 'HIGH', scenarioName: 'High', probability: '0.2',  equityValue: '14000000', ownershipValue: '11200000' },
  ]

  it('aggregateEquityValues returns min/max/mean', () => {
    const a = aggregateEquityValues(rows)
    expect(a.min?.toString()).toBe('6000000')
    expect(a.max?.toString()).toBe('14000000')
    expect(a.mean?.toString()).toBe('10000000')
  })

  it('probabilityWeightedEquityValue normalizes when probs sum to 1', () => {
    // 0.5 * 10M + 0.3 * 6M + 0.2 * 14M = 9.6M
    const v = probabilityWeightedEquityValue(rows)
    expect(v?.toString()).toBe('9600000')
  })

  it('probabilityWeightedOwnershipValue is the same shape', () => {
    const v = probabilityWeightedOwnershipValue(rows)
    // 0.5 * 8M + 0.3 * 4.8M + 0.2 * 11.2M = 7.68M
    expect(v?.toString()).toBe('7680000')
  })

  it('returns null when NO scenario has a probability (no silent fallback)', () => {
    const noProbRows: ScenarioResult[] = rows.map(r => ({ ...r, probability: null }))
    expect(probabilityWeightedEquityValue(noProbRows)).toBeNull()
    expect(probabilityWeightedOwnershipValue(noProbRows)).toBeNull()
  })

  it('aggregate ignores rows missing the picked field', () => {
    const a = aggregateEnterpriseValues([
      { scenarioKey: 'A', scenarioName: 'A', enterpriseValue: '5' },
      { scenarioKey: 'B', scenarioName: 'B', enterpriseValue: null },
    ])
    expect(a.mean?.toString()).toBe('5')
  })
})

describe('assumption state machine', () => {
  it('closed transition table — no self-loops', () => {
    for (const s of ASSUMPTION_STATUSES) {
      expect(ALLOWED_ASSUMPTION_TRANSITIONS[s].includes(s)).toBe(false)
    }
  })

  it('happy path: DRAFT → PROPOSED → APPROVED', () => {
    expect(canAssumptionTransition('DRAFT',    'PROPOSED')).toBe(true)
    expect(canAssumptionTransition('PROPOSED', 'APPROVED')).toBe(true)
  })

  it('rejected rework: PROPOSED → REJECTED → DRAFT → PROPOSED', () => {
    expect(canAssumptionTransition('PROPOSED', 'REJECTED')).toBe(true)
    expect(canAssumptionTransition('REJECTED', 'DRAFT')).toBe(true)
    expect(canAssumptionTransition('DRAFT',    'PROPOSED')).toBe(true)
  })

  it('APPROVED is terminal except for SUPERSEDED', () => {
    expect(canAssumptionTransition('APPROVED', 'SUPERSEDED')).toBe(true)
    expect(canAssumptionTransition('APPROVED', 'DRAFT')).toBe(false)
    expect(canAssumptionTransition('APPROVED', 'REJECTED')).toBe(false)
  })

  it('SUPERSEDED is fully terminal', () => {
    for (const to of ASSUMPTION_STATUSES) {
      expect(canAssumptionTransition('SUPERSEDED', to)).toBe(false)
    }
  })

  it('REJECTED requires a note', () => {
    expect(assumptionTransitionRequiresNote('REJECTED')).toBe(true)
    expect(assumptionTransitionRequiresNote('APPROVED')).toBe(false)
  })

  it('isEffectiveAssumption is true ONLY for APPROVED', () => {
    expect(isEffectiveAssumption('APPROVED')).toBe(true)
    for (const s of ASSUMPTION_STATUSES) {
      if (s !== 'APPROVED') expect(isEffectiveAssumption(s)).toBe(false)
    }
  })
})

describe('closed enums — type guards', () => {
  it('APPROACH_KINDS has exactly the five slice-13 kinds', () => {
    expect(APPROACH_KINDS.length).toBe(5)
    for (const k of APPROACH_KINDS) expect(isApproachKind(k)).toBe(true)
    expect(isApproachKind('SOMETHING_ELSE')).toBe(false)
  })

  it('OWNERSHIP_ADJUSTMENT_KINDS includes DLOC/DLOM/KEY_PERSON/OTHER', () => {
    expect(OWNERSHIP_ADJUSTMENT_KINDS).toContain('DLOC')
    expect(OWNERSHIP_ADJUSTMENT_KINDS).toContain('DLOM')
    expect(isOwnershipAdjustmentKind('DLOC')).toBe(true)
    expect(isOwnershipAdjustmentKind('WHATEVER')).toBe(false)
  })

  it('BRIDGE_CATEGORIES cover the standard bridge line items', () => {
    for (const k of ['CASH', 'DEBT', 'DEBT_LIKE', 'NON_OPERATING', 'PREFERRED_EQUITY', 'NCI', 'OTHER']) {
      expect(isBridgeCategory(k)).toBe(true)
    }
    expect(isBridgeCategory('FOO')).toBe(false)
    // Every declared category is a live isBridgeCategory hit.
    for (const c of BRIDGE_CATEGORIES) expect(isBridgeCategory(c)).toBe(true)
  })
})
