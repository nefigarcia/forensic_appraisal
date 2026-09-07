# AI Governance

The ValuVault AI usage model is: **advisory only, professional
judgment mandatory, full traceability, no auto-recommendation**.

## Where AI is used

| Slice | Flow                                | Purpose                                     |
|---|---|---|
| 0  | `financialDocumentExtractionFlow`     | Structured extraction from uploaded docs. |
| 0  | `aiIndustryCodeSuggestionFlow`        | Suggested NAICS/SIC per case. |
| 0  | `anomalyDetectionFlow`                | Flag suspicious financial patterns. |
| 0  | `binderQueryFlow`                     | Natural-language Q&A over case documents. |
| 0  | `insightsFlow`                        | Proactive suggestions on the case page. |
| 0  | `normalizeTtmFlow`                    | TTM add-back proposals. |
| 0  | `reportNarrativeFlow`                 | Slice-0 legacy narrative — kept for compat. |
| 12 | `requestCompletenessFlow`             | "Does this upload satisfy the request?" |
| 14 | `reportSectionNarrativeV2Flow`        | Evidence-grounded report drafting. |
| 16 | `caseSearchPlannerFlow`               | Natural language → structured filter DSL. |

## Where AI is deliberately NOT used

- **Slice-13 valuation conclusions.** The workbench math is
  deterministic and human-driven. No AI wraps `runScenarioReconciliation`
  or ownership-discount approval.
- **Slice-14 section approval.** AI drafts sections; humans approve.
- **Slice-15 accounting connectors.** Row promotion is human-explicit.
- **Slice-16 search results.** The planner produces filter parameters;
  the DSL has no field for "recommended method" or "suggested DLOM".

## Traceability (Slice 8)

Every AI invocation goes through `withAIExecution`, which writes:

- `AiExecution` row: organizationId, caseId, userId,
  flowName + flowVersion + promptTemplateKey, model provider + name,
  input hash, output hash, `documentVersionIds` array, timing,
  status, error category (sanitized message; no stack traces).

- Downstream links:
  - `FinancialValue.aiExecutionId`  — Slice 8
  - `RequestItem.aiExecutionId`     — Slice 12
  - `ReportSectionVersion.aiExecutionId` — Slice 14
  - `AiCaseSearchRun.aiExecutionId` — Slice 16

Any material fact can be traced to its AI run and its input document
versions.

## Input scrubbing

Before hashing:
- Data URIs replaced with `[data-uri:<byteLen>]` — bytes never
  stored but two different documents produce different hashes.
- Known secret keys (`accessToken`, `refreshToken`, `apiKey`,
  `password`, `authorization`, …) dropped.
- Output hash canonicalizes the model response with the same
  scrubber.

## Anti-hallucination

Two patterns, applied across every AI surface:

1. **`isConfident` flag** — every flow emits it. Downstream code
   downgrades unconfident outputs so a human sees the result but
   nothing auto-applies.
   - Slice-7 citations: `isConfident=false` → coordinate fields NULL.
   - Slice-12 completeness: unconfident `AUTO_COMPLETE` → `NEEDS_HUMAN`.
   - Slice-14 sections: unconfident → the section stays out of
     APPROVED state.
2. **Payload-only citations** — Slice-14 `validateCitations` drops
   any citation whose targetId is not in the scoped facts payload
   the AI received.

## Model-choice policy

- Production default: `gemini-2.5-flash` via Genkit.
- Model swap requires:
  - Bump the affected flow's `flowVersion` in
    `src/lib/ai/flow-metadata.ts`.
  - Re-run the Slice-17 regression harness against sanitized
    fixtures (see `tests/fixtures/ai-regression/`).
  - Compare `overallAccuracy` and `overallCitationCorrectness`
    against the last run's baseline.
  - Document the change in a slice report.

## What we do NOT call "accuracy"

Model-reported confidence numbers are subjective and MUST NOT be
labeled "accuracy". The Slice-17 regression harness computes
accuracy strictly against labeled fixtures:

- `accuracy = matched_labeled_values / total_labeled_values`
- `citationCorrectness = matched_citations / expected_citations`

Both are ratios in `[0, 1]`. Neither uses the model's own confidence.

## Prompt-injection posture

- Slice-8 AI wrapper hashes the *scrubbed* input, so a prompt-
  injected instruction in a document becomes part of the input hash
  and traces to that specific `AiExecution`.
- Slice-14 report drafting scopes each section to a curated subset
  of the facts payload — an injection in one document cannot address
  facts outside the scope.
- Slice-16 search planner output schema is a closed Zod enum. Even a
  successful prompt injection cannot yield a filter field outside
  the whitelist.

## Retention

AI executions are retained indefinitely as part of the audit trail.
See [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md) for the retention
matrix. Bulk redaction of a specific `AiExecution` is not currently
supported — the row is required for the Slice-6 chain integrity of
the downstream `FinancialValue.aiExecutionId` back-reference.

## Regression harness

Run:

```
npm test -- ai-regression-harness
```

Adding fixtures: see `tests/fixtures/ai-regression/fixtures.ts`.
Every fixture must be sanitized — no real client data.

## Failure states

- The Slice-8 wrapper writes `status = FAILURE` with a
  category-level `errorCategory` (MODEL_TIMEOUT / RATE_LIMIT /
  REFUSED / SCHEMA_VALIDATION / INFRA / UNKNOWN).
- Callers see the underlying exception and decide (retry, mark
  section unconfident, surface to the user).
- The wrapper never crashes the outer action on a follow-up write
  failure.
