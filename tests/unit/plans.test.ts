import { describe, it, expect } from 'vitest'
import { PLANS, getPlan, isWithinCaseLimit, isWithinUserLimit } from '@/lib/plans'

describe('Plan limits baseline', () => {
  it('exposes the four documented plans', () => {
    expect(Object.keys(PLANS).sort()).toEqual(['ENTERPRISE', 'FIRM', 'SOLO', 'TRIAL'])
  })

  it('TRIAL is the safe fallback for unknown planIds', () => {
    expect(getPlan('BOGUS').id).toBe('TRIAL')
  })

  it('TRIAL enforces the 3-case ceiling', () => {
    const trial = PLANS.TRIAL
    expect(isWithinCaseLimit(trial, 2)).toBe(true)
    expect(isWithinCaseLimit(trial, 3)).toBe(false)
  })

  it('ENTERPRISE treats -1 as unlimited', () => {
    expect(isWithinCaseLimit(PLANS.ENTERPRISE, 10_000)).toBe(true)
    expect(isWithinUserLimit(PLANS.ENTERPRISE, 10_000)).toBe(true)
  })
})
