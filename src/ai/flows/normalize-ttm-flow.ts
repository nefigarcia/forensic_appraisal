'use server';
/**
 * @fileOverview A Genkit flow for normalizing raw financial data into a structured TTM (Trailing Twelve Months) format.
 *
 * - normalizeTtmData - A function that maps raw line items to standardized accounting categories.
 * - NormalizeTtmInput - The input type containing raw financial items.
 * - NormalizeTtmOutput - The return type for the structured report.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const NormalizeTtmInputSchema = z.object({
  rawItems: z.array(z.object({
    year: z.string(),
    statementType: z.string(),
    lineItem: z.string(),
    value: z.number(),
    currency: z.string().optional(),
  })).describe('The raw extracted financial values from the forensic ledger.'),
});
export type NormalizeTtmInput = z.infer<typeof NormalizeTtmInputSchema>;

const NormalizeTtmOutputSchema = z.object({
  standardizedReport: z.array(z.object({
    category: z.enum(['Revenue', 'COGS', 'Operating Expenses', 'Other Income/Expense', 'Interest', 'Taxes', 'Depreciation/Amortization']),
    items: z.array(z.object({
      originalLabel: z.string(),
      standardizedLabel: z.string(),
      valuesByYear: z.record(z.string(), z.number()),
      ttmValue: z.number().optional().describe('Calculated Trailing Twelve Months value.'),
    })),
  })),
  summary: z.object({
    ebitda: z.record(z.string(), z.number()),
    netIncome: z.record(z.string(), z.number()),
  }),
});
export type NormalizeTtmOutput = z.infer<typeof NormalizeTtmOutputSchema>;

export async function normalizeTtmData(input: NormalizeTtmInput): Promise<NormalizeTtmOutput> {
  return normalizeTtmFlow(input);
}

const normalizeTtmPrompt = ai.definePrompt({
  name: 'normalizeTtmPrompt',
  input: { schema: NormalizeTtmInputSchema },
  output: { schema: NormalizeTtmOutputSchema },
  prompt: `You are an expert forensic accountant and financial analyst. 

Your task is to take a raw list of extracted financial line items and "normalize" them into a structured Universal TTM (Trailing Twelve Months) report format.

Follow these rules:
1. Map every raw item to one of the standardized categories: Revenue, COGS, Operating Expenses, Other Income/Expense, Interest, Taxes, Depreciation/Amortization.
2. Group items that are logically the same but might have different labels in different years.
3. If there is a "Partial Year" or "YTD" period provided, calculate the TTM (Trailing Twelve Months) value. TTM is usually (Current Year YTD + (Previous Full Year - Previous Year YTD)). If you only have full years, TTM is simply the most recent full year.
4. Calculate EBITDA and Net Income for each year provided.

Raw Data:
{{#each rawItems}}
- {{year}} {{statementType}}: {{lineItem}} = {{value}}
{{/each}}

Produce the standardized report in the requested JSON format.`,
});

const normalizeTtmFlow = ai.defineFlow(
  {
    name: 'normalizeTtmFlow',
    inputSchema: NormalizeTtmInputSchema,
    outputSchema: NormalizeTtmOutputSchema,
  },
  async (input) => {
    const { output } = await normalizeTtmPrompt(input);
    return output!;
  }
);
