import { describe, it, expect } from 'vitest'
import {
  TEMPLATE_KINDS, TEMPLATE_REGISTRY, getTemplate, isTemplateKind,
  FINANCIAL_LEDGER_V1, NORMALIZATION_V1, VALUATION_V1, TIE_OUTS_V1,
} from '@/lib/spreadsheets/template-schema'
import {
  METADATA_SHEET_NAME, encodeMetadata, decodeMetadata,
} from '@/lib/spreadsheets/workbook-metadata'

describe('template registry', () => {
  it('lists all four Slice-15 templates', () => {
    expect(TEMPLATE_KINDS).toEqual([
      'FINANCIAL_LEDGER', 'NORMALIZATION', 'VALUATION', 'TIE_OUTS',
    ])
  })

  it('isTemplateKind rejects noise', () => {
    expect(isTemplateKind('FINANCIAL_LEDGER')).toBe(true)
    expect(isTemplateKind('WHATEVER')).toBe(false)
  })

  it('getTemplate returns null on unknown version (defense-in-depth)', () => {
    expect(getTemplate('FINANCIAL_LEDGER', 'v99')).toBeNull()
    expect(getTemplate('FINANCIAL_LEDGER', 'v1')).toBeTruthy()
  })

  it('each template declares required columns', () => {
    for (const t of Object.values(TEMPLATE_REGISTRY)) {
      const req = t.columns.filter(c => c.required)
      expect(req.length).toBeGreaterThan(0)
    }
  })

  it('financial-ledger tags value + monetary columns as protectedIfVerified', () => {
    const t = FINANCIAL_LEDGER_V1
    const val = t.columns.find(c => c.key === 'value')
    expect(val?.protectedIfVerified).toBe(true)
  })

  it('normalization tags monetary columns as protectedIfVerified', () => {
    const t = NORMALIZATION_V1
    for (const key of ['year2', 'year1', 'ttm']) {
      const c = t.columns.find(x => x.key === key)
      expect(c?.protectedIfVerified).toBe(true)
    }
  })

  it('valuation exports scenario/approach/weight/indicated-value', () => {
    const keys = VALUATION_V1.columns.map(c => c.key)
    expect(keys).toContain('scenarioKey')
    expect(keys).toContain('approachKind')
    expect(keys).toContain('weight')
    expect(keys).toContain('indicatedValue')
  })

  it('tie-outs exports concept + source + value + status', () => {
    const keys = TIE_OUTS_V1.columns.map(c => c.key)
    for (const k of ['concept', 'sourceLabel', 'value', 'status', 'maxDifference']) {
      expect(keys).toContain(k)
    }
  })
})

describe('workbook metadata', () => {
  it('round-trips a valid metadata block', () => {
    const m = {
      app: 'ValuVault' as const,
      templateKind: 'FINANCIAL_LEDGER', templateVersion: 'v1',
      caseId: 'case-1', caseName: 'Acme', organizationId: 'org-1',
      exportedAt: '2026-01-01T00:00:00.000Z',
    }
    const encoded = encodeMetadata(m)
    expect(decodeMetadata(encoded)).toEqual(m)
  })

  it('decodeMetadata returns null on malformed input', () => {
    expect(decodeMetadata(null)).toBeNull()
    expect(decodeMetadata('not json')).toBeNull()
    expect(decodeMetadata('{"app":"NotValuVault"}')).toBeNull()
    expect(decodeMetadata('{"app":"ValuVault","templateKind":"x"}')).toBeNull()
  })

  it('exposes the hidden-sheet name (must be stable across releases)', () => {
    expect(METADATA_SHEET_NAME).toBe('_valuvault_meta')
  })
})
