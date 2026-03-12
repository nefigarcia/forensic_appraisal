# ValuVault AI | Forensic Valuation Workbench

Enterprise-grade AI platform for forensic accountants and valuation specialists.

## 🚀 Module Overview & Workflows

### 1. Authentication & Multi-Tenancy (Module 1)
- **Feature**: Secure firm-level isolation.
- **Workflow**: Sign up creates an `Organization`. All forensic data (Cases, Documents, Financials) is linked to this ID. Access is controlled via encrypted JWT session cookies and Next.js Middleware.

### 2. Case Management (Module 2)
- **Feature**: Matter-level organization.
- **Workflow**: Navigate to **Valuations** to create a "New Forensic Matter." This initializes a permanent record in the MySQL database.

### 3. Document Custody Binder (Module 3)
- **Feature**: Chain-of-custody tracking.
- **Workflow**: Inside a Case, use **Upload Source** to attach evidence. The metadata is persisted to the `Document` table, ensuring every file is accounted for in audit logs.

### 4. AI Extraction & Forensic Ledger (Modules 4 & 5)
- **Feature**: Automated financial normalization.
- **Workflow**: Click **Run Extraction** on a document. Genkit AI parses the PDF and maps values to a structured format. These are saved as `FinancialValue` records and displayed in the **Forensic Ledger** tab.

### 5. Industry Classification AI (Module 6)
- **Feature**: Automatic NAICS/SIC profiling.
- **Workflow**: In the **Benchmarks** tab, click **Suggest Industry Codes**. AI analyzes the business and saves the classification to the `IndustryClassification` table.

### 6. Valuation Engine (Module 8)
- **Feature**: Market approach modeling.
- **Workflow**: Use the **Open Modeler** button to adjust sliders for EBITDA, Multipliers, and Growth. Click **Save Model** to persist these inputs to the `ValuationModel` table.

### 7. Discovery Search (Module 9)
- **Feature**: Natural language archive search.
- **Workflow**: Use the **Discovery Search** page to find matters or source documents across your firm's historical archive.

## 🛠 Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Database**: MySQL (via Prisma ORM)
- **AI Engine**: Genkit (Google Gemini 2.5 Flash)
- **Styling**: Tailwind CSS + ShadCN UI
- **Auth**: Custom JWT-based Session Management

## 📝 Setup
1. Ensure `DATABASE_URL` is set in `.env`.
2. Run `npx prisma db push` to initialize tables.
3. Run `npx prisma generate` for type safety.
4. Start dev server: `npm run dev`.
