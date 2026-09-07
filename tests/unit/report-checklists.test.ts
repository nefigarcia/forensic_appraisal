import { describe, it, expect } from 'vitest'
import {
  SEED_CHECKLISTS, findSeedChecklist,
  isStandardsFamily, isChecklistItemStatus,
  CHECKLIST_ITEM_STATUSES, STANDARDS_FAMILIES,
  CHECKLIST_DISCLAIMER,
} from '@/lib/reports/checklists'

describe('standards checklists', () => {
  it('exposes AICPA, ASA, NACVA presets', () => {
    const families = new Set(SEED_CHECKLISTS.map(c => c.standardsFamily))
    expect(families.has('AICPA')).toBe(true)
    expect(families.has('ASA')).toBe(true)
    expect(families.has('NACVA')).toBe(true)
  })

  it('every seed has ≥ 5 items so the professional gets meaningful reminders', () => {
    for (const c of SEED_CHECKLISTS) {
      expect(c.items.length).toBeGreaterThanOrEqual(5)
    }
  })

  it('carries a prominent non-certifying disclaimer', () => {
    expect(CHECKLIST_DISCLAIMER).toMatch(/does not.*constitute compliance/i)
    // Explicit callouts of each named standard family the slice spec mentioned.
    expect(CHECKLIST_DISCLAIMER).toMatch(/AICPA/i)
    expect(CHECKLIST_DISCLAIMER).toMatch(/ASA/i)
    expect(CHECKLIST_DISCLAIMER).toMatch(/NACVA/i)
  })

  it('findSeedChecklist finds by key', () => {
    expect(findSeedChecklist('aicpa-ssvs-summary')?.standardsFamily).toBe('AICPA')
    expect(findSeedChecklist('does-not-exist')).toBeUndefined()
  })

  it('type guards', () => {
    expect(isStandardsFamily('AICPA')).toBe(true)
    expect(isStandardsFamily('OTHER')).toBe(false)
    expect(isChecklistItemStatus('PENDING')).toBe(true)
    expect(isChecklistItemStatus('WHATEVER')).toBe(false)
    // Every declared status is a live guard hit.
    for (const s of CHECKLIST_ITEM_STATUSES) expect(isChecklistItemStatus(s)).toBe(true)
    for (const f of STANDARDS_FAMILIES) expect(isStandardsFamily(f)).toBe(true)
  })

  it('seed item keys are unique within each checklist', () => {
    for (const c of SEED_CHECKLISTS) {
      const keys = new Set<string>()
      for (const i of c.items) {
        expect(keys.has(i.key)).toBe(false)
        keys.add(i.key)
      }
    }
  })
})
