import { describe, it, expect } from 'vitest'
import { toEvidenceCitationData } from '@/lib/citations/from-ai'
import { assertSingleParent, parentColumns } from '@/lib/citations/parent'

// ─────────────────────────────────────────────────
// The anti-hallucination guard — Rule 9. If the model isn't confident,
// we NULL every coordinate field regardless of what it emitted.
// ─────────────────────────────────────────────────

describe('toEvidenceCitationData — anti-hallucination', () => {
  const parent = { financialValueId: 'fv-1' }
  const versionId = 'ver-1'

  it('keeps confident coordinates when isConfident=true', () => {
    const out = toEvidenceCitationData({
      documentVersionId: versionId,
      parent,
      hint: {
        isConfident: true,
        pageNumber:  4,
        tableName:   'Income Statement',
        rowLabel:    'Gross Revenue',
        columnLabel: '2024',
        boundingBox: { x: 0.1, y: 0.2, w: 0.3, h: 0.05, unit: 'norm' },
        rawText:     '$1,234,567',
      },
      extractionConfidence: 0.92,
    })
    expect(out.isConfident).toBe(true)
    expect(out.pageNumber).toBe(4)
    expect(out.tableName).toBe('Income Statement')
    expect(out.rowLabel).toBe('Gross Revenue')
    expect(out.columnLabel).toBe('2024')
    expect(out.boundingBox).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.05, unit: 'norm' })
    expect(out.rawText).toBe('$1,234,567')
    expect(out.confidence).toBe(0.92)
  })

  it('nulls every coordinate when the model says isConfident=false', () => {
    const out = toEvidenceCitationData({
      documentVersionId: versionId,
      parent,
      hint: {
        isConfident: false,
        pageNumber:  null,
        tableName:   null,
        rowLabel:    null,
        columnLabel: null,
        boundingBox: null,
        rawText:     'read something, could not locate',
      },
    })
    expect(out.isConfident).toBe(false)
    expect(out.pageNumber).toBeNull()
    expect(out.tableName).toBeNull()
    expect(out.rowLabel).toBeNull()
    expect(out.columnLabel).toBeNull()
    expect(out.boundingBox).toBeNull()
    // rawText is a captured substring, not a fabricated location — kept.
    expect(out.rawText).toBe('read something, could not locate')
  })

  it('DEFENSE IN DEPTH: nulls coordinates even when the model contradicts itself', () => {
    // Model set isConfident=false but ALSO emitted a pageNumber. Our
    // converter must not trust the coordinate.
    const out = toEvidenceCitationData({
      documentVersionId: versionId,
      parent,
      hint: {
        isConfident: false,
        pageNumber:  42,                        // ← contradiction
        tableName:   'Balance Sheet',           // ← contradiction
        rowLabel:    'Total Assets',            // ← contradiction
        columnLabel: '2024',                    // ← contradiction
        boundingBox: { x: 0, y: 0, w: 1, h: 1, unit: 'norm' }, // ← contradiction
        rawText:     'whatever',
      },
    })
    expect(out.isConfident).toBe(false)
    expect(out.pageNumber).toBeNull()
    expect(out.tableName).toBeNull()
    expect(out.rowLabel).toBeNull()
    expect(out.columnLabel).toBeNull()
    expect(out.boundingBox).toBeNull()
  })

  it('records a "no attempt" row when the model omitted the citation entirely', () => {
    const out = toEvidenceCitationData({
      documentVersionId: versionId,
      parent,
      hint: null,
      sourceRef: 'page 3, some table',
    })
    expect(out.isConfident).toBe(false)
    expect(out.pageNumber).toBeNull()
    expect(out.boundingBox).toBeNull()
    // sourceLabel still carries the human-readable free-text hint —
    // that's not a fabricated coordinate.
    expect(out.sourceLabel).toBe('page 3, some table')
  })

  it('parent columns are correctly propagated for each parent kind', () => {
    for (const kind of ['financialValue', 'addBack', 'valuationModel'] as const) {
      const cols = parentColumns({ kind, id: `x-${kind}` })
      const totalSet = Object.values(cols).filter(v => v !== undefined).length
      expect(totalSet).toBe(1)
    }
  })

  it('extractor identity is recorded on every write', () => {
    const out = toEvidenceCitationData({
      documentVersionId: versionId,
      parent,
      hint: { isConfident: true, pageNumber: 1, tableName: null, rowLabel: null, columnLabel: null, rawText: null },
    })
    expect(out.extractor).toBe('ai-genkit')
    expect(out.extractorVersion).toMatch(/gemini/)
  })
})

// ─────────────────────────────────────────────────
// Single-parent invariant
// ─────────────────────────────────────────────────

describe('assertSingleParent', () => {
  it('accepts exactly one parent set', () => {
    const p = assertSingleParent({ financialValueId: 'fv-1' })
    expect(p).toEqual({ kind: 'financialValue', id: 'fv-1' })
  })

  it('rejects zero parents', () => {
    expect(() => assertSingleParent({})).toThrow(/exactly one parent/)
  })

  it('rejects multiple parents', () => {
    expect(() => assertSingleParent({
      financialValueId: 'fv-1', addBackId: 'ab-1',
    })).toThrow(/exactly one parent/)
  })

  it('treats nullish as unset', () => {
    const p = assertSingleParent({ financialValueId: 'fv-1', addBackId: null, valuationModelId: null })
    expect(p.kind).toBe('financialValue')
  })
})
