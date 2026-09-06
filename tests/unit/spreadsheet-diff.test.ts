/**
 * LOAD-BEARING: verified / locked rows are protected from silent
 * overwrite by a re-imported workbook.
 *
 * The diff engine surfaces a PROTECTED action; the server action
 * refuses to apply it unless the reviewer passes the rowKey in the
 * override list. This module tests the diff engine directly.
 */

import { describe, it, expect } from 'vitest'
import { diffRows, normalizeCompare } from '@/lib/spreadsheets/excel-import'

function row(vals: Record<string, string | null>, rowNumber = 2) {
  return { rowNumber, values: vals }
}

describe('diffRows — insert/update/unchanged classification', () => {
  const existingById = new Map<string, Record<string, string | null>>()
  existingById.set('fv-1', {
    valueId: 'fv-1', year: '2024', statementType: 'IS', lineItem: 'Revenue',
    value: '1000.00', currency: 'USD', isVerified: 'false', isLocked: 'false',
    origin: 'AI', documentId: null,
  })

  it('exact match → UNCHANGED', () => {
    const d = diffRows({
      imported: [row({
        valueId: 'fv-1', year: '2024', statementType: 'IS', lineItem: 'Revenue',
        value: '1000.00', currency: 'USD', isVerified: 'false', isLocked: 'false',
        origin: 'AI', documentId: null,
      })],
      existingById,
      identityKey: 'valueId',
      protectionPredicate: () => false, protectedFields: [],
    })
    expect(d.unchanged).toBe(1); expect(d.updates).toBe(0); expect(d.protected).toBe(0)
  })

  it('changed value on unprotected row → UPDATE', () => {
    const d = diffRows({
      imported: [row({
        valueId: 'fv-1', year: '2024', statementType: 'IS', lineItem: 'Revenue',
        value: '2500.00', currency: 'USD', isVerified: 'false', isLocked: 'false',
        origin: 'AI', documentId: null,
      })],
      existingById,
      identityKey: 'valueId',
      protectionPredicate: e => e.isVerified === 'true' || e.isLocked === 'true',
      protectedFields: ['value'],
    })
    expect(d.updates).toBe(1)
    expect(d.proposals[0]!.changedFields).toContain('value')
  })

  it('missing existing row → INSERT', () => {
    const d = diffRows({
      imported: [row({
        valueId: 'fv-new', year: '2024', statementType: 'BS', lineItem: 'Cash',
        value: '500', currency: 'USD', isVerified: 'false', isLocked: 'false',
        origin: 'HUMAN', documentId: null,
      })],
      existingById,
      identityKey: 'valueId',
      protectionPredicate: () => false, protectedFields: [],
    })
    expect(d.inserts).toBe(1)
  })

  it('empty identity → INSERT (unique per row number)', () => {
    const d = diffRows({
      imported: [row({
        valueId: '', year: '2024', statementType: 'IS', lineItem: 'X',
        value: '1', currency: 'USD', isVerified: 'false', isLocked: 'false',
        origin: 'HUMAN', documentId: null,
      })],
      existingById,
      identityKey: 'valueId',
      protectionPredicate: () => false, protectedFields: [],
    })
    expect(d.inserts).toBe(1)
  })
})

describe('diffRows — PROTECTED classification (load-bearing)', () => {
  const verified = new Map<string, Record<string, string | null>>()
  verified.set('fv-1', {
    valueId: 'fv-1', year: '2024', statementType: 'IS', lineItem: 'Revenue',
    value: '1000.00', currency: 'USD',
    isVerified: 'true', isLocked: 'false',
    origin: 'AI', documentId: null,
  })

  it('changing a protected field on a verified row → PROTECTED (not UPDATE)', () => {
    const d = diffRows({
      imported: [row({
        valueId: 'fv-1', year: '2024', statementType: 'IS', lineItem: 'Revenue',
        value: '9999.00', currency: 'USD',   // ← the "silent overwrite" attempt
        isVerified: 'true', isLocked: 'false', origin: 'AI', documentId: null,
      })],
      existingById: verified,
      identityKey: 'valueId',
      protectionPredicate: e => e.isVerified === 'true' || e.isLocked === 'true',
      protectedFields: ['value', 'currency', 'year', 'statementType', 'lineItem'],
    })
    expect(d.protected).toBe(1); expect(d.updates).toBe(0)
    expect(d.proposals[0]!.action).toBe('PROTECTED')
    expect(d.proposals[0]!.reasons.join(' ')).toMatch(/verified or locked/i)
    expect(d.proposals[0]!.protectedFields).toContain('value')
  })

  it('changing an UNPROTECTED field on a verified row → UPDATE (not PROTECTED)', () => {
    // origin is NOT in the protectedFields list, so bumping it is a
    // regular UPDATE — even on a verified row. This ensures the
    // protection is column-scoped, not row-scoped.
    const d = diffRows({
      imported: [row({
        valueId: 'fv-1', year: '2024', statementType: 'IS', lineItem: 'Revenue',
        value: '1000.00', currency: 'USD',
        isVerified: 'true', isLocked: 'false',
        origin: 'EXCEL',  // ← the ONE change
        documentId: null,
      })],
      existingById: verified,
      identityKey: 'valueId',
      protectionPredicate: e => e.isVerified === 'true' || e.isLocked === 'true',
      protectedFields: ['value', 'currency', 'year', 'statementType', 'lineItem'],
    })
    expect(d.protected).toBe(0); expect(d.updates).toBe(1)
  })

  it('a locked row is also protected', () => {
    const locked = new Map<string, Record<string, string | null>>()
    locked.set('fv-1', {
      valueId: 'fv-1', year: '2024', statementType: 'IS', lineItem: 'Revenue',
      value: '1000.00', currency: 'USD', isVerified: 'false', isLocked: 'true',
      origin: 'HUMAN', documentId: null,
    })
    const d = diffRows({
      imported: [row({
        valueId: 'fv-1', year: '2024', statementType: 'IS', lineItem: 'Revenue',
        value: '5000.00', currency: 'USD',
        isVerified: 'false', isLocked: 'true', origin: 'HUMAN', documentId: null,
      })],
      existingById: locked,
      identityKey: 'valueId',
      protectionPredicate: e => e.isVerified === 'true' || e.isLocked === 'true',
      protectedFields: ['value'],
    })
    expect(d.protected).toBe(1)
  })
})

describe('normalizeCompare — value equality is decimal-safe', () => {
  it('"1000" and "1000.0000" compare equal', () => {
    expect(normalizeCompare('1000') === normalizeCompare('1000.0000')).toBe(true)
  })
  it('boolean strings normalize to true/false', () => {
    expect(normalizeCompare('True')).toBe('true')
    expect(normalizeCompare('0')).toBe('false')
    expect(normalizeCompare('1')).toBe('true')
  })
  it('empty and null are equivalent', () => {
    expect(normalizeCompare(null)).toBe('')
    expect(normalizeCompare('')).toBe('')
  })
  it('thousands commas are stripped', () => {
    expect(normalizeCompare('1,000,000')).toBe('1000000')
  })
})
