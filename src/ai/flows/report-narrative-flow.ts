'use server'
import { ai } from '@/ai/genkit'
import { z } from 'genkit'

const InputSchema = z.object({
  section:         z.enum(['EXECUTIVE_SUMMARY', 'SUBJECT_COMPANY', 'INDUSTRY_OUTLOOK', 'FINANCIAL_ANALYSIS', 'NORMALIZATION', 'VALUATION_APPROACH', 'RECONCILIATION', 'LIMITING_CONDITIONS']),
  caseName:        z.string(),
  caseType:        z.string(),
  clientName:      z.string(),
  valuationDate:   z.string().optional(),
  standardOfValue: z.string().optional(),
  purposeOfValue:  z.string().optional(),
  industry:        z.string().optional(),
  naicsCode:       z.string().optional(),
  concludedValue:  z.number().optional(),
  ebitda:          z.number().optional(),
  multiplier:      z.number().optional(),
  financialSummary:z.string().optional(),
  addBackSummary:  z.string().optional(),
  existingText:    z.string().optional().describe('Existing analyst-written text to enhance (not replace entirely).'),
})

const OutputSchema = z.object({
  narrative: z.string().describe('Professional report narrative for the requested section. Use formal language suitable for court submission. 200-500 words.'),
})
export type ReportNarrativeOutput = z.infer<typeof OutputSchema>

export async function generateReportNarrative(input: z.infer<typeof InputSchema>): Promise<ReportNarrativeOutput> {
  return reportNarrativeFlow(input)
}

const SECTION_INSTRUCTIONS: Record<string, string> = {
  EXECUTIVE_SUMMARY:    'Write a 2-3 paragraph executive summary stating the purpose of the engagement, standard and premise of value, valuation date, and concluded value range.',
  SUBJECT_COMPANY:      'Describe the subject company: its history, operations, ownership structure, key personnel, and competitive position.',
  INDUSTRY_OUTLOOK:     'Describe the macro-economic and industry-specific conditions relevant to the valuation date. Reference NAICS classification and typical industry risks.',
  FINANCIAL_ANALYSIS:   'Analyze the historical financial performance including revenue trends, profitability, and key ratios. Reference the normalized EBITDA and any material variances.',
  NORMALIZATION:        'Describe and justify each normalization add-back applied to derive representative earnings. Reference specific line items and reasons.',
  VALUATION_APPROACH:   'Describe the valuation methodology used, including how the EBITDA multiple or discount rate was selected and applied.',
  RECONCILIATION:       'Reconcile the indicated values from all approaches and explain the weight assigned to each to arrive at the concluded value.',
  LIMITING_CONDITIONS:  'State standard limiting conditions, assumptions, and the appraiser\'s reliance on provided information.',
}

const prompt = ai.definePrompt({
  name: 'reportNarrativePrompt',
  input: { schema: InputSchema },
  output: { schema: OutputSchema },
  prompt: `You are an expert forensic appraiser writing a section of a business valuation report that may be submitted in litigation or court proceedings.

Write formal, professional language. Do not use first person ("I" or "we"). Use third person ("the Appraiser", "the Subject Company").
Avoid hedging language. Be precise and reference provided data.

Section instructions: ${Object.entries(SECTION_INSTRUCTIONS).map(([k,v]) => `${k}: ${v}`).join('\n')}

Write the section: {{section}}

Context:
- Case/Matter: {{caseName}}
- Client: {{clientName}}
- Engagement Type: {{caseType}}
- Valuation Date: {{valuationDate}}
- Standard of Value: {{standardOfValue}}
- Purpose: {{purposeOfValue}}
- Industry: {{industry}} (NAICS: {{naicsCode}})
- Normalized EBITDA: {{ebitda}}
- Applied Multiple: {{multiplier}}
- Concluded Value: {{concludedValue}}
- Financial Summary: {{financialSummary}}
- Add-back Summary: {{addBackSummary}}
- Existing text to enhance (if any): {{existingText}}`,
})

const reportNarrativeFlow = ai.defineFlow(
  { name: 'reportNarrativeFlow', inputSchema: InputSchema, outputSchema: OutputSchema },
  async (input) => {
    const { output } = await prompt(input)
    return output!
  },
)
