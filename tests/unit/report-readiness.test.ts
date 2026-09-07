import { describe, it, expect } from 'vitest'
import { computeReadiness, isSectionStale } from '@/lib/reports/readiness'
import { SECTION_CATALOG, type ReportSectionKey } from '@/lib/reports/sections'

const REQUIRED_KEYS = (Object.keys(SECTION_CATALOG) as ReportSectionKey[])
  .filter(k => SECTION_CATALOG[k].isRequired)

describe('computeReadiness', () => {
  it('0 % when nothing is drafted', () => {
    const r = computeReadiness([], 'hash-a')
    expect(r.readinessPercent).toBe(0)
    expect(r.requiredApproved).toBe(0)
    expect(r.requiredStale).toBe(0)
    expect(r.isFinalReady).toBe(false)
    // Every required section appears in the rows (as NOT_STARTED).
    expect(r.rows.filter(row => row.isRequired && row.status === 'NOT_STARTED').length)
      .toBe(REQUIRED_KEYS.length)
  })

  it('100 % when every required section is APPROVED and not stale', () => {
    const sections = REQUIRED_KEYS.map(k => ({
      key: k, status: 'APPROVED', currentFactsHash: 'hash-a', currentBody: 'text',
    }))
    const r = computeReadiness(sections, 'hash-a')
    expect(r.readinessPercent).toBe(100)
    expect(r.requiredApproved).toBe(REQUIRED_KEYS.length)
    expect(r.isFinalReady).toBe(true)
  })

  it('does NOT count stale APPROVED sections in requiredApproved', () => {
    // A section is APPROVED but drafted against an old facts hash.
    const sections = REQUIRED_KEYS.map((k, i) => ({
      key: k, status: 'APPROVED',
      currentFactsHash: i === 0 ? 'OLD-hash' : 'hash-a', // one stale
      currentBody: 'text',
    }))
    const r = computeReadiness(sections, 'hash-a')
    expect(r.requiredApproved).toBe(REQUIRED_KEYS.length - 1)
    expect(r.requiredStale).toBe(1)
    expect(r.isFinalReady).toBe(false)
  })

  it('AT_RISK checklist items block isFinalReady even at 100 % section approval', () => {
    const sections = REQUIRED_KEYS.map(k => ({
      key: k, status: 'APPROVED', currentFactsHash: 'h', currentBody: 't',
    }))
    const r = computeReadiness(sections, 'h', { atRisk: 1, pending: 0 })
    expect(r.readinessPercent).toBe(100)
    expect(r.isFinalReady).toBe(false)
    expect(r.atRiskChecklistItems).toBe(1)
  })

  it('optional sections are counted separately from the readiness percent', () => {
    // Approve every optional section but NONE of the required ones.
    const optional = (Object.keys(SECTION_CATALOG) as ReportSectionKey[]).filter(k => !SECTION_CATALOG[k].isRequired)
    const sections = optional.map(k => ({
      key: k, status: 'APPROVED', currentFactsHash: 'h', currentBody: 't',
    }))
    const r = computeReadiness(sections, 'h')
    expect(r.readinessPercent).toBe(0)
    expect(r.optionalApproved).toBe(optional.length)
  })
})

describe('isSectionStale', () => {
  it('null currentHash → not stale', () => {
    expect(isSectionStale(null, 'x')).toBe(false)
  })
  it('null current facts hash → not stale (facts unknown)', () => {
    expect(isSectionStale('h', null)).toBe(false)
  })
  it('different hashes → stale', () => {
    expect(isSectionStale('h1', 'h2')).toBe(true)
  })
  it('same hash → not stale', () => {
    expect(isSectionStale('h1', 'h1')).toBe(false)
  })
})
