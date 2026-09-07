# Financial Tie-Out Engine

Landed in Slice 9. Deterministic reconciliation of equivalent financial
facts across evidence sources, per case. Not AI. Not "reconciliation" in
the auditor's sense — a supporting tool that surfaces mismatches for the
analyst to review.

## The domain problem

An engagement typically has the same fact appearing in multiple places:

```
Revenue          Tax Return  $4,821,309
                 P&L         $4,821,309
                 GL          $4,821,307
                             ─────────
                 Max Δ           $2   →  WITHIN_TOLERANCE
```

We want to see all sources side-by-side, catch the ones that *don't*
agree, and record a reviewer's explanation when the difference is
justified — without ever hiding a material discrepancy behind
UI defaults.

## Model

```
TieOut
  ├─ caseId (unique per (case, concept, year))
  ├─ concept       REVENUE | EBITDA | NET_INCOME | CASH |
  │                ACCOUNTS_RECEIVABLE | ACCOUNTS_PAYABLE |
  │                TOTAL_ASSETS | TOTAL_LIABILITIES
  ├─ year           'TTM' | '2024' | ...
  ├─ toleranceAbsolute (Decimal 19,4)
  ├─ tolerancePercent  (Decimal 9,6)
  ├─ status          TIED | WITHIN_TOLERANCE | DISCREPANCY |
  │                  UNRESOLVED | RESOLVED
  ├─ maxDifference   (Decimal 19,4)  — cached for dashboard sort
  ├─ resolvedBy / resolvedAt / resolutionNote
  └─ items[]

TieOutItem
  ├─ sourceLabel   'Income Statement' | 'Tax Return' | 'GL' | 'Bank' | ...
  ├─ value         Decimal(19,4)
  ├─ financialValueId  → FinancialValue (Slice 0/4)
  └─ documentVersionId → DocumentVersion (Slice 5)
```

## Status semantics

| Status | Meaning | Set by |
|---|---|---|
| `TIED` | All items numerically equal | engine |
| `WITHIN_TOLERANCE` | `max_pairwise_diff ≤ effectiveTolerance` | engine |
| `DISCREPANCY` | outside tolerance; needs reviewer attention | engine |
| `UNRESOLVED` | `< 2 items` (can't reconcile a single source) | engine |
| `RESOLVED` | reviewer explicitly closed a DISCREPANCY with a note | **human only** |

`effectiveTolerance = max(toleranceAbsolute, tolerancePercent × |median|)` —
a value passes if it satisfies *either* rule.

## Never auto-hide

Rule from the slice prompt: **never automatically hide material discrepancies.**

The engine enforces this three ways:

1. **Sort order** places `DISCREPANCY` first on every list read
   (`src/lib/tie-out/status.ts::DASHBOARD_SORT_ORDER`). No client-side
   filter defaults to hiding them.
2. **`RESOLVED` is a human-only status.** The engine only ever sets
   TIED / WITHIN_TOLERANCE / DISCREPANCY / UNRESOLVED. RESOLVED is set
   exclusively by `resolveTieOut(id, resolutionNote)`, which requires a
   non-empty note and `value:override`.
3. **Rebuild preserves reviewer verdicts.** `runTieOutsForCase` upserts
   by `(caseId, concept, year)`. Existing `RESOLVED` rows are NOT
   downgraded — the reviewer's verdict survives a rebuild even if the
   underlying items still fail tolerance. `reopenTieOut` explicitly
   undoes this.

The doc + UI copy both explain: resolving does not delete the row.
Every rebuild re-attaches the current items and recomputes the
underlying deterministic verdict; only the *human overlay* changes.

## Classifier

`src/lib/tie-out/concepts.ts::classifyLineItem(lineItem)` is a
deterministic regex-based lookup. Adding a concept means one file:

1. Add to the `TIE_OUT_CONCEPTS` tuple.
2. Add patterns to `CONCEPT_PATTERNS`.
3. Add a default tolerance to `DEFAULT_TOLERANCES`.

The classifier deliberately returns `null` for unmatched line items.
The tie-out builder skips them. No fabrication (Rule 9 from Slice 7
carries over).

## Default tolerances

| Concept | Absolute | Percent |
|---|---:|---:|
| Cash | $100 | 0.05% |
| Total Assets | $1,000 | 0.1% |
| Total Liabilities | $1,000 | 0.1% |
| Accounts Receivable | $1,000 | 0.1% |
| Accounts Payable | $1,000 | 0.1% |
| Revenue | $1,000 | 0.2% |
| EBITDA | $2,500 | 1% |
| Net Income | $2,500 | 1% |

Reviewer can override on a per-tie-out basis (schema supports it; UI
plumbing is a small follow-up).

## Building

`runTieOutsForCase(caseId)`:

1. Requires `anomaly:run` + tenant scoping (`requireCaseAccess`).
2. Fetches every `FinancialValue` in the case with its Document's
   `currentVersionId` for drill-down provenance.
3. Classifies each row via `classifyLineItem`. Unclassified rows skipped.
4. Groups by `(concept, year)`.
5. For each group:
   - Computes deterministic status via `computeTieOutStatus`.
   - Upserts the `TieOut` (unique on `(caseId, concept, year)`).
   - Rebuilds the `TieOutItem` set inside a transaction so a rebuild is
     atomic.
   - Preserves `RESOLVED` status if the row already had it.
6. Writes an audit event (`RUN_ANOMALY_DETECTION`, since the closest
   existing action taxonomy fits — a future slice can add a
   `RUN_TIE_OUT` action).

## Resolution flow

- `resolveTieOut(id, resolutionNote)` — requires a non-empty note,
  `value:override` role. Silently no-ops for TIED / WITHIN_TOLERANCE
  (button shouldn't have been offered; friendlier than throwing).
- `reopenTieOut(id)` — clears reviewer fields and recomputes status
  from the current items. If they still fail tolerance the row
  transitions back to `DISCREPANCY`.

## UI

`src/components/tie-out-dashboard.tsx` — client component mounted on a
new "Tie-Outs" tab in `/projects/[id]`. Each row shows:

- Status badge (colored by severity, with icon).
- Concept label + fiscal year.
- Max difference in the top-right.
- Per-source cards with value, source label, document + version, and a
  drill-down button that fetches a signed URL via
  `getVersionDownloadUrl` (Slice 5).
- For `DISCREPANCY`: "Resolve with explanation" dialog.
- For `RESOLVED`: reviewer note + a "Reopen" button.

## Server actions

All tenant-scoped via `requireCaseAccess`:

- `getTieOutsForCase(caseId)` — `case:read`. Client-safe projection.
- `runTieOutsForCase(caseId)` — `anomaly:run`.
- `resolveTieOut(id, note)` — `value:override`.
- `reopenTieOut(id)` — `value:override`.

## Migration

Purely additive. Two new tables, no changes to existing ones (beyond
relation additions on `Case`, `FinancialValue`, `DocumentVersion` which
are metadata-only in the Prisma layer).

Migration SQL at [docs/migrations/slice-9-tie-outs.sql](docs/migrations/slice-9-tie-outs.sql).
No backfill required — new engagements build tie-outs when the analyst
clicks the button; existing cases just work once they run it.

## Explicitly out of scope

- **AI-assisted classification.** The classifier is regex-only in Slice 9.
  A future slice could add an AI fallback for edge-case line-item names
  gated on `isConfident` (echoing Slice 7's anti-hallucination pattern).
- **Per-tie-out custom tolerance UI.** Schema supports it; the UI to
  edit tolerances per row is not built.
- **Cross-year tie-outs.** Each `(concept, year)` is a separate row.
  Comparing "TTM" vs "2024" is an analyst judgment.
- **Automatic rebuild after extraction.** Manual button only, so
  extraction runs don't spawn dozens of noisy DISCREPANCY rows before
  the analyst is ready to review.
- **`RUN_TIE_OUT` audit-action type.** Currently rides on
  `RUN_ANOMALY_DETECTION`. Adding a distinct action type is a small
  follow-up but not required for the chain-of-custody guarantee.
- **All Slice 1–8 backlogs** remain open.
