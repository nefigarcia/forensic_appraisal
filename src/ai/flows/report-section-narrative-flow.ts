'use server'
/**
 * Slice-14 evidence-grounded section-narrative flow.
 *
 * Distinct from the Slice-0 `reportNarrativeFlow`. The v2 flow is
 * constrained to ONLY the facts payload the caller supplies (which
 * the Slice-14 `buildReportFacts` extractor filters to APPROVED-only).
 *
 * Rules baked into the prompt (echoed in the schema, so the model
 * cannot silently answer a different question):
 *   1. Use only facts present in the payload.
 *   2. Material numerical statements cite fact ids.
 *   3. No invented citations — every citation targetId MUST appear
 *      in the payload or the citation is dropped.
 *   4. Missing information is REPORTED, not hallucinated.
 *   5. If the model cannot confidently draft the whole section, set
 *      `isConfident=false` and shorten the narrative.
 *
 * Enforcement is layered: prompt + output schema + a post-call
 * validator in `src/app/actions/report-sections.ts` that drops any
 * citation whose targetId isn't in the scoped payload.
 */

import { ai } from '@/ai/genkit'
import { z } from 'genkit'

const InputSchema = z.object({
  sectionKey:    z.string(),
  sectionTitle:  z.string(),
  guidance:      z.string(),
  factsJson:     z.string(),   // JSON-stringified scoped payload
  factIndex:     z.string()
    .describe(
      'JSON array of {type, id} pairs enumerating every legitimate citation ' +
      'target present in factsJson. A citation whose (type,id) is not in ' +
      'this list will be dropped.',
    ),
})

const CitationOutSchema = z.object({
  targetType: z.enum([
    'FINANCIAL_VALUE', 'ADDBACK', 'VALUATION_ASSUMPTION',
    'OWNERSHIP_ADJUSTMENT', 'RECONCILIATION', 'DOCUMENT_VERSION',
    'EVIDENCE_CITATION', 'REQUEST_ITEM', 'TIE_OUT',
  ]),
  targetId:   z.string(),
  snippet:    z.string().optional(),
})

const OutputSchema = z.object({
  narrative:          z.string()
    .describe('Formal, third-person narrative for the requested section. ' +
              'Do not invent numbers. Reference the payload only.'),
  citations:          z.array(CitationOutSchema)
    .describe('Every material claim should have a citation to a fact id from the payload.'),
  missingInformation: z.array(z.string())
    .describe('Bullet list of information the section would need but the payload does not contain.'),
  isConfident:        z.boolean()
    .describe('False when the model could not confidently ground the whole narrative.'),
})

export type ReportSectionNarrativeOutput = z.infer<typeof OutputSchema>

export async function generateGroundedSectionNarrative(
  input: z.infer<typeof InputSchema>,
): Promise<ReportSectionNarrativeOutput> {
  return sectionFlow(input)
}

const prompt = ai.definePrompt({
  name: 'reportSectionNarrativeV2Prompt',
  input:  { schema: InputSchema },
  output: { schema: OutputSchema },
  config: {
    safetySettings: [
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
    ],
  },
  prompt: `You are drafting a section of a professional business valuation report.

STRICT RULES — non-negotiable:
  1. Use ONLY facts that appear in the JSON payload below.
     If a fact is not in the payload, do NOT include a claim about it.
     Instead, list it in "missingInformation".
  2. Every material numeric claim MUST cite a specific fact id from factIndex.
     Do NOT invent citations. If you are not certain the id exists, do not cite it.
  3. If you cannot confidently draft this section from the payload,
     set isConfident=false and shorten the narrative.
  4. Never write in the first person. Use "the Appraiser", "the Subject Company".
  5. Never make legal / regulatory claims about compliance with AICPA, ASA, NACVA
     or similar standards. Describe methodology; do not certify compliance.
  6. Never claim that the app or AI performed the appraiser's professional judgment.
     Describe the professional's approach.

Section:       {{sectionKey}}  ({{sectionTitle}})
Guidance:      {{guidance}}

Facts payload (JSON) — the ONLY factual source you may use:
{{factsJson}}

Fact index — every legitimate citation target:
{{factIndex}}

Return:
  - narrative:          formal, 200-500 words for a professional report
  - citations:          {targetType, targetId, snippet} for each material claim
  - missingInformation: bullets listing what the section would need but the payload lacks
  - isConfident:        true only when you can ground the whole narrative in the payload`,
})

const sectionFlow = ai.defineFlow(
  { name: 'reportSectionNarrativeV2Flow', inputSchema: InputSchema, outputSchema: OutputSchema },
  async (input) => {
    const { output } = await prompt(input)
    return output!
  },
)
