import { describe, it, expect } from 'vitest'
import { hasPermission, requirePermission, guardAction } from '@/lib/rbac'

describe('RBAC baseline (documents current behavior, not desired behavior)', () => {
  it('VIEWER can read cases but cannot create them', () => {
    expect(hasPermission('VIEWER', 'case:read')).toBe(true)
    expect(hasPermission('VIEWER', 'case:create')).toBe(false)
  })

  it('REVIEWER can accept a value but not override it', () => {
    expect(hasPermission('REVIEWER', 'value:accept')).toBe(true)
    expect(hasPermission('REVIEWER', 'value:override')).toBe(false)
  })

  it('EDITOR can override values, approve add-backs, generate reports', () => {
    expect(hasPermission('EDITOR', 'value:override')).toBe(true)
    expect(hasPermission('EDITOR', 'addback:approve')).toBe(true)
    expect(hasPermission('EDITOR', 'report:generate')).toBe(true)
  })

  it('EDITOR cannot manage the team or org settings', () => {
    expect(hasPermission('EDITOR', 'team:manage')).toBe(false)
    expect(hasPermission('EDITOR', 'org:settings')).toBe(false)
  })

  it('ADMIN has team:manage and org:settings', () => {
    expect(hasPermission('ADMIN', 'team:manage')).toBe(true)
    expect(hasPermission('ADMIN', 'org:settings')).toBe(true)
  })

  it('unknown role fails closed — nothing is permitted', () => {
    // Documents actual rbac.ts behavior: PERMISSIONS[normalized] is undefined
    // for an unknown role, so ?.includes()?? false returns false. The `?? "VIEWER"`
    // fallback in hasPermission() only fires when the role argument is nullish.
    expect(hasPermission('WHATEVER', 'case:read')).toBe(false)
    expect(hasPermission('WHATEVER', 'value:override')).toBe(false)
  })

  it('nullish role falls back to VIEWER', () => {
    expect(hasPermission(undefined as unknown as string, 'case:read')).toBe(true)
    expect(hasPermission(undefined as unknown as string, 'value:override')).toBe(false)
  })

  it('lower-cased roles are normalized', () => {
    expect(hasPermission('admin', 'org:settings')).toBe(true)
  })

  it('requirePermission throws for a missing permission', () => {
    expect(() => requirePermission('VIEWER', 'case:create')).toThrow(/Forbidden/)
  })

  it('guardAction throws when the session is null', () => {
    expect(() => guardAction(null, 'case:read')).toThrow(/Unauthorized/)
  })

  it('guardAction accepts a valid session+permission pair', () => {
    expect(() => guardAction({ role: 'ADMIN' }, 'org:settings')).not.toThrow()
  })
})
