/**
 * AI regression harness.
 *
 * Given a labeled fixture set of documents and their expected
 * extractions, compute deterministic metrics on an extraction
 * function's output.
 *
 * We use the word "accuracy" here deliberately and narrowly — it is
 * the ratio of correctly extracted labeled values to the total
 * labeled values. We do NOT surface the model's own reported
 * confidence as accuracy. The distinction is load-bearing: subjective
 * confidence is a different measurement from the objective true/false
 * signal against a labeled fixture.
 *
 * Every metric is computed strictly by string equality on the
 * canonicalized (statementType, year, lineItem) key. Numeric values
 * are compared as decimal strings after normalizing trailing zeros
 * and thousands separators — the same rule the Slice-15 workbook
 * differ uses.
 */

// ─────────────────────────────────────────────────
// Fixture + output shapes
// ─────────────────────────────────────────────────

export interface FixtureExtraction {
  documentId:    string
  filename:      string
  expected: Array<{
    id?:            string   // optional stable id for matching
    year:           string
    statementType:  string
    lineItem:       string
    value:          string   // canonical decimal string
    citation?: {
      pageNumber?:  number
      sourceLabel?: string
    }
  }>
}

export interface ExtractionOutputRow {
  year:           string
  statementType:  string
  lineItem:       string
  value:          string
  citation?: {
    pageNumber?:  number
    sourceLabel?: string
  }
}

// ─────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────

export interface FixtureMetrics {
  documentId:            string
  filename:              string
  expectedCount:         number
  actualCount:           number
  matchedValues:         number  // correctly extracted (key + value)
  missingValues:         number  // expected but not present in actual
  falseValues:           number  // present in actual but not expected
  wrongValues:           number  // matched key but wrong value
  citationsExpected:     number
  citationsPresent:      number
  // Accuracy = matchedValues / expectedCount (0 if no expected)
  accuracy:              number
  // Citation correctness = citationsPresent / citationsExpected
  citationCorrectness:   number
}

export interface HarnessSummary {
  totalDocuments:        number
  totalExpectedValues:   number
  totalMatchedValues:    number
  totalMissingValues:    number
  totalFalseValues:      number
  totalWrongValues:      number
  totalCitationsExpected: number
  totalCitationsPresent: number
  overallAccuracy:       number
  overallCitationCorrectness: number
  perDocument:           FixtureMetrics[]
}

// ─────────────────────────────────────────────────
// Harness runner
// ─────────────────────────────────────────────────

export type ExtractionRunner = (fixture: FixtureExtraction) => Promise<ExtractionOutputRow[]>

/**
 * Run the harness over an array of fixtures using a caller-supplied
 * `runner`. The runner returns the extraction output for a given
 * fixture; in tests it's a mock returning canned rows, in a real
 * regression run it hits the model.
 */
export async function runRegression(
  fixtures: FixtureExtraction[],
  runner:   ExtractionRunner,
): Promise<HarnessSummary> {
  const perDoc: FixtureMetrics[] = []
  for (const f of fixtures) {
    const actual = await runner(f)
    perDoc.push(scoreFixture(f, actual))
  }
  return summarize(perDoc)
}

export function scoreFixture(f: FixtureExtraction, actual: ExtractionOutputRow[]): FixtureMetrics {
  const expByKey = new Map<string, typeof f.expected[number]>()
  for (const e of f.expected) expByKey.set(rowKey(e), e)

  const actByKey = new Map<string, ExtractionOutputRow>()
  for (const a of actual) actByKey.set(rowKey(a), a)

  let matched = 0, missing = 0, wrong = 0
  let citationsExpected = 0, citationsPresent = 0

  for (const [key, e] of expByKey) {
    if (e.citation) citationsExpected++
    const a = actByKey.get(key)
    if (!a) { missing++; continue }
    if (normalizeValue(a.value) === normalizeValue(e.value)) {
      matched++
    } else {
      wrong++
    }
    if (e.citation) {
      if (matchesCitation(a.citation, e.citation)) citationsPresent++
    }
  }

  // False values — rows present in actual but no expected key.
  let falseValues = 0
  for (const key of actByKey.keys()) {
    if (!expByKey.has(key)) falseValues++
  }

  const expectedCount = f.expected.length
  const accuracy = expectedCount === 0 ? 0 : matched / expectedCount
  const citationCorrectness = citationsExpected === 0 ? 0 : citationsPresent / citationsExpected

  return {
    documentId:          f.documentId,
    filename:            f.filename,
    expectedCount,
    actualCount:         actual.length,
    matchedValues:       matched,
    missingValues:       missing,
    falseValues,
    wrongValues:         wrong,
    citationsExpected,
    citationsPresent,
    accuracy,
    citationCorrectness,
  }
}

function summarize(rows: FixtureMetrics[]): HarnessSummary {
  let te = 0, tm = 0, tmi = 0, tf = 0, tw = 0, tce = 0, tcp = 0
  for (const r of rows) {
    te  += r.expectedCount
    tm  += r.matchedValues
    tmi += r.missingValues
    tf  += r.falseValues
    tw  += r.wrongValues
    tce += r.citationsExpected
    tcp += r.citationsPresent
  }
  return {
    totalDocuments:            rows.length,
    totalExpectedValues:       te,
    totalMatchedValues:        tm,
    totalMissingValues:        tmi,
    totalFalseValues:          tf,
    totalWrongValues:          tw,
    totalCitationsExpected:    tce,
    totalCitationsPresent:     tcp,
    overallAccuracy:           te  === 0 ? 0 : tm  / te,
    overallCitationCorrectness: tce === 0 ? 0 : tcp / tce,
    perDocument:               rows,
  }
}

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

function rowKey(r: { year: string; statementType: string; lineItem: string }): string {
  return `${r.year}||${r.statementType}||${r.lineItem.toLowerCase().trim()}`
}

/** Decimal-safe string comparison. Same rules as Slice-15 diff. */
function normalizeValue(v: string | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v).trim().replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s
  if (s.includes('.')) return s.replace(/0+$/, '').replace(/\.$/, '')
  return s
}

function matchesCitation(
  a: ExtractionOutputRow['citation'] | undefined,
  e: { pageNumber?: number; sourceLabel?: string } | undefined,
): boolean {
  if (!a || !e) return false
  if (e.pageNumber != null && a.pageNumber !== e.pageNumber) return false
  if (e.sourceLabel && e.sourceLabel.toLowerCase().trim() !== (a.sourceLabel ?? '').toLowerCase().trim()) return false
  return true
}
