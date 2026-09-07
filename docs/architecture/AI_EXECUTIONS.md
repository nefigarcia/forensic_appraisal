# AI Execution Registry

Landed in Slice 8. Every user-triggered AI-assisted step in the app
writes exactly one `AiExecution` row. Any material fact the AI proposes
can be traced back to a single run: **which execution, which model,
which prompt template version, which source document versions, whether
a human later approved or overrode it.**

## What we record

Each `AiExecution` captures:

| Field | Purpose |
|---|---|
| `organizationId` | tenant scope — enforced by the wrapper, cross-org reads impossible |
| `caseId` | optional case scope; some flows have none (e.g. industry code) |
| `userId` | the human who triggered the run |
| `flowName` | e.g. `financialDocumentExtractionFlow` |
| `flowVersion` | human label, bumped when the semantics change |
| `promptTemplateKey` | stable key for a future template-registry |
| `promptTemplateHash` | reserved for a future content-hash pass |
| `modelProvider` / `modelName` / `modelVersion` | which model produced the output |
| `inputHash` | SHA-256 of the **scrubbed** canonicalized input |
| `outputHash` | SHA-256 of the (Zod-validated) output object |
| `documentVersionIds` | JSON array of the `DocumentVersion.id`s that fed this run |
| `startedAt` / `completedAt` / `durationMs` | timing |
| `status` | `RUNNING` → `SUCCESS` or `FAILURE` |
| `errorCategory` | `MODEL_TIMEOUT`, `SCHEMA_VALIDATION`, `RATE_LIMIT`, `REFUSED`, `INFRA`, `UNKNOWN` |
| `errorMessage` | sanitized, capped, one line, secret-scrubbed |
| `inputTokens` / `outputTokens` / `totalTokens` / `estimatedCostUsd` | optional; the current Genkit surface doesn't expose token counts, so these are null in Slice 8 |
| `reviewStatus` | explicit aggregate human verdict; individual `FinancialValue.reviewStatus` rows are unchanged |

## What we deliberately do NOT record

Rules 2 and 3 of the slice prompt forbid persisting secrets or
duplicating sensitive document contents. The wrapper enforces this:

- **The raw prompt template** never leaves the code. `promptTemplateKey`
  is a human-authored label; `promptTemplateHash` is reserved but not
  yet populated because Genkit hides the interpolated string.
- **The raw model output** is never stored, only its SHA-256 hash. If a
  future slice needs the output, it should compute it once and store
  hashes at multiple points, not the payload itself.
- **The document data URI** is replaced with a length tag
  (`[data-uri:<n>]`) before hashing. The immutable `DocumentVersion.id`
  in `documentVersionIds` is the reproducibility signal — Slice 5 already
  guarantees those bytes are stable.
- **Known secret keys** (`accessToken`, `refreshToken`, `apiKey`,
  `password`, `authorization`, `clientSecret`, `jwt`, `sessionToken`,
  `stripeKey`) are dropped from the canonicalized input before hashing.
- **Error stack traces** are never persisted. Only a sanitized
  single-line message with common secret shapes redacted
  (`sk_...`, `Bearer ...`, `eyJ...`).

## Retrofit — every AI flow is wrapped

Slice 8 wraps all seven flows via `withAIExecution` in
`src/lib/ai/execution.ts`, called from `src/app/actions/ai-actions.ts`:

| Flow | Callsite |
|---|---|
| `financialDocumentExtractionFlow` | `runFinancialExtraction` |
| `aiIndustryCodeSuggestionFlow`    | `runIndustryAnalysis` |
| `anomalyDetectionFlow`            | `runAnomalyDetection` |
| `binderQueryFlow`                 | `askBinder` |
| `insightsFlow`                    | `refreshCaseInsights` |
| `normalizeTtmFlow`                | `runTtmNormalization` |
| `reportNarrativeFlow`             | `draftReportSection` |

Adding an eighth flow means (a) adding it to `FLOW_METADATA` in
`src/lib/ai/flow-metadata.ts` and (b) wrapping its callsite with
`withAIExecution`. The registry entry gives you the model identity,
version, and prompt-template key for free.

## FinancialValue provenance

`FinancialValue.aiExecutionId` links every AI-proposed value to the run
that proposed it. `runFinancialExtraction` populates the FK on every row
it inserts. When an analyst overrides that value, `FinancialValue`
records the change (`overriddenBy`, `overriddenAt`, `overrideReason`,
`aiSuggestedValue` remains immutable), but the AI-execution link stays
intact — so a report can show "5 of the 12 values proposed by
execution X were overridden by the analyst".

The admin diagnostics detail dialog computes this aggregate on demand:
`{ total, pending, accepted, overridden, rejected }`.

## AI-vs-human distinction

The Slice-0 immutable columns (`FinancialValue.aiSuggestedValue`) plus
the Slice-4 Decimal shadows (`aiSuggestedValueDecimal`) already
separate "what the AI proposed" from "what the analyst decided". Slice 8
adds the *provenance link*: which execution ran, when, with what prompt
version.

Post-Slice-8:
- `FinancialValue.aiSuggestedValue` — immutable AI proposal (Slice 0)
- `FinancialValue.value` / `valueDecimal` — current authoritative value
  (may be human-overridden)
- `FinancialValue.reviewStatus` — per-value human verdict
- `FinancialValue.aiExecutionId` — which run proposed it
- `AiExecution.reviewStatus` — optional aggregate verdict on the whole run

## Admin diagnostics

`/settings/ai-executions` is ADMIN-only (gated by `team:manage`). It
lists the most recent 100 executions for the caller's organization with
filters, per-row detail dialog, and the aggregate review summary.

The dialog shows every persisted field — including hashes and document
version IDs, which is exactly the reproducibility surface an auditor
needs to answer "was this run identical to the one from last week?".

## Error categorization

`categorizeError` in `src/lib/ai/execution.ts` inspects error `name`,
`message`, `code`, and `status`. Categories:

- `SCHEMA_VALIDATION` — Zod rejects the model's output (extraction
  schema mismatch, missing field).
- `MODEL_TIMEOUT` — HTTP 408 or a `timeout`-shaped error.
- `RATE_LIMIT` — HTTP 429 or `quota`/`rate limit` phrases.
- `REFUSED` — safety filter / policy block from the model.
- `INFRA` — `ECONNRESET`, `ENOTFOUND`, 5xx server errors.
- `UNKNOWN` — everything else.

These are coarse on purpose. The dashboard exists to spot patterns
(`30% RATE_LIMIT this hour`), not to root-cause individual runs.

## Migration

Purely additive:

1. Apply [docs/migrations/slice-8-ai-executions.sql](docs/migrations/slice-8-ai-executions.sql) — creates the `AiExecution` table + FK + indexes on `FinancialValue`.
2. No backfill: pre-Slice-8 `FinancialValue` rows keep `aiExecutionId = NULL`. Any analyst report of "which run proposed this value" for those rows will show "unknown".
3. New runs from Slice 8 code onward populate the link.

## Cost tracking (deferred)

`inputTokens`, `outputTokens`, `totalTokens`, and `estimatedCostUsd` are
provisioned but the current Genkit `ai.definePrompt` return type
doesn't reliably surface token usage. When a future slice switches to
`ai.generate` (or another Genkit surface that returns `usage`), the
wrapper can populate these columns without any schema change or caller
change.

## Explicitly out of scope

- **Real token/cost metering** — see above.
- **Auto-derive `AiExecution.reviewStatus`** from the child
  `FinancialValue.reviewStatus`. The action `setAiExecutionReviewStatus`
  is server-ready; the auto-derive can be added by a future slice if it
  becomes useful.
- **Prompt-template registry** — the code stores `promptTemplateKey` but
  there's no registry lookup yet.
- **Content-hash of the prompt template** — reserved column
  `promptTemplateHash`; needs each flow to export the interpolated
  template string.
- **A UI to re-run a past execution** — the data is there to reproduce
  (given the same DocumentVersions, prompt key, and model), but the UI
  is a future slice.
