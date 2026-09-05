/**
 * Convert an AI extraction citation hint into DB columns.
 *
 * The AI schema (see src/ai/flows/ai-financial-statement-extraction-flow.ts)
 * emits `citation: { isConfident, pageNumber, tableName, rowLabel,
 * columnLabel, boundingBox, rawText }`. This helper is the single point
 * that decides how those hints become an EvidenceCitation write.
 *
 * Anti-hallucination invariant (Rule 9): when `isConfident=false`, we
 * NULL every coordinate field — even if the model happened to emit one.
 * This is defense-in-depth against a model that might set the flag but
 * still fill in guesses.
 */

const EXTRACTOR         = 'ai-genkit'
const EXTRACTOR_VERSION = 'gemini-2.5-flash-v1'

export interface AiCitationHint {
  isConfident: boolean
  pageNumber:  number | null
  tableName:   string | null
  rowLabel:    string | null
  columnLabel: string | null
  boundingBox?: { x: number; y: number; w: number; h: number; unit?: 'norm' | 'pt' | 'px' } | null
  rawText:     string | null
}

/**
 * Turn an AI hint into a plain object ready for
 * `prisma.evidenceCitation.create({ data })`. The caller supplies the
 * DocumentVersion id and the parent-column shape.
 */
export function toEvidenceCitationData(input: {
  documentVersionId: string
  parent: { financialValueId?: string; addBackId?: string; valuationModelId?: string }
  hint:   AiCitationHint | null
  sourceRef?: string | null           // human-readable free text from the same extractor
  extractionConfidence?: number | null
}): {
  documentVersionId: string
  financialValueId?: string
  addBackId?:        string
  valuationModelId?: string
  pageNumber:        number | null
  sourceLabel:       string | null
  tableName:         string | null
  rowLabel:          string | null
  columnLabel:       string | null
  boundingBox:       object | null
  rawText:           string | null
  extractor:         string
  extractorVersion:  string
  confidence:        number | null
  isConfident:       boolean
} {
  const h = input.hint

  // If the model never emitted a citation object, we still record a
  // low-confidence row so the UI can display "the AI made no attempt".
  if (!h) {
    return {
      documentVersionId: input.documentVersionId,
      ...input.parent,
      pageNumber: null, sourceLabel: input.sourceRef ?? null,
      tableName: null, rowLabel: null, columnLabel: null,
      boundingBox: null, rawText: null,
      extractor: EXTRACTOR, extractorVersion: EXTRACTOR_VERSION,
      confidence: input.extractionConfidence ?? null,
      isConfident: false,
    }
  }

  // Anti-hallucination guard: if the model says it's not confident, we
  // NULL every coordinate field regardless of what it emitted.
  const confident = h.isConfident === true
  return {
    documentVersionId: input.documentVersionId,
    ...input.parent,
    pageNumber:  confident ? h.pageNumber  : null,
    sourceLabel: input.sourceRef ?? null,
    tableName:   confident ? h.tableName   : null,
    rowLabel:    confident ? h.rowLabel    : null,
    columnLabel: confident ? h.columnLabel : null,
    boundingBox: confident && h.boundingBox ? h.boundingBox : null,
    // rawText is *what the model read*, so we keep it either way — it's
    // not a fabricated location, it's a captured substring.
    rawText:     h.rawText ?? null,
    extractor:   EXTRACTOR,
    extractorVersion: EXTRACTOR_VERSION,
    confidence:  input.extractionConfidence ?? null,
    isConfident: confident,
  }
}
