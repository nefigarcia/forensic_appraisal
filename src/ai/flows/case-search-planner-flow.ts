'use server'
/**
 * AI planner for Slice-16 knowledge-base search.
 *
 * The planner takes a natural-language question and returns a
 * structured `FilterSet` (see src/lib/search/query-shape.ts). The
 * planner NEVER:
 *   - returns a case, an assumption, an add-back, or any confidential
 *     value (its output shape does not permit it),
 *   - recommends a valuation method,
 *   - draws a conclusion about what the caller should do.
 *
 * The prompt explicitly enumerates the whitelisted fields the planner
 * may reference. The output is re-validated server-side via
 * `validateFilterSet`; any field outside the whitelist is dropped by
 * the query composer with a warning surfaced back to the caller.
 */

import { ai } from '@/ai/genkit'
import { z } from 'genkit'

// String-typed enums mirror src/lib/search/query-shape.ts so the AI
// cannot invent field names or comparison operators.

const STRING_FIELDS = [
  'caseName', 'clientName', 'engagementType',
  'caseStatus', 'reportStatus',
  'subjectState', 'subjectCity', 'subjectCountry',
  'naicsCode', 'sicCode', 'industryLabel',
] as const
const NUMERIC_FIELDS = [
  'approvedDlocPercent', 'approvedDlomPercent',
  'concludedEnterpriseValue', 'concludedEquityValue', 'concludedOwnershipValue',
  'documentCount',
] as const
const DATE_FIELDS = [
  'valuationDate', 'reportDueDate', 'reportFinalizedAt', 'refreshedAt',
] as const
const BOOLEAN_FIELDS = ['hasRelatedPartyAddBack'] as const
const ARRAY_FIELDS = [
  'methodsApplied',
  'approvedAddBackCategoryKeys',
  'approvedAssumptionKeys',
] as const

const StringFilter = z.object({
  field: z.enum(STRING_FIELDS as unknown as [string, ...string[]]),
  op:    z.enum(['eq', 'contains']),
  value: z.string(),
})
const NumericFilter = z.object({
  field: z.enum(NUMERIC_FIELDS as unknown as [string, ...string[]]),
  op:    z.enum(['eq', 'gte', 'lte', 'between']),
  value: z.string().optional(),
  min:   z.string().optional(),
  max:   z.string().optional(),
})
const DateFilter = z.object({
  field: z.enum(DATE_FIELDS as unknown as [string, ...string[]]),
  op:    z.enum(['eq', 'gte', 'lte', 'between']),
  value: z.string().optional(),
  min:   z.string().optional(),
  max:   z.string().optional(),
})
const BooleanFilter = z.object({
  field: z.enum(BOOLEAN_FIELDS as unknown as [string, ...string[]]),
  op:    z.enum(['eq']),
  value: z.boolean(),
})
const ArrayFilter = z.object({
  field: z.enum(ARRAY_FIELDS as unknown as [string, ...string[]]),
  op:    z.enum(['includes', 'anyOf']),
  value:  z.string().optional(),
  values: z.array(z.string()).optional(),
})

const SearchFilter = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('string'),  filter: StringFilter  }),
  z.object({ kind: z.literal('numeric'), filter: NumericFilter }),
  z.object({ kind: z.literal('date'),    filter: DateFilter    }),
  z.object({ kind: z.literal('boolean'), filter: BooleanFilter }),
  z.object({ kind: z.literal('array'),   filter: ArrayFilter   }),
])

const InputSchema = z.object({
  question:    z.string(),
  todayIso:    z.string().describe('ISO date for the AI to interpret relative dates like "last year".'),
})

const OutputSchema = z.object({
  filters:         z.array(SearchFilter),
  explanation:     z.string().describe('One-sentence explanation of how the question was interpreted. Never a recommendation.'),
  isConfident:     z.boolean().describe('True only when the question maps cleanly to whitelisted filters.'),
  fallbackReason:  z.string().optional().describe('When isConfident=false, one sentence on what was ambiguous.'),
})

export type CaseSearchPlannerOutput = z.infer<typeof OutputSchema>

export async function planCaseSearch(input: z.infer<typeof InputSchema>): Promise<CaseSearchPlannerOutput> {
  return plannerFlow(input)
}

const prompt = ai.definePrompt({
  name: 'caseSearchPlannerPrompt',
  input:  { schema: InputSchema },
  output: { schema: OutputSchema },
  config: {
    safetySettings: [
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
    ],
  },
  prompt: `You translate a professional's natural-language question about the firm's
historical body of work into a STRUCTURED FILTER SET that will run against
an internal case-search index.

STRICT RULES — non-negotiable:
  1. You may ONLY reference the fields listed below. If the question
     asks about anything else, mark isConfident=false and explain what
     you could not map. Do not fabricate a field name.
  2. You NEVER recommend a valuation method, conclude what an analyst
     should do, or state a historical result as advice. Your output
     is filter parameters only.
  3. You NEVER return case identifiers, client names, or any other
     confidential value from another case. The output schema does not
     allow it, and any such content would be dropped server-side.
  4. Interpret ranges liberally but only in whitelisted numeric or
     date fields. Percentages should be decimal fractions
     (18% → "0.18", not "18").
  5. Prefer "between" for ranges (e.g. "DLOM 18-25%" → between).
  6. If the question is ambiguous or requires a professional
     judgement, mark isConfident=false and pick the closest safe
     interpretation.

Whitelisted string fields:
  ${STRING_FIELDS.join(', ')}

Whitelisted numeric fields (values are decimal-string, use fractions for percents):
  ${NUMERIC_FIELDS.join(', ')}

Whitelisted date fields:
  ${DATE_FIELDS.join(', ')}

Whitelisted boolean field:
  ${BOOLEAN_FIELDS.join(', ')}

Whitelisted array fields (values must match the enum you'd see on the case):
  methodsApplied ∈ {INCOME_CAP_EARNINGS, INCOME_DCF, MARKET_GPCM, MARKET_TRANSACTIONS, ASSET}
  approvedAddBackCategoryKeys ∈ {OWNER_COMP, PERSONAL_EXPENSE, NON_RECURRING, RENT_ADJUSTMENT, DEPRECIATION, NON_CASH, RELATED_PARTY, OTHER}
  approvedAssumptionKeys — any stable key present on the firm's
     assumptions (analyst-defined; you may use partial matches only via
     an 'includes' string on approvedAssumptionKeys).

Today: {{todayIso}}

Question:
{{question}}

Return:
  - filters:         list of {kind, filter} objects (see schema).
  - explanation:     one sentence; never a recommendation.
  - isConfident:     true only when every clause maps cleanly.
  - fallbackReason:  when isConfident=false, one sentence.
`,
})

const plannerFlow = ai.defineFlow(
  { name: 'caseSearchPlannerFlow', inputSchema: InputSchema, outputSchema: OutputSchema },
  async (input) => {
    const { output } = await prompt(input)
    return output!
  },
)
