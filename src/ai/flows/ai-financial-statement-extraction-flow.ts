'use server';
/**
 * @fileOverview A Genkit flow for extracting key financial data from various document types, including PDFs and images.
 *
 * - extractFinancialData - A function that handles the financial data extraction process.
 * - FinancialDocumentExtractionInput - The input type for the extractFinancialData function.
 * - FinancialDocumentExtractionOutput - The return type for the extractFinancialData function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const FinancialDocumentExtractionInputSchema = z.object({
  documentDataUri: z
    .string()
    .describe(
      "The financial document (e.g., PDF, JPEG, or PNG scan) as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  documentName: z
    .string()
    .optional()
    .describe('Optional: The name of the document for better context.'),
  documentTypeHint: z
    .string()
    .optional()
    .describe(
      'Optional: A hint about the document type (e.g., "Balance Sheet", "Income Statement", "Tax Return") to guide extraction.'
    ),
});
export type FinancialDocumentExtractionInput = z.infer<
  typeof FinancialDocumentExtractionInputSchema
>;

const FinancialDocumentExtractionOutputSchema = z.object({
  extractedData: z
    .array(
      z.object({
        year: z.string().describe('The year to which the financial data pertains.').nullable(),
        statementType:
          z.string().describe('The type of financial statement (e.g., "Income Statement", "Balance Sheet", "Tax Return").').nullable(),
        lineItem: z.string().describe('The specific financial line item (e.g., "Revenue", "Cash").'),
        value: z.number().nullable().describe('The numeric value of the financial line item. Null if not found.'),
        unit: z.string().optional().describe('The unit of the value, e.g., "USD", "shares".'),
        currency: z.string().optional().describe('The currency of the value, e.g., "USD", "EUR".'),
      })
    )
    .describe(
      'An array of extracted financial data points, each including year, statement type, line item, and value.'
    ),
});
export type FinancialDocumentExtractionOutput = z.infer<
  typeof FinancialDocumentExtractionOutputSchema
>;

export async function extractFinancialData(
  input: FinancialDocumentExtractionInput
): Promise<FinancialDocumentExtractionOutput> {
  return financialDocumentExtractionFlow(input);
}

const extractFinancialDataPrompt = ai.definePrompt({
  name: 'extractFinancialDataPrompt',
  input: { schema: FinancialDocumentExtractionInputSchema },
  output: { schema: FinancialDocumentExtractionOutputSchema },
  config: {
    safetySettings: [
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_NONE',
      },
    ],
  },
  prompt: `You are an expert financial data extractor assistant specialized in forensic accounting. 

Your task is to accurately extract key financial data points from the provided document. This document may be a high-quality PDF or a scanned image/photo of a page. You must perform advanced visual analysis and OCR to detect tables, line items, and numeric values.

Carefully analyze the provided financial document:
1. Identify all relevant financial line items and their values.
2. Group data by the year it pertains to.
3. For scanned images, pay close attention to columns and rows to ensure values are mapped to the correct line items.
4. If you see a multi-page document, process all visible sections.

If the document is identified as a '{{documentTypeHint}}' (or if a document name '{{documentName}}' is provided), focus on standard fields expected for that type.

Structure the output as a JSON array of objects. Each object MUST include 'year', 'statementType', 'lineItem', and 'value'. 'value' should be a number. If a value is negative (often in parentheses or marked with a minus sign), represent it as a negative number.

Document for analysis: {{media url=documentDataUri}}`,
});

const financialDocumentExtractionFlow = ai.defineFlow(
  {
    name: 'financialDocumentExtractionFlow',
    inputSchema: FinancialDocumentExtractionInputSchema,
    outputSchema: FinancialDocumentExtractionOutputSchema,
  },
  async (input) => {
    const { output } = await extractFinancialDataPrompt(input);
    return output!;
  }
);
