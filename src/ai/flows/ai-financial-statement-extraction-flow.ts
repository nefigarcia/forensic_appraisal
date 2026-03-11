'use server';
/**
 * @fileOverview A Genkit flow for extracting key financial data from various document types.
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
      "The financial document (e.g., PDF balance sheet, income statement, tax return) as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
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
  prompt: `You are an expert financial data extractor assistant. Your task is to accurately extract key financial data points from various financial documents and present them in a structured, year-by-year format.

Carefully analyze the provided financial document. Identify all relevant financial line items, their corresponding values, and the year they pertain to. For multi-page documents like tax returns, ensure you capture data from all relevant sections and pages. If you can determine the type of financial statement (e.g., Balance Sheet, Income Statement) for a given data point, include it.

If the document is identified as a '{{documentTypeHint}}' (or if a document name '{{documentName}}' is provided), pay special attention to extracting data typically found in such documents.

Structure the output as a JSON array of objects, where each object represents a single financial data point. Each object MUST include 'year', 'statementType', 'lineItem', and 'value'. Include 'unit' and 'currency' if clearly available. 'value' should be a number (float or integer). If a value is negative, represent it as such. If a value is clearly present but cannot be parsed as a number, or if a line item is found but its value is not discernable, set 'value' to null.

Example Output Structure:
[
  {"year": "2023", "statementType": "Income Statement", "lineItem": "Revenue", "value": 1000000, "currency": "USD"},
  {"year": "2023", "statementType": "Income Statement", "lineItem": "Cost of Goods Sold", "value": 600000, "currency": "USD"},
  {"year": "2022", "statementType": "Income Statement", "lineItem": "Revenue", "value": 950000, "currency": "USD"},
  {"year": "2023", "statementType": "Balance Sheet", "lineItem": "Cash", "value": 250000, "currency": "USD"},
  {"year": "2022", "statementType": "Balance Sheet", "lineItem": "Cash", "value": 200000, "currency": "USD"},
  {"year": "2023", "statementType": "Tax Return", "lineItem": "Taxable Income", "value": 150000, "currency": "USD"}
]

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
