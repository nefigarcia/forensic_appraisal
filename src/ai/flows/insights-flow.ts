'use server'
import { ai } from '@/ai/genkit'
import { z } from 'genkit'

const InputSchema = z.object({
  caseName:        z.string(),
  caseType:        z.string(),
  completeness:    z.number(),
  missingItems:    z.array(z.string()),
  documentCount:   z.number(),
  dataPointCount:  z.number(),
  yearsOfData:     z.array(z.string()),
  industry:        z.string().optional(),
  anomalyCount:    z.number(),
  addBackCount:    z.number(),
  valuationCount:  z.number(),
})

const InsightSchema = z.object({
  type:        z.enum(['ANOMALY', 'MISSING_DOC', 'SUGGESTION', 'WARNING', 'COMPLETION']),
  title:       z.string().max(80),
  body:        z.string().max(300),
  actionLabel: z.string().optional(),
  actionPath:  z.string().optional(),
})

const OutputSchema = z.object({ insights: z.array(InsightSchema).max(6) })
export type InsightsOutput = z.infer<typeof OutputSchema>

export async function generateCaseInsights(input: z.infer<typeof InputSchema>): Promise<InsightsOutput> {
  return insightsFlow(input)
}

const prompt = ai.definePrompt({
  name: 'insightsPrompt',
  input: { schema: InputSchema },
  output: { schema: OutputSchema },
  prompt: `You are a proactive forensic appraisal AI assistant. Analyze the case metadata below and generate up to 6 concise, actionable insights for the appraiser.

Rules:
- Be specific, not generic. Reference actual numbers from the data.
- MISSING_DOC: If documents or data are missing, suggest exactly what is needed and why.
- SUGGESTION: Recommend next workflow steps based on what has/hasn't been done.
- WARNING: Flag risks (open anomaly flags, incomplete data, missing valuations before due date).
- COMPLETION: Celebrate progress milestones (first extraction, valuation saved, etc.).
- ANOMALY: Summarize the most critical open anomaly flags.
- Keep body under 300 chars. Be direct. No filler words.

Case: {{caseName}} ({{caseType}})
Completeness: {{completeness}}%
Missing: {{missingItems}}
Documents: {{documentCount}}, Data points: {{dataPointCount}}, Years: {{yearsOfData}}
Industry: {{industry}}
Open anomaly flags: {{anomalyCount}}
Add-backs: {{addBackCount}}, Valuation models: {{valuationCount}}`,
})

const insightsFlow = ai.defineFlow(
  { name: 'insightsFlow', inputSchema: InputSchema, outputSchema: OutputSchema },
  async (input) => {
    const { output } = await prompt(input)
    return output!
  },
)
