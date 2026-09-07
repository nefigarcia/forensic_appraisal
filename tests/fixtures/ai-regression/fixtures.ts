/**
 * Sanitized AI-regression fixture set.
 *
 * Every fixture describes a hypothetical document + its expected
 * extraction output. Company names, addresses, and amounts are
 * INVENTED — the fixtures are not derived from real client work.
 *
 * Adding a fixture:
 *   1. Anonymize any real-world data (rename companies, alter
 *      amounts by at least 10% and round).
 *   2. Ensure every `expected` row has a stable
 *      (statementType, year, lineItem) key.
 *   3. Optionally include a `citation` when you want to score
 *      citation correctness for that row.
 */

import type { FixtureExtraction } from '@/lib/ai/regression-harness'

export const FIXTURES: FixtureExtraction[] = [
  {
    documentId: 'fix-1-income-statement-2024',
    filename:   'Acme_2024_Income_Statement.pdf',
    expected: [
      { year: '2024', statementType: 'IS', lineItem: 'Revenue',
        value: '4821000',
        citation: { pageNumber: 2, sourceLabel: 'Income Statement — Revenue' } },
      { year: '2024', statementType: 'IS', lineItem: 'Cost of goods sold',
        value: '2410000',
        citation: { pageNumber: 2, sourceLabel: 'Income Statement — COGS' } },
      { year: '2024', statementType: 'IS', lineItem: 'Operating income',
        value: '921000' },
      { year: '2024', statementType: 'IS', lineItem: 'Net income',
        value: '723000',
        citation: { pageNumber: 3, sourceLabel: 'Income Statement — Net Income' } },
    ],
  },
  {
    documentId: 'fix-2-balance-sheet-2024',
    filename:   'Acme_2024_Balance_Sheet.pdf',
    expected: [
      { year: '2024', statementType: 'BS', lineItem: 'Cash',
        value: '450000' },
      { year: '2024', statementType: 'BS', lineItem: 'Accounts receivable',
        value: '380000' },
      { year: '2024', statementType: 'BS', lineItem: 'Total assets',
        value: '5100000',
        citation: { pageNumber: 4, sourceLabel: 'Balance Sheet — Total Assets' } },
      { year: '2024', statementType: 'BS', lineItem: 'Total liabilities',
        value: '2300000' },
      { year: '2024', statementType: 'BS', lineItem: "Total stockholders' equity",
        value: '2800000' },
    ],
  },
  {
    documentId: 'fix-3-multi-year-is',
    filename:   'Acme_3Yr_Income_Statement.pdf',
    expected: [
      { year: '2022', statementType: 'IS', lineItem: 'Revenue', value: '3800000' },
      { year: '2023', statementType: 'IS', lineItem: 'Revenue', value: '4210000' },
      { year: '2024', statementType: 'IS', lineItem: 'Revenue', value: '4821000' },
      { year: '2022', statementType: 'IS', lineItem: 'EBITDA', value: '580000' },
      { year: '2023', statementType: 'IS', lineItem: 'EBITDA', value: '780000' },
      { year: '2024', statementType: 'IS', lineItem: 'EBITDA', value: '1050000' },
    ],
  },
]
