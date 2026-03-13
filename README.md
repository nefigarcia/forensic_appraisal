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
- **Workflow**: Inside a Case, use **Upload Source** to attach evidence. Files are stored in **AWS S3** and metadata (including the S3 key) is persisted to the `Document` table. Supports both Local Upload and Cloud Import (SharePoint/OneDrive).

### 4. AI Extraction & Forensic Ledger (Modules 4 & 5)
- **Feature**: Automated financial normalization.
- **Workflow**: Click **Run Extraction** on a document. Genkit AI pulls the real file from S3, parses the data using visual OCR (supports images/PDFs), and maps values to a structured format. These are saved as `FinancialValue` records and displayed in the **Forensic Ledger**. You can manually edit and verify these values.

### 5. Industry Classification AI (Module 6)
- **Feature**: Automatic NAICS/SIC profiling.
- **Workflow**: In the **Benchmarks** tab, click **Suggest Industry Codes**. AI analyzes the business and saves the classification to the `IndustryClassification` table.

### 6. Valuation Engine (Module 8)
- **Feature**: Market approach modeling.
- **Workflow**: Use the **Open Modeler** button to adjust sliders for EBITDA, Multipliers, and Growth. Click **Save Model** to persist these inputs to the `ValuationModel` table.

### 7. Discovery Search (Module 9)
- **Feature**: Natural language archive search.
- **Workflow**: Use the **Discovery Search** page to find matters or source documents across your firm's historical archive.

## 🛠 Multi-Tenant OAuth Setup (Microsoft)
To enable real SharePoint/OneDrive connections for your clients:

1. **Azure Portal**:
   - Register a new app named "ValuVault AI".
   - **Supported account types**: Select **"Multiple Entra ID tenants"**.
   - **Redirect URI**: Web -> `http://localhost:9002/api/connect/microsoft/callback`.
2. **Permissions**:
   - Add `Files.Read.All`, `Sites.Read.All`, `User.Read`, and `offline_access`.
   - **Crucial**: Click "Grant admin consent" for your organization.
3. **Environment**:
   - Add `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_REDIRECT_URI` to your `.env`.

## 🌍 Production Deployment (Vercel)
When deploying to production, follow these steps:

1. **Azure Portal**:
   - Add a new **Redirect URI** to your App Registration: `https://your-domain.vercel.app/api/connect/microsoft/callback`.
2. **Vercel Dashboard**:
   - Go to **Settings > Environment Variables**.
   - Add `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`.
   - Set `MICROSOFT_REDIRECT_URI` to your production URL: `https://your-domain.vercel.app/api/connect/microsoft/callback`.
   - Set `DATABASE_URL` (MySQL/PlanetScale/Supabase).
   - Set `AWS_S3_BUCKET_NAME`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
3. **Prisma**:
   - Ensure you run `npx prisma db push` against your production database.

## 📦 Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Database**: MySQL (via Prisma ORM)
- **Storage**: AWS S3 (Forensic Binder)
- **AI Engine**: Genkit (Google Gemini 2.5 Flash)
- **Styling**: Tailwind CSS + ShadCN UI
- **Auth**: Custom JWT-based Session Management

## 📝 Setup
1. Ensure `DATABASE_URL`, `AWS_S3_BUCKET_NAME`, and Microsoft credentials are set in `.env`.
2. Run `npx prisma db push` to initialize tables.
3. Run `npm run dev`.
