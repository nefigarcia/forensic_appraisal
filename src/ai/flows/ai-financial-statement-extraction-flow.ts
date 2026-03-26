'use server'
import { ai } from '@/ai/genkit'
import { z } from 'genkit'

const safetyOff = [
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HARASSMENT',         threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH',        threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',  threshold: 'BLOCK_NONE' },
] as const

const InputSchema = z.object({
  documentDataUri:  z.string().describe("Base64 data URI of the document (PDF/image)."),
  documentName:     z.string().optional(),
  documentTypeHint: z.string().optional(),
})
export type FinancialDocumentExtractionInput = z.infer<typeof InputSchema>

const ItemSchema = z.object({
  year:          z.string().nullable(),
  statementType: z.string().nullable(),
  lineItem:      z.string(),
  value:         z.number().nullable(),
  unit:          z.string().optional(),
  currency:      z.string().optional(),
  confidence:    z.number().min(0).max(1).describe('Extraction confidence 0-1. Use 0.95+ for clearly legible values, 0.7-0.94 for slightly ambiguous, below 0.7 for unclear.'),
  sourceRef:     z.string().optional().describe('Location in document: e.g. "page 2, table 1, row Revenue"'),
})

const OutputSchema = z.object({
  extractedData: z.array(ItemSchema),
})
export type FinancialDocumentExtractionOutput = z.infer<typeof OutputSchema>

export async function extractFinancialData(input: FinancialDocumentExtractionInput): Promise<FinancialDocumentExtractionOutput> {
  return financialDocumentExtractionFlow(input)
}

const prompt = ai.definePrompt({
  name: 'extractFinancialDataPrompt',
  input: { schema: InputSchema },
  output: { schema: OutputSchema },
  config: { safetySettings: safetyOff },
  prompt: `You are an expert forensic accountant and financial data extractor.

Extract all financial data from the document below. For every value you extract, you MUST also provide:
- confidence: a float 0.0–1.0 indicating how certain you are the value is correct and legible
  - 0.95–1.0: value is clearly printed/typed, no ambiguity
  - 0.70–0.94: value is slightly ambiguous (e.g. faint scan, small font)
  - 0.40–0.69: value is unclear or partially obscured
  - below 0.40: value is a best guess
- sourceRef: the exact location of the value in the document (e.g. "page 3, Income Statement table, row: 'Gross Revenue'")

Instructions:
1. Extract ALL financial line items and their values.
2. Group by the year they pertain to.
3. For scanned/handwritten documents, perform careful OCR and note lower confidence.
4. Negative values (in parentheses or with minus sign) must be stored as negative numbers.
5. Do NOT invent values. If a value is illegible, return confidence < 0.4 and value as null.

Document type hint: {{documentTypeHint}}
Document name: {{documentName}}

Document: {{media url=documentDataUri}}`,
})

const financialDocumentExtractionFlow = ai.defineFlow(
  { name: 'financialDocumentExtractionFlow', inputSchema: InputSchema, outputSchema: OutputSchema },
  async (input) => {
    const { output } = await prompt(input)
    return output!
  },
)
