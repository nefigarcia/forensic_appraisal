# Earnings Normalization Workbench

Landed in Slice 10. Turns the existing `AddBack` capability into a
professional workbench with a real status machine, a reported→normalized
EBITDA bridge, evidence-completeness warnings, and reviewer-queue
integration readiness. All math is decimal-safe. **No accounting
judgment is hardcoded** — categories are labels, not gatekeepers.

## Domain

An analyst normalizes earnings by starting with reported EBITDA and
applying adjustments — add-backs (owner comp, personal expenses,
one-time litigation), subtractions (non-operating income) — each
categorized, dated, and supported with evidence. The workbench is where
that flow happens: draft an adjustment, submit it for review, respond
to reviewer feedback, and land on an approved normalized EBITDA number
that the report and the valuation flow can rely on.

## Model

Extends `AddBack` in place — no new tables, no data migration risk.

New columns (all nullable or defaulted):

| Column | Type | Meaning |
|---|---|---|
| `status` | `VARCHAR` default `'DRAFT'` | `DRAFT / PROPOSED / NEEDS_SUPPORT / APPROVED / REJECTED` |
| `direction` | `VARCHAR` default `'ADD'` | `ADD` or `SUBTRACT` — most add-backs are ADD; non-operating income is SUBTRACT |
| `recurring` | `VARCHAR` default `'NONRECURRING'` | `RECURRING / NONRECURRING / ONE_TIME` |
| `taxTreatment` | `VARCHAR?` | `PRE_TAX / AFTER_TAX / NOT_APPLICABLE` — optional |
| `proposedBy` | `VARCHAR?` | userId who first submitted |
| `reviewedBy` | `VARCHAR?` | userId who last reviewed |
| `reviewedAt` | `DATETIME?` | last review timestamp |
| `statusChangedAt` | `DATETIME?` | last status transition timestamp |
| `rejectionReason` | `TEXT?` | required for REJECTED and NEEDS_SUPPORT |

The pre-Slice-10 columns (`year2 / year1 / ttm` + Slice-4 Decimal
shadows, `rationale`, `isApproved`, `approvedBy`, `citations`) are
untouched. `isApproved` is kept in sync with `status === 'APPROVED'` on
every write — old readers keep working.

## Status machine

```
       DRAFT ──► PROPOSED ──► APPROVED
                       ├─► REJECTED   ──► DRAFT
                       └─► NEEDS_SUPPORT ──► PROPOSED
       APPROVED ──► DRAFT   (reopen for rework)
```

Transitions enforced in `src/lib/normalization/statuses.ts::canTransition`
and executed only through `changeAdjustmentStatus`. Direct DB updates
that skip a valid transition are outside the app layer — the audit
chain (Slice 6) detects them.

**Reasons required for**: `REJECTED`, `NEEDS_SUPPORT`. Empty-string
reasons throw. Every transition writes an audit event.

**Only DRAFT or REJECTED adjustments can be deleted.** Approved work
cannot vanish silently.

## Reported → Normalized bridge

Per period (year2, year1, TTM):

```
    Reported EBITDA (from FinancialValue, classified via Slice-9 concept)
  ±  Σ approved adjustments (direction ADD or SUBTRACT)
  =  Normalized EBITDA
```

Only `APPROVED` adjustments modify the bridge. DRAFT / PROPOSED /
NEEDS_SUPPORT / REJECTED rows are visible in the workbench but do not
change the normalized number. Rule: no silent inclusion of unapproved
work.

Reported EBITDA is derived on the fly from `FinancialValue` rows whose
`lineItem` classifies to `EBITDA` (Slice 9 concept classifier), summed
per year. Mapping to the workbench's three periods:

- Latest year → `year1`
- Second-latest year → `year2`
- Any `year='TTM'` row → `ttm`

If a period has no EBITDA data, the reported value is 0. A completeness
warning surfaces this.

## Warnings

Non-blocking. `warningsFor(adjustment)` returns a list with severities:

- `ERROR`: `MISSING_RATIONALE`, `NO_AMOUNTS` — the row cannot support a
  defensible report.
- `WARN`: `NO_CITATIONS` — supporting evidence is missing.
- `INFO`: `MISSING_RECURRING_LABEL`, `MISSING_TAX_TREATMENT` — optional
  fields.

The workbench surfaces every warning. Report generation
(`draftReportSection`, Slice 8) can gate on `ERROR`-severity warnings
separately.

## Categories

Suggested (from `SUGGESTED_CATEGORIES`):

- OWNER_COMPENSATION
- PERSONAL_EXPENSES
- RELATED_PARTY_RENT
- ONE_TIME_LITIGATION
- NONRECURRING_PROFESSIONAL_FEES
- DISCRETIONARY_EXPENSE
- NON_OPERATING_INCOME
- NON_OPERATING_EXPENSE
- DEPRECIATION_AMORTIZATION
- INTEREST_EXPENSE
- INCOME_TAXES

**These are labels, not gatekeepers.** The `category` column is
free-form text. The UI's `<datalist>` shows them as autocomplete
suggestions; a fresh engagement's unusual adjustment ("SBA loan
forgiveness") types itself in without any schema or code change.
Rule from the slice prompt: *do not hardcode accounting judgment*.

`defaultDirectionFor(category)` returns a UX default (SUBTRACT for
non-operating income, ADD for the rest). The analyst can flip it.

## Reviewer queue

`getCaseReviewerQueue(caseId)` returns adjustments where `status ∈ {
PROPOSED, NEEDS_SUPPORT }`, sorted by status then updatedAt.
`getOrgReviewerQueue()` scopes across the caller's org — ready for a
future dashboard slice. Both actions are tenant-scoped (case-level or
org-level).

## Server actions

All go through Slice-1 authz.

| Action | Permission | Notes |
|---|---|---|
| `getWorkbenchForCase(caseId)` | `case:read` | Full workbench data + bridge + warnings |
| `createAdjustment(caseId, input)` | `addback:write` | Starts as DRAFT, proposedBy = session |
| `updateAdjustment(id, input)` | `addback:write` | Only DRAFT / NEEDS_SUPPORT / REJECTED |
| `changeAdjustmentStatus(id, next, reason?)` | `addback:approve` | Validates transition; requires reason for REJECTED / NEEDS_SUPPORT |
| `deleteAdjustment(id)` | `addback:write` | Only DRAFT / REJECTED |
| `getCaseReviewerQueue(caseId)` | `case:read` | |
| `getOrgReviewerQueue()` | requireOrganization | |

Every status change writes an `AuditLog` event that lands on the Slice-6
tamper-evident hash chain.

## UI

`src/components/normalization-workbench.tsx`, mounted on a new
**Normalization** tab in `/projects/[id]`.

- Top card: bridge per period — Reported / Adjustments / Normalized.
- Bottom card: adjustments list, sorted `NEEDS_SUPPORT → PROPOSED →
  DRAFT → REJECTED → APPROVED`.
- Per-row: status badge, category, description, amounts, rationale,
  citations count, warnings (error / warn / info), status-transition
  buttons filtered by `ALLOWED_TRANSITIONS`.
- Dialogs for create / edit / reject / needs-support with a required
  reason field where applicable.

The pre-Slice-10 **Add-Backs** tab is retained (renders the existing
`AddBackSchedule` read-only view). Both coexist during the transition —
the Slice-1 dual-write pattern.

## Migration

Additive schema plus a single non-destructive backfill:

```sql
UPDATE `AddBack`
   SET `status` = 'APPROVED', ...
 WHERE `isApproved` = 1;
```

Old add-backs remain readable and behave identically. New writes use
the workbench's status machine.

## Extension points (not in Slice 10)

- **Additional years** (year3, year4, year5) via a JSON `amountsExtra`
  column or a normalized `AdjustmentPeriod` child table. Current 3-slot
  design covers typical forensic engagements.
- **Tax gross-up**: `taxTreatment='AFTER_TAX'` amounts could be grossed
  up in the bridge. Not implemented; kept as a display flag for now.
- **Automatic tie-out**: the workbench could auto-flag an adjustment
  whose sign inconsistently swings across periods (e.g. add-back one
  year, subtraction the next). Data is captured; the check is future.
- **Cross-case template library**: analysts often re-use "owner comp"
  and "personal expenses" phrasing. A future slice can save templates.
- **Global reviewer queue UI**: `getOrgReviewerQueue` is server-ready.
- **Report integration**: `draftReportSection` (Slice 8) can consume
  the bridge output. Threading it in is a small follow-up.
