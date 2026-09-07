# Evidence Model

Chain of custody in ValuVault is built on three load-bearing patterns
from Slices 5, 6, and 7.

## 1. Immutable document versions (Slice 5)

- `Document` denormalizes the *current* version pointer for fast
  reads.
- Every upload creates a fresh `DocumentVersion` row. Rows are
  never updated except to flip `isArchived` on soft-delete.
- Per-version SHA-256 (`sha256Hash`) is computed BEFORE the S3 put
  and pinned. A later re-upload of the same bytes still creates a
  new version — the caller's timestamp differs.
- `s3Key` follows a self-describing pattern:
  `orgs/<org>/cases/<case>/documents/<doc>/versions/<n>/<filename>`.
  A stray prefix-delete on `orgs/<orgA>/` cannot touch another
  org's evidence.
- Uploads are magic-byte MIME sniffed (Slice 5). A `.pdf`-renamed
  executable is refused before the S3 put.
- Malware scan on every version. INFECTED versions refuse
  signed-URL generation.

## 2. Tamper-evident audit chain (Slice 6)

- Every material mutation lands in `AuditLog`. The Slice-0 baseline
  action set + Slice 2-16 additions cover every write.
- Chain fields per row: `chainKey`, `sequence`, `previousHash`,
  `eventHash`, `hashVersion`.
- `chainKey` is per-organization (or `global:anon` for pre-auth
  events). Per-org chains isolate blast radius: a tampered row on
  Org A's chain does not invalidate Org B's.
- Verification: `verifyAuditChain(chainKey)` walks the chain and
  reports the first mismatch. UI badge (Slice 6) surfaces the
  result on demand.
- Enforcement: application code does not call
  `prisma.auditLog.update` or `prisma.auditLog.delete`. The Slice-0
  smoke test asserts the absence of both calls across `src/`.
- Retries: chain writes retry up to 3 times on `P2002` (concurrent
  sequence collision), then fall back to an unchained insert
  logged as `pre-chain` — better degraded than lost.

## 3. Evidence-level citations (Slice 7)

- `EvidenceCitation` binds a material forensic value (financial
  value, add-back, valuation assumption) to a specific
  `DocumentVersion`.
- `isConfident` flag distinguishes AI-grounded citations from
  "the AI tried but could not locate the source" placeholders.
  Defense-in-depth converter NULLs coordinate fields when
  unconfident.
- Slice-14 report drafts NEVER include a citation whose targetId
  is not present in the scoped facts payload (post-AI validator
  in `src/lib/reports/citation-validator.ts`).

## 4. Report snapshot immutability (Slice 14)

- `ReportVersion` freezes:
  - The full `factsSnapshot` JSON that fed the drafts,
  - Its SHA-256 (`factsHash`),
  - The specific `ReportSectionVersion.id` for each section
    (via a back-pointer).
- Approving a section is refused when the section body's
  `factsHash` differs from the current `buildReportFacts` hash
  — no approving stale drafts.
- Every DOCX / plain-text export prepends the
  non-certifying-checklist disclaimer.

## 5. Origin tagging (Slice 15)

- `FinancialValue.origin` distinguishes AI-extracted values from
  values promoted from QuickBooks, Xero, Sage, NetSuite, or Excel
  imports. Promotion is an explicit action that stamps the origin.
- The UI always renders the origin badge on a financial value.

## Data preservation vs. deletion

- Soft-delete first. `Document.isArchived` /
  `DocumentVersion.isArchived` retain the row + S3 object.
- Hard delete requires a separate, audited pathway (not yet built —
  gated on legal-hold checks).
- `AuditLog` is never deleted at the app layer. Retention is
  governed by [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md).

## What "approved-only" means

The following slices consume only APPROVED / verified evidence:

- **Slice-14 report facts** — verified `FinancialValue`, APPROVED
  `AddBack`, APPROVED `ValuationAssumption`, APPROVED
  `OwnershipAdjustment`, non-blocking `ValuationReconciliation`,
  confident `EvidenceCitation`.
- **Slice-16 case-search index** — same policy.

Draft / proposed / rejected values NEVER surface in reports or
search results.
