# Evidence-Level Financial Citations

Landed in Slice 7. Every material forensic value can be traced back to
a specific, immutable `DocumentVersion` with structured metadata about
*where* in the source document it came from.

## The model

```
EvidenceCitation
  ├─ documentVersionId    → DocumentVersion (Slice 5 immutable)
  ├─ financialValueId     ┐
  ├─ addBackId            ├─ exactly one of these is set
  ├─ valuationModelId     ┘
  ├─ pageNumber           1-indexed
  ├─ sourceLabel          human-readable, e.g. "Income Statement, row 'Gross Revenue'"
  ├─ tableName / rowLabel / columnLabel
  ├─ boundingBox          JSON { x, y, w, h, unit: 'norm' | 'pt' | 'px' }
  ├─ rawText              the exact substring extracted
  ├─ extractor            'ai-genkit' | 'analyst' | 'legacy-backfill'
  ├─ extractorVersion     'gemini-2.5-flash-v1' | userId | ...
  ├─ confidence           0..1
  └─ isConfident          Boolean — false ⇒ no coordinates were persisted
```

Design notes:
- **Points at `DocumentVersion`, not `Document`.** Slice 5 guarantees the
  bytes referenced by a version don't change. A citation to v2 remains
  valid when v3 supersedes it.
- **Polymorphic parent via three optional FKs.** Exactly one is set; the
  application-layer `assertSingleParent` helper enforces this on any
  read-back shape that's uncertain.
- **`onDelete: Cascade`** from all three parents. Deleting a parent
  value cleans up its citations. The DocumentVersion side is
  `onDelete: RESTRICT` — we refuse to drop a version that's still cited.

## Anti-hallucination discipline (Rule 9)

The single hardest requirement in this slice: **never fabricate a page
number, table name, or bounding box.** Every code path that produces a
citation respects this:

- **AI extraction schema** (`src/ai/flows/ai-financial-statement-extraction-flow.ts`)
  forces the model to declare `citation.isConfident`. The prompt is
  explicit:

  > If you CANNOT confidently locate the value on a specific page, set
  > citation.isConfident = false and leave pageNumber, tableName,
  > rowLabel, columnLabel, and boundingBox all null. […] DO NOT GUESS.
  > DO NOT fabricate a bounding box.

- **The AI-to-DB converter** (`src/lib/citations/from-ai.ts::toEvidenceCitationData`)
  is defense-in-depth: even if the model sets `isConfident=false` but
  still emits a `pageNumber`, we NULL every coordinate field before
  writing. The model's confidence is authoritative for what gets
  persisted.

- **`getCitationSourceUrl`** appends `#page=N` **only** when
  `isConfident === true && pageNumber != null`. A low-confidence
  citation gets a plain download URL — no navigation is fabricated.

- **Legacy backfill** (`scripts/migrate-source-refs-to-citations.ts`)
  never parses "page 4, table 2, row 'Revenue'" out of the free-text
  `FinancialValue.sourceRef` column. It preserves the original string as
  `sourceLabel` and sets `isConfident=false, pageNumber=null`. Any
  future parser that *does* attempt structured extraction from that text
  has to justify the fabrication risk on its own terms.

## UI conventions

`<CitationIndicator financialValueId=... />` sits beside every reviewed
FinancialValue. Three states, visually distinct:

| State | Appearance | Meaning |
|---|---|---|
| Loading | grey spinner | fetch in flight |
| **No citation** | amber "No source" badge | No traceable evidence — Rule 8 |
| **Cited, confident** | green "N sources" badge | AI or analyst pinned the location |
| **Cited, unlocated** | orange "Unlocated" badge | Citation exists but AI wasn't sure — coordinates null |

The dialog shows every citation for the value with:
- Document name + version number (immutable target).
- Page badge (only when `isConfident` — never a fabricated page).
- "AI unsure" badge for unlocated citations.
- Table / row / column labels + raw text substring.
- Extractor identity + confidence percentage.
- A "View source" button that opens the signed URL in a new tab, with
  `#page=N` appended only when the location is confident.

## Server actions

- `getCitationsForFinancialValue(id)` — tenant-scoped via
  `requireFinancialValueAccess(id, 'case:read')`.
- `getCitationsForAddBack(id)` — via `requireAddBackAccess`.
- `getCitationsForValuationModel(id)` — via `requireValuationModelAccess`.
- `getCitationSourceUrl(citationId)` — dual tenant check
  (`requireDocumentVersionAccess`), respects Slice-5 download gates
  (archived, scan status not CLEAN), 5-min signed URL,
  `#page=N` appended only when confident, audited as
  `DOWNLOAD_DOCUMENT_VERSION` with `note: 'via citation'`.
- `attachManualCitationToFinancialValue(...)` — a future "analyst adds
  source" UI can call this; not wired to a button in Slice 7 but the
  server surface is stable + tested.

## Backfill

The migration is fully non-destructive:

1. `docs/migrations/slice-7-evidence-citations.sql` creates the
   `EvidenceCitation` table + 4 indexes + 4 foreign keys, inside a
   transaction with an explicit rollback.
2. `scripts/migrate-source-refs-to-citations.ts` — idempotent. For
   every `FinancialValue` with a non-null `sourceRef` and no existing
   citations, it creates a `legacy-backfill` row with
   `isConfident=false`, `pageNumber=null`, `sourceLabel = sourceRef`.
   Rows whose parent document hasn't been Slice-5-versioned yet are
   skipped (need `Document.currentVersionId` to point somewhere).
3. New AI extractions from Slice 7 code onward produce structured
   citations with the model's own `isConfident` verdict.

## Extraction flow at a glance

```
runFinancialExtraction(caseId, documentId?)
  1. requireDocumentAccess or requireCaseAccess          — Slice 1
  2. fetch document + read Document.currentVersionId     — Slice 5
  3. pull bytes from S3, run extraction flow
  4. for each extracted item:
       a. prisma.financialValue.create(...)
       b. if document has a currentVersionId:
            toEvidenceCitationData(hint, sourceRef, ...) — Slice 7
            prisma.evidenceCitation.create(...)
  5. mark document EXTRACTED, audit event                — Slice 6
```

If Step 2 finds no `currentVersionId` (pre-Slice-5 document that hasn't
been backfilled), citations are skipped for that run — the
FinancialValue still gets its legacy `sourceRef` and can be backfilled
by the migration script later.

## Human overrides and citations

An analyst overriding a `FinancialValue` does NOT touch its citations.
The citation attests to *what the AI or a prior analyst cited when the
value was first written*. When the current value diverges from the
original AI suggestion, the citation is best read as historical
provenance — the `FinancialValue.aiSuggestedValue` column (Slice 0)
holds the value it was originally cited *for*. If a UI later wants to
show "citation is stale relative to current value" this is a UX
addition, not a data-model change.

## Explicitly out of scope

- **PDF-canvas highlighting.** The badge navigates to
  `#page=N` and displays coordinates as text. Rendering the
  `boundingBox` on a PDF viewer canvas is a UI slice.
- **Human-authored citations UI.** `attachManualCitationToFinancialValue`
  is ready; a "cite this row" button is not wired.
- **Citations on ValuationModel assumptions.** The relation exists;
  hooking up `saveValuation` to accept citation hints per assumption is
  a future slice.
- **Text-extraction parser for the legacy `sourceRef` string.** Rule 9
  forbids fabricating structure from prose. If a future slice wants to
  attempt this, it should ship a confidence score and a review workflow.
- **Full-history archival of citations when a DocumentVersion is
  archived.** Slice 5 keeps archived versions in S3; a citation to
  an archived version currently fails to sign — the citation row itself
  remains inspectable so an analyst can see *why* the source is
  unavailable.
