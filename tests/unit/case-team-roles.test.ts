import { describe, it, expect } from 'vitest'
import {
  CASE_ROLES,
  CASE_ROLE_LABEL,
  CASE_ROLE_RANK,
  atLeastCaseRole,
  canManageTeam,
  isCaseRole,
} from '@/lib/case-team/roles'

describe('CASE_ROLES catalog', () => {
  it('exposes the seven documented case roles', () => {
    expect([...CASE_ROLES].sort()).toEqual([
      'ANALYST',
      'ENGAGEMENT_PARTNER',
      'EXTERNAL_COLLABORATOR',
      'MANAGER',
      'READ_ONLY',
      'REVIEWER',
      'SENIOR',
    ])
  })

  it('every role has a label and a rank', () => {
    for (const r of CASE_ROLES) {
      expect(CASE_ROLE_LABEL[r]).toBeTruthy()
      expect(typeof CASE_ROLE_RANK[r]).toBe('number')
    }
  })

  it('isCaseRole guards the enum', () => {
    for (const r of CASE_ROLES) expect(isCaseRole(r)).toBe(true)
    expect(isCaseRole('random-role')).toBe(false)
    expect(isCaseRole('engagement_partner')).toBe(false)  // case-sensitive
  })
})

describe('atLeastCaseRole — rank comparison', () => {
  it('Engagement Partner ≥ Manager ≥ Senior ≥ Analyst ≥ Reviewer ≥ Read-only', () => {
    expect(atLeastCaseRole('ENGAGEMENT_PARTNER', 'MANAGER')).toBe(true)
    expect(atLeastCaseRole('MANAGER',             'SENIOR')).toBe(true)
    expect(atLeastCaseRole('SENIOR',              'ANALYST')).toBe(true)
    expect(atLeastCaseRole('ANALYST',             'REVIEWER')).toBe(true)
    expect(atLeastCaseRole('REVIEWER',            'READ_ONLY')).toBe(true)
  })

  it('lower ranks are rejected against higher minimums', () => {
    expect(atLeastCaseRole('ANALYST',             'MANAGER')).toBe(false)
    expect(atLeastCaseRole('READ_ONLY',           'REVIEWER')).toBe(false)
    expect(atLeastCaseRole('EXTERNAL_COLLABORATOR','READ_ONLY')).toBe(false)
  })

  it('unknown roles are rejected', () => {
    expect(atLeastCaseRole('BOGUS', 'READ_ONLY')).toBe(false)
  })
})

describe('canManageTeam', () => {
  it('only ENGAGEMENT_PARTNER and MANAGER may manage the team', () => {
    expect(canManageTeam('ENGAGEMENT_PARTNER')).toBe(true)
    expect(canManageTeam('MANAGER')).toBe(true)
  })

  it.each(['SENIOR','ANALYST','REVIEWER','READ_ONLY','EXTERNAL_COLLABORATOR','BOGUS'])(
    '%s cannot manage the team',
    (role) => {
      expect(canManageTeam(role)).toBe(false)
    },
  )
})
