# ValuVault AI | Forensic Valuation Workbench

Enterprise-grade AI platform for forensic accountants and valuation specialists.

## 🚀 Module Overview & Workflows

### 1. Authentication & Multi-Tenancy (Module 1)
- **Feature**: Secure firm-level isolation.
- **Workflow**: Sign up creates an `Organization`. All forensic data (Cases, Documents, Financials) is linked to this ID. Access is controlled via encrypted JWT session cookies and Next.js Middleware.

### 2. Case Management (Module 2)
- **Feature**: Matter-level organization.
- **Workflow**: Navigate to **Valuations** to create a "New case." This initializes a permanent record in the MySQL database.

### 3. Document Custody Binder & Data Connectors (Module 3)
- **Feature**: Chain-of-custody tracking & Enterprise Data Pipeline.
- **Workflow**: 
  - **Saving (Mirroring)**: When uploading to the **Custody Binder**, you can select **SharePoint/OneDrive** to mirror the file to your firm's official cloud archive.
  - **Getting (Ingestion)**: Future modules will allow importing historical data directly from these connectors.
  - **Market Data**: Connectors for **IbisWorld** and **BVR** are used to fetch (Get) industry benchmarks for valuation modeling.

### 4. AI Extraction & Forensic Ledger (Modules 4 & 5)
- **Feature**: Automated financial normalization.
- **Workflow**: Click **Run Extraction** on a document. Genkit AI pulls the real file from S3, parses the data using visual OCR (supports images/PDFs), and maps values to a multi-year **Forensic Ledger**. You can manually edit, verify, and normalize these values across multiple years.

### 5. Industry Classification AI (Module 6)
- **Feature**: Automatic NAICS/SIC profiling.
- **Workflow**: In the **Benchmarks** tab, click **Suggest Industry Codes**. AI analyzes the business and saves the classification to the `IndustryClassification` table, linking it to market multiples from BVR/IbisWorld.

### 6. Valuation Engine (Module 8)
- **Feature**: Market approach modeling.
- **Workflow**: Use the **Open Modeler** button to adjust sliders for EBITDA, Multipliers, and Growth. Click **Save Model** to persist these inputs to the `ValuationModel` table for court-ready reporting.

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
When deploying to production:

1. **Azure Portal**: Add a new **Redirect URI**: `https://your-domain.vercel.app/api/connect/microsoft/callback`.
2. **Vercel Dashboard**: Add `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and update `MICROSOFT_REDIRECT_URI` to the production URL.

## 📦 Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Database**: MySQL (via Prisma ORM)
- **Storage**: AWS S3 (Forensic Binder) + SharePoint/OneDrive (Mirroring)
- **AI Engine**: Genkit (Google Gemini 2.5 Flash)
- **Styling**: Tailwind CSS + ShadCN UI
- **Auth**: Custom JWT-based Session Management
