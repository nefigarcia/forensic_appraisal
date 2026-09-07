# Evidence-Grounded Valuation Report Composer

Landed in Slice 14. Composes professional valuation reports from
approved-only engagement data, with an AI drafting assist that is
grounded to a scrubbed fact payload and a human approval workflow.

## Data flow

```
APPROVED evidence + financials + normalization + valuation assumptions
                              │
                              ▼
                    buildReportFacts(caseId)
                              │
                              ▼
                    ReportFactsPayload
                    (+ SHA-256 factsHash)
                              │
                              ▼
                    scopeForSection(payload, key)
                              │
                              ▼
                     ┌───────────────────┐
                     │  AI section flow  │  ← withAIExecution wrapper
                     └────────┬──────────┘   ← flow: reportSectionNarrativeV2Flow
                              │
                              ▼
              narrative + citations + missingInformation
                              │
                              ▼
                    validateCitations(...)     ← drops any citation
                              │                  whose targetId is not
                              ▼                  in the payload
                    ReportSectionVersion
                    (AI_DRAFTED, factsHash pinned)
                              │
                              ▼
                    Human edit ─► READY_FOR_REVIEW ─► APPROVED
                                                     ▲
                                                     │
                          (reviewer distinct from author,
                           section factsHash matches current)
                              │
                              ▼
                    Freeze ReportVersion (immutable snapshot)
                              │
                              ▼
                    Export DOCX / plain text
```

## Grounding rules

1. **Approved-only facts.** `buildReportFacts` is the sole boundary
   between raw case data and the AI. It filters to:
   - `FinancialValue.isVerified = true`
   - `AddBack.status = 'APPROVED'` (Slice 10)
   - `ValuationAssumption.status = 'APPROVED'` (Slice 13)
   - `OwnershipAdjustment.status = 'APPROVED'` (Slice 13)
   - `ValuationReconciliation.hasBlockingAssumptions = false`
   - `EvidenceCitation.isConfident = true` (Slice 7)
   - `Document.isArchived = false` (Slice 5)
2. **Section-scoped payload.** Each section only sees the fact
   families it needs. `SECTION_CATALOG[key].factScope` declares the
   subset; `scopeForSection` returns only those keys. Even a hostile
   prompt cannot cite an out-of-scope fact because it is not in the
   input.
3. **No invented citations.** The AI returns citations as
   `(targetType, targetId)`. `validateCitations` drops any pair whose
   id is not in the payload index. The dropped count is surfaced to
   the reviewer.
4. **Missing information is reported.** The prompt requires a
   `missingInformation[]` list. The section version stores it; the
   reviewer sees it in the composer surface and in the DOCX export.
5. **Anti-hallucination confidence flag.** Slice-7 pattern — the
   flow returns `isConfident`. Server code additionally downgrades
   `AI_DRAFTED` confidence to `false` when the returned body is empty.
6. **Every draft creates an AiExecution.** Slice-8 wrapper — input
   hash, output hash, document-version provenance. The section
   version pins the resulting `AiExecution.id`.

## Section catalog

23 canonical section keys (`REPORT_SECTION_KEYS`) mirror the
slice-prompt list — engagement identification, subject company,
purpose, intended use/users, valuation date, standard/premise of
value, company history, ownership, products/services, customers,
management, competition, economic overview, industry analysis,
financial analysis, normalization, valuation approaches,
reconciliation, conclusion, assumptions, limiting conditions, source
list. Five of the "narrative color" sections (company history,
products, customers, management, competition) are optional; the rest
are required and count toward the readiness percent.

## Section status machine

```
NOT_STARTED ─► AI_DRAFTED ─► HUMAN_EDITING ─► READY_FOR_REVIEW ─► APPROVED
     ▲                              ▲                                 │
     │                              │                                 │
     └──────── reset by author ─────┘                                 │
                     APPROVED → HUMAN_EDITING (reopens for rework) ──┘
```

Reopening an APPROVED section always drops to HUMAN_EDITING — never
directly to READY_FOR_REVIEW. The reviewer must see what changed
before the next approval.

## Approval invariants (server-enforced)

`changeSectionStatus(..., 'APPROVED')` refuses when:

1. **Author self-approval.** The current `ReportSectionVersion.authorUserId`
   equals the reviewer's session userId → `ForbiddenError`.
2. **Stale draft.** The current version's `factsHash` differs from the
   current `buildReportFacts` hash → throws with an explicit "re-draft
   or re-edit" message.
3. **FINAL report.** Once `Report.status = 'FINAL'`, no section may
   change. Reopening the report is a separate action.

Every approval writes to `AuditLog` via `logAction` (Slice-6 tamper-
evident chain).

## Immutable snapshots

`freezeReportVersion` creates a `ReportVersion` row with:
- monotonic `versionNumber` per report,
- optional human `label`,
- the full `factsSnapshot` JSON + `factsHash`,
- the pinned `ReportSectionVersion.id` for every section
  (`reportVersionId` back-pointer written inside the transaction).

The report's `currentVersionId` is updated to point at the fresh row.
Future exports default to that pinned version; the caller can also
export a specific past version.

## Standards checklists — professional aid, not certification

`StandardsChecklist` presets exist for AICPA SSVS, ASA BVS, and NACVA.
They live in code (`src/lib/reports/checklists.ts::SEED_CHECKLISTS`)
and are copied into per-report `ReportChecklistItem` rows when an
analyst attaches one. Each item cycles through PENDING → ADDRESSED /
NOT_APPLIC / AT_RISK.

A prominent, non-negotiable disclaimer is:

- rendered above every checklist UI,
- included as a NOTICE row in the DOCX export,
- present in `Report.disclaimer` on the client DTO for the report
  composer.

**AT_RISK** checklist items block `isFinalReady` in the readiness
summary, even at 100% section approval.

## Readiness dashboard

```
readiness = APPROVED-required-sections / TOTAL-required-sections × 100
```

`computeReadiness` returns:
- `readinessPercent` (0–100),
- `requiredApproved` / `requiredStale` / `requiredTotal`,
- `optionalApproved` / `optionalTotal`,
- `atRiskChecklistItems` / `pendingChecklistItems`,
- `isFinalReady` = 100% required, no stale, no at-risk items.

Stale APPROVED sections do NOT count toward `requiredApproved`. A
downstream `changeReportStatus('FINAL')` remains a professional
decision; the dashboard tells the analyst when the report is
mechanically ready.

## Export

Two exporters share the same input shape:

- **Plain text** (`renderPlainText`) — always available, deterministic,
  UTF-8. Includes the disclaimer as a NOTICE line.
- **DOCX** (`renderDocx`) — uses the `docx` npm package to produce a
  real Word document. Headings, bullet lists for `missingInformation`,
  italic notes for low-confidence sections, and a Citations section
  at the end.

PDF is intentionally out of scope for this slice — the DOCX file can
be opened in Word/LibreOffice for a controlled PDF conversion. A
future slice can plug in a headless-Chromium or LibreOffice pipeline.

## Migration

Purely additive. Seven new tables:
- `Report`, `ReportVersion`, `ReportSection`, `ReportSectionVersion`,
  `ReportCitation`, `StandardsChecklist`, `StandardsChecklistItem`,
  `ReportChecklistItem`.

Nothing on the pre-existing valuation, financial, or evidence tables
is touched. Existing cases open with `report = null` until an analyst
calls `initializeReport`.

Migration SQL at
[docs/migrations/slice-14-report-composer.sql](docs/migrations/slice-14-report-composer.sql).

## Explicit non-goals

- **Compliance certification.** The app does not certify AICPA, ASA,
  NACVA, or USPAP compliance. The checklists are aids only. Every
  export includes the disclaimer.
- **PDF export.** DOCX only. Downstream conversion pipeline is a
  follow-up.
- **Cross-report comparisons.** No org-level "reports in progress"
  dashboard yet.
- **Fine-grained section-version diffing.** History rows exist; UI to
  diff two versions inline is a follow-up.
- **AI-suggested checklist status.** Human-only; the checklist is a
  reviewer signal, not an AI-driven verdict.
- **Automatic snapshot on every save.** Snapshots are explicit —
  `freezeReportVersion` runs when the analyst clicks the button.
- **All Slice 1–13 backlogs** remain open.
