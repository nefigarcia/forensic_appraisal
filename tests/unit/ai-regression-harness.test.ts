/**
 * Deterministic AI-regression harness tests.
 *
 * The harness accepts a runner function; here the runner returns
 * hand-crafted outputs so we can exercise every metric independently
 * without touching an LLM.
 */

import { describe, it, expect } from 'vitest'
import {
  scoreFixture, runRegression,
  type FixtureExtraction, type ExtractionOutputRow,
} from '@/lib/ai/regression-harness'
import { FIXTURES } from '../fixtures/ai-regression/fixtures'

// ─────────────────────────────────────────────────
// scoreFixture
// ─────────────────────────────────────────────────

describe('scoreFixture — per-fixture metrics', () => {
  const fixture: FixtureExtraction = {
    documentId: 'doc-1', filename: 'x.pdf',
    expected: [
      { year: '2024', statementType: 'IS', lineItem: 'Revenue',    value: '1000',
        citation: { pageNumber: 2, sourceLabel: 'IS — Revenue' } },
      { year: '2024', statementType: 'IS', lineItem: 'COGS',       value: '400',
        citation: { pageNumber: 2, sourceLabel: 'IS — COGS' } },
      { year: '2024', statementType: 'IS', lineItem: 'Net income', value: '150' },
    ],
  }

  it('perfect match → accuracy 1.0, citations 1.0', () => {
    const actual: ExtractionOutputRow[] = [
      { year: '2024', statementType: 'IS', lineItem: 'Revenue',    value: '1000',
        citation: { pageNumber: 2, sourceLabel: 'IS — Revenue' } },
      { year: '2024', statementType: 'IS', lineItem: 'COGS',       value: '400',
        citation: { pageNumber: 2, sourceLabel: 'IS — COGS' } },
      { year: '2024', statementType: 'IS', lineItem: 'Net income', value: '150' },
    ]
    const m = scoreFixture(fixture, actual)
    expect(m.matchedValues).toBe(3)
    expect(m.missingValues).toBe(0)
    expect(m.wrongValues).toBe(0)
    expect(m.falseValues).toBe(0)
    expect(m.accuracy).toBe(1)
    expect(m.citationCorrectness).toBe(1)
  })

  it('missing row → missingValues bumps and accuracy drops proportionally', () => {
    const actual: ExtractionOutputRow[] = [
      { year: '2024', statementType: 'IS', lineItem: 'Revenue', value: '1000' },
      { year: '2024', statementType: 'IS', lineItem: 'COGS',    value: '400' },
    ]
    const m = scoreFixture(fixture, actual)
    expect(m.matchedValues).toBe(2)
    expect(m.missingValues).toBe(1)
    expect(m.accuracy).toBeCloseTo(2 / 3, 5)
  })

  it('wrong value → wrongValues bumps + not counted as matched', () => {
    const actual: ExtractionOutputRow[] = [
      { year: '2024', statementType: 'IS', lineItem: 'Revenue',    value: '9999' },
      { year: '2024', statementType: 'IS', lineItem: 'COGS',       value: '400' },
      { year: '2024', statementType: 'IS', lineItem: 'Net income', value: '150' },
    ]
    const m = scoreFixture(fixture, actual)
    expect(m.wrongValues).toBe(1)
    expect(m.matchedValues).toBe(2)
    expect(m.missingValues).toBe(0)
    expect(m.accuracy).toBeCloseTo(2 / 3, 5)
  })

  it('hallucinated row → falseValues bumps but doesnt hurt accuracy of the labeled set', () => {
    const actual: ExtractionOutputRow[] = [
      { year: '2024', statementType: 'IS', lineItem: 'Revenue',    value: '1000' },
      { year: '2024', statementType: 'IS', lineItem: 'COGS',       value: '400' },
      { year: '2024', statementType: 'IS', lineItem: 'Net income', value: '150' },
      { year: '2024', statementType: 'IS', lineItem: 'MADE UP',    value: '9999' },
    ]
    const m = scoreFixture(fixture, actual)
    expect(m.falseValues).toBe(1)
    expect(m.accuracy).toBe(1)  // labeled set is fully matched
  })

  it('decimal-safe value comparison — "1000" == "1000.0000"', () => {
    const actual: ExtractionOutputRow[] = [
      { year: '2024', statementType: 'IS', lineItem: 'Revenue',    value: '1000.0000' },
      { year: '2024', statementType: 'IS', lineItem: 'COGS',       value: '400.00' },
      { year: '2024', statementType: 'IS', lineItem: 'Net income', value: '150' },
    ]
    const m = scoreFixture(fixture, actual)
    expect(m.matchedValues).toBe(3)
    expect(m.wrongValues).toBe(0)
  })

  it('thousands separators normalized', () => {
    const actual: ExtractionOutputRow[] = [
      { year: '2024', statementType: 'IS', lineItem: 'Revenue',    value: '1,000' },
      { year: '2024', statementType: 'IS', lineItem: 'COGS',       value: '400' },
      { year: '2024', statementType: 'IS', lineItem: 'Net income', value: '150' },
    ]
    const m = scoreFixture(fixture, actual)
    expect(m.matchedValues).toBe(3)
  })

  it('case-insensitive lineItem matching', () => {
    const actual: ExtractionOutputRow[] = [
      { year: '2024', statementType: 'IS', lineItem: 'REVENUE',    value: '1000' },
      { year: '2024', statementType: 'IS', lineItem: 'cogs',       value: '400' },
      { year: '2024', statementType: 'IS', lineItem: 'Net Income', value: '150' },
    ]
    const m = scoreFixture(fixture, actual)
    expect(m.matchedValues).toBe(3)
  })

  it('citation with wrong page number does NOT count', () => {
    const actual: ExtractionOutputRow[] = [
      { year: '2024', statementType: 'IS', lineItem: 'Revenue',    value: '1000',
        citation: { pageNumber: 99, sourceLabel: 'IS — Revenue' } },
      { year: '2024', statementType: 'IS', lineItem: 'COGS',       value: '400' },
      { year: '2024', statementType: 'IS', lineItem: 'Net income', value: '150' },
    ]
    const m = scoreFixture(fixture, actual)
    // 2 citations expected; only COGS is present (missing) → both fail.
    // Actually — first row's citation is wrong (page mismatch) → 0 present for revenue;
    // COGS has no citation supplied → 0 present.
    expect(m.citationsExpected).toBe(2)
    expect(m.citationsPresent).toBe(0)
    expect(m.citationCorrectness).toBe(0)
  })
})

// ─────────────────────────────────────────────────
// runRegression — end-to-end aggregation
// ─────────────────────────────────────────────────

describe('runRegression — end-to-end', () => {
  it('scores every fixture and summarizes', async () => {
    // A runner that returns whatever the fixture expects — a "perfect" model.
    const runner = async (f: FixtureExtraction): Promise<ExtractionOutputRow[]> =>
      f.expected.map(e => ({ year: e.year, statementType: e.statementType, lineItem: e.lineItem, value: e.value, citation: e.citation }))
    const summary = await runRegression(FIXTURES, runner)
    expect(summary.totalDocuments).toBe(FIXTURES.length)
    expect(summary.overallAccuracy).toBe(1)
    expect(summary.overallCitationCorrectness).toBe(1)
    expect(summary.perDocument.length).toBe(FIXTURES.length)
  })

  it('aggregates when some fixtures are partially wrong', async () => {
    const runner = async (f: FixtureExtraction): Promise<ExtractionOutputRow[]> => {
      // Drop the first expected row of every fixture.
      return f.expected.slice(1).map(e => ({
        year: e.year, statementType: e.statementType, lineItem: e.lineItem,
        value: e.value, citation: e.citation,
      }))
    }
    const summary = await runRegression(FIXTURES, runner)
    expect(summary.overallAccuracy).toBeLessThan(1)
    expect(summary.totalMissingValues).toBe(FIXTURES.length)
  })
})

// ─────────────────────────────────────────────────
// Documentation: this is NOT a confidence measure
// ─────────────────────────────────────────────────

describe('metric labeling', () => {
  it('accuracy and citationCorrectness are ratios in [0, 1] — never "confidence"', () => {
    // The Slice-17 prompt insists: subjective Gemini confidence must
    // not be called "accuracy". This test documents that the harness
    // computes accuracy against LABELED FIXTURES only. If a future
    // change tried to fold model confidence into `accuracy`, it would
    // break this documented invariant.
    const m = scoreFixture(
      { documentId: 'x', filename: 'y', expected: [
        { year: '2024', statementType: 'IS', lineItem: 'r', value: '1' },
      ] },
      [{ year: '2024', statementType: 'IS', lineItem: 'r', value: '1' }],
    )
    // No `confidence` field on the metric shape.
    expect((m as any).confidence).toBeUndefined()
    expect(m.accuracy).toBeGreaterThanOrEqual(0)
    expect(m.accuracy).toBeLessThanOrEqual(1)
    expect(m.citationCorrectness).toBeGreaterThanOrEqual(0)
    expect(m.citationCorrectness).toBeLessThanOrEqual(1)
  })
})
