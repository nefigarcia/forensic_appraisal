'use server'
import { ai } from '@/ai/genkit'
import { z } from 'genkit'

const InputSchema = z.object({
  financialData: z.array(z.object({
    id: z.string(), year: z.string(), statementType: z.string(),
    lineItem: z.string(), value: z.number(),
  })),
  industryContext: z.string().optional(),
})

const FlagSchema = z.object({
  severity:    z.enum(['HIGH', 'MEDIUM', 'LOW']),
  category:    z.enum(['BENFORD', 'OUTLIER', 'RELATED_PARTY', 'RATIO_BREAK', 'DUPLICATE', 'MARGIN_SHIFT']),
  title:       z.string(),
  description: z.string(),
  affectedIds: z.array(z.string()),
})

const OutputSchema = z.object({ flags: z.array(FlagSchema) })

export type AnomalyDetectionOutput = z.infer<typeof OutputSchema>

export async function detectAnomalies(input: z.infer<typeof InputSchema>): Promise<AnomalyDetectionOutput> {
  return anomalyFlow(input)
}

const prompt = ai.definePrompt({
  name: 'anomalyDetectionPrompt',
  input: { schema: InputSchema },
  output: { schema: OutputSchema },
  config: {
    safetySettings: [
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
    ],
  },
  prompt: `You are a forensic accountant expert in financial fraud detection and anomaly analysis.

Analyze the following multi-year financial dataset for forensic red flags.

Perform these analyses:
1. MARGIN_SHIFT: Flag if gross margin, EBITDA margin, or net margin changes >15% year-over-year with no revenue change
2. OUTLIER: Flag values that deviate >2.5 standard deviations from the 3-year mean of that line item
3. RATIO_BREAK: Flag if current ratio, D/E ratio, or interest coverage breaks by >30% without explanation
4. DUPLICATE: Flag identical dollar amounts appearing in different line items in the same year
5. BENFORD: For any line item with >10 data points, perform first-digit frequency analysis and flag if distribution deviates significantly from Benford's Law
6. RELATED_PARTY: Flag any unusually large management fees, consulting fees, or rent expenses that could indicate related-party transactions

For each flag, include the IDs of the affected financial data rows.
Prioritize HIGH severity for flags that are commonly associated with fraud or misrepresentation in litigation.

Industry context: {{industryContext}}

Financial data (JSON):
{{financialData}}`,
})

const anomalyFlow = ai.defineFlow(
  { name: 'anomalyDetectionFlow', inputSchema: InputSchema, outputSchema: OutputSchema },
  async (input) => {
    const { output } = await prompt({ ...input, financialData: JSON.stringify(input.financialData) as any })
    return output!
  },
)
