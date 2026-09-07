# Document Versioning & Immutable Evidence

Landed in Slice 5. This document explains the model, the guarantees it
provides, the migration path, and the extension points (malware
scanner, hard-delete, archival to Glacier).

## Guarantees

- **The bytes an analyst uploaded are never overwritten.** Every re-upload
  creates a new `DocumentVersion` row with its own S3 key and its own
  SHA-256 hash. Old versions remain intact and downloadable.
- **Every version is identified by hash.** `DocumentVersion.sha256Hash`
  is computed from the exact bytes S3 receives. The `[sha256Hash]` index
  makes duplicate-detection cheap.
- **Deletion is soft.** `deleteDocument` sets `isArchived = true`, records
  who and why, and leaves the S3 objects + DB row in place. A future
  admin-only hard-delete slice can add real destruction with legal-hold
  checks.
- **Tenant scoping applies at every entry point.** Uploads, downloads,
  and version-archival calls all route through the Slice-1 `require*Access`
  helpers.
- **The S3 key is self-describing.** A stray prefix-delete on
  `orgs/<orgA>/` cannot touch another organization's evidence.

## Model

```
Document
  ├─ id
  ├─ caseId          → Case (tenant-scoped)
  ├─ name, type      (denormalized to current version)
  ├─ s3Key, sha256Hash, size, status  (denormalized — kept in sync)
  ├─ currentVersionId → DocumentVersion.id
  ├─ isArchived, archivedAt, archivedBy, archiveReason
  └─ versions[]      → DocumentVersion[]

DocumentVersion
  ├─ id
  ├─ documentId
  ├─ versionNumber   (1, 2, 3… unique per document)
  ├─ s3Key           orgs/<org>/cases/<case>/documents/<doc>/versions/<n>/<name>
  ├─ sha256Hash      per-version, hex
  ├─ sizeBytes       BigInt
  ├─ mimeType        detected via magic-byte sniff (not client-declared)
  ├─ originalName    filename as uploaded
  ├─ uploadedBy      userId (`system-backfill` for pre-migration rows)
  ├─ uploadedAt
  ├─ scanStatus      PENDING | SCANNING | CLEAN | INFECTED | ERROR
  ├─ scanReport
  ├─ scannedAt
  ├─ isArchived, archivedAt, archivedBy, archiveReason
```

The `Document` row's denormalized fields (`s3Key`, `sha256Hash`, `size`,
`type`) mirror the *current* non-archived version. Existing readers that
only need the latest file (e.g. `runFinancialExtraction`) continue to
work unchanged.

## Upload flow (`addDocument`)

1. **Tenant + role**: `requireCaseAccess(caseId, 'document:upload')`.
2. **Read the buffer** from the multipart body.
3. **Validate** (see the next section). Fails early — no S3 write.
4. **Compute SHA-256** of the exact buffer.
5. **Find-or-create the Document**. If a non-archived document with the
   same original filename already exists in this case, use it; else
   `INSERT` a new one.
6. **Assign next `versionNumber`** for that document.
7. **PUT** to `orgs/<org>/cases/<case>/documents/<doc>/versions/<n>/<name>`.
8. **INSERT** the `DocumentVersion` row.
9. **UPDATE** `Document.currentVersionId` (and the denormalized `s3Key`
   / `sha256Hash` / `size` / `type` / `status = 'VERIFIED'`).
10. **Optional mirror** to Microsoft Graph (Slice 3 encryption in effect).
11. **AuditLog**: `UPLOAD_DOCUMENT_VERSION` (always) + `UPLOAD_DOCUMENT`
    (only if the Document row was new).
12. **Fire-and-forget scan**: `scanner().scanAsync(versionId, buffer)`.
    The default `NullScanner` marks `CLEAN` immediately; a real scanner
    updates `scanStatus`/`scanReport`/`scannedAt` on its own timeline.

## Validation (`src/lib/documents/validation.ts`)

Every upload passes three checks before the S3 write:

| Check | Behavior |
|---|---|
| **Size**   | 1 byte ≤ size ≤ 100 MB. Empty and oversize both throw. |
| **Extension** | Must be in `ALLOWED_EXTENSIONS` (`pdf`, images, `xlsx/xls/csv`, `docx/doc`, `txt`). |
| **Magic bytes** | First bytes must match one of the signatures registered for the declared extension. `pdf` → `%PDF-`, `png` → `89 50 4E 47…`, `jpeg` → `FF D8 FF`, ZIP-based Office → `50 4B 03 04`, OLE compound → `D0 CF 11 E0…`. |
| **Zip-bomb defense** | Buffer starts with the ZIP local-header magic *and* the declared extension is not a legitimate ZIP container (`docx` / `xlsx`) ⇒ reject `DANGEROUS_ARCHIVE`. Prevents renamed zip bombs. |

The `detectedMime` returned by the validator is what's persisted; the
client-declared `file.type` is treated as advisory only.

## Downloads (`getVersionDownloadUrl`)

- Tenant-scoped via `requireDocumentVersionAccess(versionId, 'case:read')`.
- Refuses to sign if the version is archived.
- Refuses to sign if `scanStatus !== 'CLEAN'`.
- Returns a **pre-signed S3 URL** with a 5-minute TTL.
- Every issuance emits a `DOWNLOAD_DOCUMENT_VERSION` audit event
  including the version number and hash.

The UI opens the URL in a new tab; the browser downloads directly from
S3 (the app never proxies the bytes).

## Archival

Two levels:

- **Document-level** (`deleteDocument`) — hides the document from the
  case workspace. Every version becomes non-downloadable. Nothing is
  deleted from S3 or the DB.
- **Version-level** (`archiveDocumentVersion`) — hides a single version.
  If it was the current version, `currentVersionId` is repointed at the
  newest non-archived version (or nulled if none remain).

Both emit audit events (`ARCHIVE_DOCUMENT`, `ARCHIVE_DOCUMENT_VERSION`).
`restoreDocumentVersion` reverses the version-level archive.

## Malware scanning

- Interface: `src/lib/documents/scanner.ts::Scanner`.
- Default provider: `NullScanner` — synchronous, marks CLEAN immediately.
- Real providers (ClamAV socket, AWS Malware Protection, Cloudmersive)
  can replace it without touching a single caller. Their `scanAsync`
  runs on their own timeline; `DocumentVersion.scanStatus` is
  authoritative.
- `INFECTED` versions log a `MALWARE_SCAN_INFECTED` audit event and
  become non-downloadable.

## Migration (existing rows)

Slice 5 is purely additive. Every existing `Document` keeps its
`s3Key` / `sha256Hash` / `size` columns and remains readable through
its denormalized fields.

To promote existing documents to first-class versions:

```
# Apply the schema:
psql --file docs/migrations/slice-5-document-versioning.sql
# or:  npx prisma db push

# Backfill v1 rows:
npx tsx scripts/migrate-documents-to-versions.ts          # dry run
npx tsx scripts/migrate-documents-to-versions.ts --apply
```

The script:
- Creates a `DocumentVersion` v1 for every `Document` that has one
  populated `s3Key`/`sha256Hash` and no version yet.
- Copies the legacy S3 key as-is (does not move S3 objects).
- Sets `uploadedBy = 'system-backfill'` and grandfathers the scan
  status to `CLEAN` with a note.
- Updates `Document.currentVersionId`.
- Is idempotent — safe to re-run.

## Extension points (planned)

- **Real malware scanner** — replace `NullScanner`. Environment-driven
  factory in `scanner.ts` picks the provider.
- **Archival to Glacier** — a periodic ops job moves `isArchived`
  S3 objects to Glacier / Deep Archive. Metadata (hash, size) stays
  in MySQL and remains inspectable.
- **Hard-delete** — admin-only action with legal-hold check. Sets a
  new `hardDeletedAt` column, deletes S3 objects, retains the audit
  trail forever.
- **UI restore** — the version-history dialog currently lets analysts
  archive; a Restore button already lives in the server action but the
  UI toggle is deferred.
