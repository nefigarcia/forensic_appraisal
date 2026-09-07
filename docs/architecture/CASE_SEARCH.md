# Institutional Valuation Intelligence (Case Search)

Landed in Slice 16. A permission-aware, whitelist-scoped search over
the firm's own case history. Two modes:

- **Factual** — structured filters (state, industry, method, DLOM
  band, related-party flag, …). No AI in the request path.
- **Semantic / AI-planned** — natural-language question → structured
  filter DSL, produced by an AI *planner* that is architecturally
  incapable of returning confidential data or a recommendation.

Both modes route through the SAME permission resolver, the SAME query
composer, and the SAME defense-in-depth post-query filter.

## Data flow

```
User (session)
      │
      ▼
resolveAuthorizedCaseIds(session)      ← src/lib/search/permissions.ts
      │  (Slice-1 tenant + Slice-11 engagement gate)
      ▼
    authorizedCaseIds: string[]
      │
      ▼
FilterSet (from UI or AI planner)
      │
      ▼
validateFilterSet(filterSet)           ← src/lib/search/query-shape.ts
      │  (whitelist check)
      ▼
composeSearchQuery({ orgId, authorizedCaseIds, filterSet })  ← src/lib/search/filters.ts
      │
      ▼
prisma.caseSearchIndex.findMany(where, orderBy, take)
      │
      ▼
filterResultsToAuthorized(rows, authorizedCaseIds)  ← defense-in-depth
      │
      ▼
SearchResultRow[]  (never contains a leaked case)
```

## The permission model

Every request applies both boundaries every time:

1. **Slice-1 tenant** — `CaseSearchIndex.organizationId = session.organizationId`.
   Enforced by `composeSearchQuery` as an unconditional `AND` clause,
   AND by `resolveAuthorizedCaseIds` which fetches only in-org cases.
2. **Slice-11 engagement team** — for cases with
   `hasEngagementTeam=true`, non-ADMIN callers must have an *active*
   `CaseMember` row. Enforced by `resolveAuthorizedCaseIds` returning
   only cases the caller passes both boundaries for.

The user-supplied filter set has ZERO influence on this list. Even a
hostile AI-planned filter cannot broaden it.

### Defense-in-depth: `filterResultsToAuthorized`

Even after the composed WHERE is executed, every row is checked
against `authorizedCaseIds` in application code. Any row whose caseId
is not on the list is dropped, and the leak is logged via the
Slice-6 chained audit trail. The caller still gets a safe result — a
schema drift or bug does not become a data leak.

## The filter DSL — closed whitelist

`FilterSet.filters` is an array of `SearchFilter`s. Each filter is a
`{kind, filter}` pair. The `field` value MUST be in one of the
whitelisted lists in `query-shape.ts`:

- `STRING_SEARCH_FIELDS` — case name, client name, industry, geography codes
- `NUMERIC_SEARCH_FIELDS` — DLOC/DLOM percent, concluded values, doc count
- `DATE_SEARCH_FIELDS` — valuation / report finalized dates
- `BOOLEAN_SEARCH_FIELDS` — `hasRelatedPartyAddBack`
- `ARRAY_SEARCH_FIELDS` — `methodsApplied`, `approvedAddBackCategoryKeys`, `approvedAssumptionKeys`

`validateFilterSet` runs BEFORE any DB query. Anything unknown → hard
failure. `composeSearchQuery` additionally drops unknown fields as
defense-in-depth and records them in `dropped[]` for observability.

Operator set is closed:

- string: `eq`, `contains`
- numeric: `eq`, `gte`, `lte`, `between`
- date: `eq`, `gte`, `lte`, `between`
- boolean: `eq`
- array: `includes`, `anyOf`

There is no `groupBy`, no free-form SQL, no user-supplied WHERE.

## The AI planner — grounded to the whitelist

`caseSearchPlannerFlow` takes a natural-language question and returns
a structured `FilterSet`. Its Zod output schema is a
`discriminatedUnion` with the SAME whitelisted enums the DSL uses —
the AI cannot smuggle a field name outside the whitelist because the
model output would fail validation.

The prompt explicitly forbids:

- recommending a valuation method,
- returning case identifiers or client names,
- inferring what the analyst should do.

Its output shape does not include a "recommendation" field. Downstream
code (`searchCasesWithAI`) never treats the output as advice; it uses
the filters, runs them, and shows the caller which filters ran.

`AiCaseSearchRun` persists:

- the natural-language question,
- the proposed filter set (as submitted by the AI),
- the executed filter set (may differ if the caller edits),
- the returned caseIds (audit trail),
- the `AiExecution.id` (Slice-8 wrapper — input/output hashing).

`isConfident` is `true` only when both the AI's own confidence AND the
whitelist validator agree. A regression that lets the AI produce a
"clientEmail" filter is caught by the validator; `isConfident` flips
to false and NO query runs.

## The index — approved facts only

`CaseSearchIndex` is refreshed by `refreshCaseSearchIndex(caseId)`.
It aggregates the SAME approved-only slice of case data that Slice 14
uses to draft reports:

- `FinancialValue.isVerified = true` — verified financials
- `AddBack.status = 'APPROVED'` — normalization schedule
- `ValuationAssumption.status = 'APPROVED'` — Slice-13 assumptions
- `OwnershipAdjustment.status = 'APPROVED'` — Slice-13 DLOC/DLOM
- `ValuationReconciliation.hasBlockingAssumptions = false` — concluded values
- `EvidenceCitation.isConfident = true` — Slice-7 citations
- `Document.isArchived = false`

Proposed / rejected values NEVER land in the index. A case whose
DLOM is DRAFT does not surface in a "cases with DLOM 18-25%" search.

Refresh is on-demand from `refreshCaseIndex` server action. Cases
with no `CaseSearchIndex` row (e.g. never had one refreshed) simply
do not appear in search results — safe by default.

## No auto-recommendation

The slice prompt is unambiguous: *"Do not use historical professional
decisions as automatic recommendations."*

The architecture enforces this at three layers:

1. **AI output schema.** The planner returns filter parameters, not
   advice. There is no field for "recommended method" or "suggested
   DLOM".
2. **Search-result shape.** `SearchResultRow` shows facts (state,
   industry, method applied, approved DLOM band), NEVER a
   "recommended" or "suggested" derivative. A downstream feature
   that wants to compute an aggregate MUST do so explicitly and
   MUST NOT surface it as advice.
3. **UI copy.** The knowledge-base page describes search results as
   history, not recommendations.

## Migration

Purely additive except three nullable geography columns on `Case`.
Two new tables (`CaseSearchIndex`, `AiCaseSearchRun`).

Migration SQL:
[docs/migrations/slice-16-case-search.sql](docs/migrations/slice-16-case-search.sql).

Existing cases open with no index row. Search returns them once an
analyst calls `refreshCaseIndex` (or the Slice-13/14 workflow
triggers a refresh in a follow-up integration).

## Explicit non-goals

- **Cross-firm search.** The search never crosses `organizationId`.
  Firm-to-firm benchmarking is a separate product.
- **Vector / semantic embeddings over document text.** The AI planner
  produces structured filters over structured facts — not RAG over
  document chunks. A future slice could layer document-level search
  on the same permission resolver.
- **Automatic index refresh on every lifecycle event.** Refresh is
  explicit for now. A follow-up slice can wire hooks into the
  Slice-13/14 approval actions.
- **Full-text search over free-form fields.** `contains` on
  `industryLabel` etc. uses SQL `LIKE`; a future slice can plug in a
  MySQL fulltext index or an external service.
- **Historical decisions as recommendations.** Deliberately not built.
- **All Slice 1-15 backlogs** remain open.
