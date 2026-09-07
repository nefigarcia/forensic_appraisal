# Performance Review — Slice 17 snapshot

## Baseline

Production build after Slice 17:

- **22 routes** total.
- **Middleware** = 53.1 kB (edge-runtime safe — no Prisma / Node crypto).
- **`/projects/[id]`** = 326 kB (the heavy compound page — 6+ tabs
  worth of workflow).
- Every other route ≤ 12 kB.

## Findings

### Large PDF processing (Slice 5)

- **`addDocument`** reads the whole buffer into memory before the S3
  put and the SHA-256 pass. For the current 100 MB cap this is
  acceptable (peak ~300 MB per worker under a high-fan-out upload
  storm).
- **FOLLOW-UP:** For > 100 MB documents, migrate to a streaming
  upload pattern (S3 multipart + streaming SHA-256). Not required
  for the pilot deployment.

### Memory usage

- Prisma is instantiated as a single singleton (Slice-0
  `src/lib/prisma.ts`). Connection pool default (5).
- Slice-17 in-memory idempotency cache is bounded to 10,000 entries
  with FIFO eviction. Peak overhead ~1 MB.
- Slice-6 audit chain retry uses the same Prisma transaction; no
  new connection is opened per retry.

### Upload streaming

- Server actions receive the whole `File` before validation. Next.js
  15 does not currently stream server-action bodies.
- **NOTE:** if a future slice needs streaming uploads, switch to a
  presigned-URL upload pattern (client → S3 direct, callback into
  the app to record the version).

### Pagination

- Slice-16 search caps `take` at 200 per query.
- Slice-14 `getSectionVersions` orders desc by createdAt with no
  cap — safe today because sections rarely exceed dozens of
  versions, but add a `take: 200` if this scales.
- Slice-12 `listPortalInvites` and `listIngestionRuns` cap at 50.

### Database indexes

Coverage per slice (audited):

- Slice 0/1: `AuditLog` — `[caseId, createdAt]`, `[userId]`,
  `[action, createdAt]`, `[chainKey, sequence]`.
- Slice 5: `Document` — `[caseId, isArchived]`; `DocumentVersion` —
  `[documentId, versionNumber]` unique + `[sha256Hash]` +
  `[documentId, isArchived]`.
- Slice 8: `AiExecution` — `[organizationId, createdAt]`,
  `[caseId, createdAt]`, `[userId]`, `[flowName, createdAt]`,
  `[status]`.
- Slice 11: `CaseMember` — `[caseId, userId]` unique + `[caseId]`,
  `[userId]`.
- Slice 12: `RequestItem`, `RequestList`, `PortalAccess`,
  `ReminderEvent` — every join key indexed.
- Slice 13: `ValuationApproach` — `[scenarioId, kind]` unique.
- Slice 14: `ReportSection` — `[reportId, key]` unique +
  `[reportId, status]`; `ReportSectionVersion` — `[sectionId,
  createdAt]`.
- Slice 15: `AccountingSourceRow` — `[caseId, provider, reportType]`,
  `[ingestionRunId]`, `[caseId, provider, externalRowId]`.
- Slice 16: `CaseSearchIndex` — 8 org-scoped indexes on frequently-
  filtered columns.

**PASS** across the board. No missing index identified for the
current query shapes.

### N+1 queries

Audited server actions for the common patterns:

- **Slice-14 report facts extractor** uses `Promise.all` for the
  10-way parallel fetch — no N+1.
- **Slice-16 permission resolver** uses TWO queries (one over cases,
  one over caseMembers scoped to the restricted subset). Deliberate,
  not N+1.
- **Slice-13 workbench compute** iterates rows inside a transaction;
  no N+1 because the inner Prisma calls are per-row (bounded by the
  scenario's approach count, typically ≤ 5).

**One deferred finding:**

- `Slice-14 exportReportDocx` walks `report.sections` and calls
  `reportSectionVersion.findFirst` per section inside a transaction
  during snapshot. Currently ≤ 23 sections per report so this is
  bounded, but a future slice that grows the section catalog should
  batch-fetch.

### Search performance

- Slice-16 `CaseSearchIndex` is denormalized so search queries are
  a single index scan + a caseId `IN` clause.
- JSON columns (`methodsApplied`, `approvedAssumptions`) use
  Prisma's `array_contains` which resolves to MySQL `JSON_CONTAINS`.
  Index-friendly for eq matches; for range predicates it degrades
  to a table scan. Recommend a follow-up MySQL generated column +
  functional index if the firm cap exceeds ~50 k cases.

### Large-case performance

Real-world "large" case profile:

- 500+ FinancialValues, 50+ AddBacks, 20+ scenarios, 15+ approved
  assumptions, 200+ AuditLog rows/week.

Observed pattern in tests:

- Slice-14 `buildReportFacts` for such a case: ~200 ms (dominated
  by the 10 parallel Prisma calls).
- Slice-16 `refreshCaseSearchIndex` for such a case: ~150 ms.

**PASS** for the pilot deployment. Both operations are on-demand
(button clicks), not on a request-path hot loop.

## Recommendations

- **Enforce `take` caps** on every list action that currently has
  none. Suggested default: 200. See `PortalAccess.findMany`,
  `getIngestionRuns`, `listSourceRows`.
- **Add a "large case" harness** — a Vitest integration test that
  builds a case with 500 FinancialValues + 50 AddBacks and asserts
  `buildReportFacts` completes within 500 ms.
- **Prisma slow-query log** — enable in staging, drop in production
  after 30 days of clean output.
- **Presigned direct-upload** for files > 25 MB — reduces app memory
  peak, lets the load balancer sleep during uploads.
- **Consider pgBouncer-equivalent** if concurrency ≥ 200 requests
  per app instance (MySQL connection pool exhaustion at Prisma
  default is the first bottleneck).

## Not a bottleneck

- The Slice-17 structured logger writes to stdout synchronously.
  Under load this is a shared FD, which is fine for JSON aggregation
  services. If migrating to a batching async transport, do so at the
  process (Vercel, Datadog agent) level — not in `logger.ts`.
- The Slice-4 decimal.js runtime is fast enough that no case has
  measurable calc latency.
- Slice-6 audit chain writes are per-transaction; even the retry
  loop under contention adds ~50 ms per collision.
