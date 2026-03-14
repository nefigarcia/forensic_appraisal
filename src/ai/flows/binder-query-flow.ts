'use server';
/**
 * @fileOverview A Genkit flow that allows users to ask questions about the documents in the forensic binder.
 *
 * - queryBinder - A function that handles natural language questions about uploaded documents.
 * - BinderQueryInput - The input type for the queryBinder function.
 * - BinderQueryOutput - The return type for the queryBinder function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const BinderQueryInputSchema = z.object({
  query: z.string().describe('The user question about the documents.'),
  contextData: z.array(z.object({
    documentName: z.string(),
    extractedText: z.string(),
  })).describe('An array of document contents to analyze.'),
});
export type BinderQueryInput = z.infer<typeof BinderQueryInputSchema>;

const BinderQueryOutputSchema = z.object({
  answer: z.string().describe('The AI-generated answer based on the document context.'),
  citations: z.array(z.string()).describe('The names of the documents used to formulate the answer.'),
});
export type BinderQueryOutput = z.infer<typeof BinderQueryOutputSchema>;

export async function queryBinder(input: BinderQueryInput): Promise<BinderQueryOutput> {
  return binderQueryFlow(input);
}

const binderQueryPrompt = ai.definePrompt({
  name: 'binderQueryPrompt',
  input: { schema: BinderQueryInputSchema },
  output: { schema: BinderQueryOutputSchema },
  prompt: `You are an expert forensic auditor AI. You have access to the contents of a case's Custody Binder. 

Your task is to answer the user's question based strictly on the provided document context. If the information is not present, state that you cannot find it in the binder.

Question: {{{query}}}

Context from Binder:
{{#each contextData}}
Document: {{{this.documentName}}}
Content: {{{this.extractedText}}}
-------------------
{{/each}}

Provide a detailed, professional answer. Also list which documents provided the information.`,
});

const binderQueryFlow = ai.defineFlow(
  {
    name: 'binderQueryFlow',
    inputSchema: BinderQueryInputSchema,
    outputSchema: BinderQueryOutputSchema,
  },
  async (input) => {
    const { output } = await binderQueryPrompt(input);
    return output!;
  }
);
