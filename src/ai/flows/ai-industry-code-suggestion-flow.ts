'use server';
/**
 * @fileOverview An AI agent that analyzes business descriptions, website URLs, and financial statements
 * to suggest relevant industry classifications and associated codes (e.g., NAICS, SIC).
 *
 * - aiIndustryCodeSuggestion - A function that handles the industry code suggestion process.
 * - AiIndustryCodeSuggestionInput - The input type for the aiIndustryCodeSuggestion function.
 * - AiIndustryCodeSuggestionOutput - The return type for the aiIndustryCodeSuggestion function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const AiIndustryCodeSuggestionInputSchema = z.object({
  businessDescription: z
    .string()
    .describe("A detailed description of the client's business."),
  websiteUrl: z.string().url().optional().describe("The client's website URL."),
  financialStatements: z
    .array(
      z
        .string()
        .describe(
          "A financial statement document, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
        )
    )
    .optional()
    .describe('An array of financial statement documents in data URI format.'),
});
export type AiIndustryCodeSuggestionInput = z.infer<
  typeof AiIndustryCodeSuggestionInputSchema
>;

const AiIndustryCodeSuggestionOutputSchema = z.object({
  suggestedIndustry: z
    .string()
    .describe('The most relevant industry classification for the business.'),
  industryCodes: z
    .array(
      z.object({
        type: z.string().describe('The type of industry code (e.g., "NAICS", "SIC").'),
        code: z.string().describe('The industry code itself.'),
      })
    )
    .describe('An array of associated industry codes.'),
});
export type AiIndustryCodeSuggestionOutput = z.infer<
  typeof AiIndustryCodeSuggestionOutputSchema
>;

export async function aiIndustryCodeSuggestion(
  input: AiIndustryCodeSuggestionInput
): Promise<AiIndustryCodeSuggestionOutput> {
  return aiIndustryCodeSuggestionFlow(input);
}

const industryCodeSuggestionPrompt = ai.definePrompt({
  name: 'industryCodeSuggestionPrompt',
  input: { schema: AiIndustryCodeSuggestionInputSchema },
  output: { schema: AiIndustryCodeSuggestionOutputSchema },
  prompt: `You are an expert industry classification specialist. Your task is to analyze the provided information about a client's business and suggest the most relevant industry classification along with associated industry codes (e.g., NAICS, SIC). Provide detailed codes if possible.

Business Description: {{{businessDescription}}}
{{#if websiteUrl}}Website URL: {{{websiteUrl}}}{{/if}}
{{#if financialStatements}}
Financial Statements:
{{#each financialStatements}}
{{media url=this}}
{{/each}}
{{/if}}

Based on this information, provide the suggested industry and relevant industry codes in the specified JSON format.`,
});

const aiIndustryCodeSuggestionFlow = ai.defineFlow(
  {
    name: 'aiIndustryCodeSuggestionFlow',
    inputSchema: AiIndustryCodeSuggestionInputSchema,
    outputSchema: AiIndustryCodeSuggestionOutputSchema,
  },
  async (input) => {
    const { output } = await industryCodeSuggestionPrompt(input);
    return output!;
  }
);
