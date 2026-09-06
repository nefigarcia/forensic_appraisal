# Structured Accounting and Spreadsheet Integrations

Landed in Slice 15. Two parallel data paths for structured financial
data:

- **Excel** — round-trippable, versioned workbook templates for the
  four core forensic surfaces (financial ledger, normalization
  schedule, valuation calculations, tie-outs).
- **Accounting connectors** — a per-case `ConnectorAdapter` abstraction
  with a first implementation for QuickBooks Online and stubs for
  Xero, Sage, and NetSuite. Tokens are envelope-encrypted using the
  Slice-3 crypto module.

Both paths land in the same `AccountingSourceRow` staging area. From
there, an explicit `promoteSourceRow` action stamps
`FinancialValue.origin` with the provider — the invariant that
QuickBooks values are never quietly conflated with AI-extracted ones.

## Part A — Excel round trip

```
Case data (approved / verified)
        │
        ▼
buildWorkbook(templateKind, metadata, rows)      ← src/lib/spreadsheets/excel-export.ts
        │
        ▼
    .xlsx file
   (visible tab + hidden `_valuvault_meta` sheet)
        │  emailed / stored / edited outside ValuVault
        ▼
parseWorkbook(buffer, { expectedCaseId, expectedTemplateKind })  ← src/lib/spreadsheets/excel-import.ts
        │
        ▼
Validated rows + warnings
        │
        ▼
diffRows(imported, existingById, { protectionPredicate, protectedFields })
        │
        ▼
ExcelImportRun row with `status = PENDING_REVIEW`, `proposedChanges` frozen
        │  reviewer approves / rejects
        ▼
applyExcelImport(runId, { overrideRowKeys? })
        │
        ▼
FinancialValue / AddBack updates + inserts
   (origin = 'EXCEL' on inserts; PROTECTED skipped unless overridden)
```

### Templates + versioning

Every workbook carries a hidden metadata sheet (`_valuvault_meta`)
with a small JSON blob:

```
{ "app": "ValuVault", "templateKind": "FINANCIAL_LEDGER",
  "templateVersion": "v1", "caseId": "…",
  "exportedAt": "…" }
```

`TEMPLATE_REGISTRY` in `src/lib/spreadsheets/template-schema.ts`
declares the column shape per `(kind, version)`. On import the
metadata is decoded, the caseId is compared to the caller's expected
case, and the schema is looked up. **Unknown template / version →
hard failure.** The parser never guesses.

### The "no blind overwrite" invariant

Each schema declares which columns are `protectedIfVerified`. For the
financial ledger:

```
value, currency, year, statementType, lineItem
```

`diffRows` classifies each row as one of:

- `INSERT`    — no matching id in the DB.
- `UNCHANGED` — every column value normalizes to the same string.
- `UPDATE`    — some column changed AND the row is not protected OR
                only non-protected columns changed.
- `PROTECTED` — the row is verified/locked AND the imported change
                touches at least one protected column.

`applyExcelImport` refuses `PROTECTED` rows unless the caller passes
their rowKey in `overrideRowKeys` — an explicit, audited unlock.
Every override is logged with the row key + reviewer id.

The decimal-safe comparison (`normalizeCompare`) strips thousands
commas, collapses `"1000"` and `"1000.0000"` to `"1000"`, and case-
folds boolean strings. A cosmetic re-export therefore does not
propose spurious updates.

## Part B — QuickBooks Online foundation

### OAuth handshake

```
Firm user clicks "Connect QuickBooks"
        │
        ▼
GET /api/connect/quickbooks?caseId=<caseId>
        │  requires session + case access
        │  sets `oauth_state` (CSRF token, 10 min TTL)
        │  sets `qbo_connect_ctx` = { caseId, organizationId }
        │  redirects to Intuit
        ▼
Intuit consent
        │
        ▼
GET /api/connect/quickbooks/callback?code=…&state=…&realmId=…
        │  verifies state cookie via `verifyOAuthState` (constant-time)
        │  verifies ctx cookie's caseId + organizationId
        │  calls adapter.exchangeCode({ code, providerHints: { realmId } })
        │  envelope-encrypts access + refresh tokens (Slice-3 pattern)
        │  upserts AccountingConnector row
```

The state cookie is bound to this browser session; a cross-site
callback replay fails constant-time verification. The `qbo_connect_ctx`
cookie carries only the caseId (opaque cuid) and organizationId — no
secrets — and is 10-minute-lived.

### Report fetching

`ConnectorAdapter.fetchReport({ accessToken, providerAccountId,
reportKind, periodStart, periodEnd })` returns:

```ts
interface FetchReportResult {
  reportKind:  AccountingReportKind
  periodLabel: string
  rows:        SourceRowPayload[]
  fetchedAt:   Date
}
```

The QBO adapter maps Intuit's nested-section report JSON into flat
`SourceRowPayload`s and preserves the section header as the row's
`category`. Every row's `externalRowId` is `${reportKind}:${accountCode}`
so identical account codes across P&L / BS / TB do not collide.

Server-side `ingestConnectorReport`:

1. Creates an `AccountingIngestionRun` row (status RUNNING).
2. Decrypts the connector's access token (never stored beyond the call).
3. Calls the adapter.
4. Bulk-inserts `AccountingSourceRow`s tagged with the run id +
   provider + report type + period.
5. Marks the run SUCCESS + updates `AccountingConnector.lastSyncAt`.
6. Any failure flips the run to FAILURE with a truncated error
   message. The outer error is re-thrown.

### Provider abstraction

`ConnectorAdapter` is the sole contract server code sees. QBO
implements it; Xero, Sage, and NetSuite are stub adapters that throw
`AdapterNotImplementedError` on every method. Adding a new provider
means one file plus registry registration — no server-action or DB
changes.

### Encryption

Slice-3 `encryptString` / `decryptString` are used directly. The
`AccountingConnector.encryptedSecrets` JSON shape matches
`ExternalConnector.encryptedSecrets`:

```
{
  "version": "v1",
  "secrets": {
    "accessToken":  { "ciphertext": "…", "keyRef": "…", "iv": "…", "tag": "…", "keyVersion": "…" },
    "refreshToken": { … }
  }
}
```

`encryptionKeyVersion` mirrors the KEK version so rotation queries
can find rows keyed to an old KMS ARN, using the same pattern as
Slice 3.

## Origin tagging — the "no silent conflation" invariant

`FinancialValue.origin` is a first-class column added in this slice:

```
AI       — AI extraction (default; every legacy row starts here)
HUMAN    — analyst hand-entered
QBO      — QuickBooks Online
XERO / SAGE / NETSUITE — reserved for future adapters
EXCEL    — imported from a ValuVault-exported workbook
```

The origin is stamped by `promoteSourceRow` from the source row's
`provider` field. A fresh promotion is unverified/unlocked; a
professional still has to accept the value before it is treated as
verified.

The UI always shows the origin badge on FinancialValue rows so a
reviewer never sees a QBO number without knowing where it came from.

## Migration

Additive except for two extension columns on `FinancialValue`
(`origin` NOT NULL DEFAULT 'AI', `sourceRowId` NULL FK to
`AccountingSourceRow`). Every existing row defaults `origin = 'AI'`
— backwards-compatible with Slice 0 semantics.

Four new tables:

- `AccountingConnector`      — per-case OAuth tokens (envelope-encrypted)
- `AccountingIngestionRun`   — per-fetch audit + row grouping
- `AccountingSourceRow`      — canonical structured row from any provider
- `ExcelImportRun`           — Excel dry-run + apply audit trail

Migration SQL at
[docs/migrations/slice-15-accounting-integrations.sql](docs/migrations/slice-15-accounting-integrations.sql).

## Explicit non-goals (Slice 15)

- **Xero / Sage / NetSuite real integrations.** Stubs only; the
  abstraction is in place so a future slice implements one file per
  provider.
- **Automatic bidirectional sync.** Every ingest is manual — no cron
  jobs, no polling. A future slice can wire a schedule.
- **AR / AP detail-level reconciliation.** The adapter shape supports
  the report kinds; the promotion workflow currently focuses on the
  P&L / BS / TB families.
- **Excel valuation import → workbench data.** Round-trip export of
  the valuation calculations is supported; re-import currently
  validates + surfaces the diff but does not overwrite the Slice-13
  workbench (a future slice will wire the applier).
- **Multi-workbook merge.** One workbook per import run — chaining
  two files is out of scope.
- **QuickBooks CompanyInfo lookup.** `providerAccountLabel` is
  currently null; a follow-up slice adds a `/companyinfo` call to
  populate the human name.
- **All Slice 1–14 backlogs** remain open.
