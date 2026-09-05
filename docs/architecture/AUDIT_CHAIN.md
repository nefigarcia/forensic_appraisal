# Audit Ledger — Tamper Evidence

Landed in Slice 6. Every write to `AuditLog` now joins an append-only
hash chain keyed by organization (or `global:anon` for events with no
discoverable org). This document describes what the chain gives us,
what it *does not* give us, the storage shape, and the verifier.

## What tamper-evidence means here

- The chain **detects** post-hoc modification of any row that has already
  been written into it. Change a note, a targetId, a previousHash, a
  createdAt, or delete a row entirely — all of these change the effective
  hashes and `verifyChain` reports the first invalid link.
- The chain **does not prevent** an operator with DB write access from
  rewriting the AuditLog table. That is a DB-role / permissions problem,
  not something the application layer can enforce.
- The chain **is not a blockchain**. There is no distributed consensus,
  no timestamping authority, no external notarization. It is a linked
  list of hashes computed inside one database.
- The chain **is not legal certification**. It provides forensic
  *evidence* of tampering; it does not itself certify that no tampering
  occurred. Combining this with periodic external timestamping (RFC
  3161) would give stronger non-repudiation — that is a future slice.

## Storage shape

`AuditLog` gained five nullable columns:

| Column | Type | Meaning |
|---|---|---|
| `chainKey`     | `VARCHAR(191)` | `org:<organizationId>` or `global:anon` |
| `sequence`     | `INT`          | 1-based monotonic within `chainKey` |
| `previousHash` | `VARCHAR(64)`  | SHA-256 hex of the prior row's `eventHash`, or `NULL` for the genesis row |
| `eventHash`    | `VARCHAR(64)`  | SHA-256 hex of the canonical payload (which includes `previousHash`) |
| `hashVersion`  | `VARCHAR(8)`   | `'v1'` — reserved for future format evolution |

Plus a `UNIQUE(chainKey, sequence)` index. That index provides the
concurrency guarantee — two racing writes can compute the same
`sequence`; the DB rejects the second, and the caller retries.

Pre-Slice-6 rows carry all five columns as `NULL`. The verifier calls
these "pre-chain" and skips them; the skip count is reported so users
can see how much of their history is verifiable.

## Canonical payload

Deterministic JSON, sorted keys, recursively. Full field list:

```
{
  "action":       "OVERRIDE_VALUE",
  "caseId":       "case-abc",
  "chainKey":     "org:org-xyz",
  "createdAt":    "2026-09-05T14:23:11.482Z",
  "hashVersion":  "v1",
  "id":           "a09fc1b4d6…",
  "ipAddress":    "1.2.3.4",
  "newValue":     "{\"value\":\"12345.6789\",\"reason\":\"corrected OCR\"}",
  "note":         null,
  "oldValue":     "{\"value\":12000}",
  "previousHash": "9a6…c2",
  "sequence":     1247,
  "targetId":     "fv-abc",
  "targetModel":  "FinancialValue",
  "userId":       "user-jane"
}
```

Rules:
- Keys always sorted alphabetically (recursively).
- `Date` → ISO string.
- Non-finite `Number` → `null`.
- `undefined` → `null` (indistinguishable — the DB can't hold `undefined`).
- `BigInt` → quoted string (stable numeric form).

The hash is `SHA-256(utf8(canonicalPayload))`, hex-encoded.

## Write path (`logAction`)

Every audit call now:
1. **Resolves the chain key.** Explicit `organizationId` wins; else
   `caseId → Case.organizationId`; else `userId → User.organizationId`;
   else `global:anon`.
2. **Opens a transaction.** Reads the tail (`ORDER BY sequence DESC LIMIT 1`).
3. **Computes** `sequence = tail.sequence + 1`, `previousHash = tail.eventHash`.
4. **Generates** a fresh `id` and a `createdAt` timestamp.
5. **Hashes** the canonical payload including `previousHash`.
6. **INSERTs** the row inside the transaction.
7. **On P2002** (race on `(chainKey, sequence)`), rolls back and retries
   up to two more times.

Under the retry ceiling, we fall back to an **unchained** insert so the
event isn't lost. The verifier reports these as "pre-chain skipped" —
a real ops incident, visible in the badge.

## Verifier

`src/lib/audit-chain.ts::verifyChainRows(chainKey, rows)`:

```ts
{
  ok: boolean
  chainKey: string
  eventsChecked: number
  eventsSkipped: number
  firstBadSequence?: number
  firstBadEventId?: string
  reason?: 'PREVIOUS_HASH_MISMATCH' | 'EVENT_HASH_MISMATCH' | 'MISSING_HASH_FIELDS'
  message?: string
}
```

For each row in `sequence` order:
1. If `previousHash !== expectedPrevious` → fail with
   `PREVIOUS_HASH_MISMATCH`.
2. Re-canonicalize + re-hash the row. If it doesn't match `eventHash`
   → fail with `EVENT_HASH_MISMATCH`.
3. Set `expectedPrevious = row.eventHash`.

Non-chained rows are filtered out and reported as `eventsSkipped`.

## Server actions

- `verifyOrganizationAuditChain()` — signed-in caller, requires the
  existing `audit:read` permission. Verifies `org:<callerOrg>`.
- `verifyAnonymousAuditChain()` — ADMIN-only. Verifies `global:anon`.

Both use a strict `select` so `oldValue` / `newValue` reach the verifier
in the same shape the writer used, avoiding accidental JSON re-formatting.

## UI

`src/components/audit-integrity-badge.tsx` — a small card that:
- Runs `verifyOrganizationAuditChain` on mount and shows Verified /
  Failed with the first bad sequence + reason code.
- Includes a manual re-verify button.
- Reports `eventsChecked` and `eventsSkipped` explicitly. No overclaiming.

Wired into the projects workspace above the case's audit log panel.

## Immutability discipline

The chain gives us tamper *evidence*, not tamper *prevention*. To keep
the "app layer never edits" promise:

- No server action anywhere calls `prisma.auditLog.update(...)` or
  `prisma.auditLog.delete(...)`. This is enforced by a repo-shape test
  in `tests/smoke/repo-shape.test.ts`.
- The verifier is idempotent and side-effect-free.
- The write path is the *only* mutation path.

For a production deployment we recommend:
- A dedicated DB user for the application with `INSERT`-only privilege
  on `AuditLog` (and `SELECT`, of course). No `UPDATE`, no `DELETE`.
- A separate audit-viewer DB user with `SELECT` only.
- Regular external anchoring of chain tips (RFC 3161 timestamp,
  transparency log, etc.) — this is a future slice.

## What events end up on the chain

Every existing `logAction` caller now writes chained events:

- Documents: `UPLOAD_DOCUMENT`, `UPLOAD_DOCUMENT_VERSION`,
  `DOWNLOAD_DOCUMENT_VERSION`, `ARCHIVE_DOCUMENT`,
  `ARCHIVE_DOCUMENT_VERSION`, `RESTORE_DOCUMENT_VERSION`,
  `MALWARE_SCAN_INFECTED`.
- Extraction & TTM: `RUN_EXTRACTION`, `RUN_TTM_NORMALIZATION`.
- Financial values: `ACCEPT_VALUE`, `OVERRIDE_VALUE`, `REJECT_VALUE`,
  `LOCK_VALUE`, `UNLOCK_VALUE`, `APPROVE_BATCH`.
- Add-backs: `CREATE_ADDBACK`, `UPDATE_ADDBACK`, `APPROVE_ADDBACK`,
  `UNAPPROVE_ADDBACK`, `DELETE_ADDBACK`.
- Model assumptions & reconciliation: `SAVE_VALUATION`.
- Review decisions: `ACCEPT_VALUE` / `REJECT_VALUE` / `APPROVE_BATCH`
  (also cover reviewer intent).
- Reports & analysis: `GENERATE_REPORT`, `RUN_ANOMALY_DETECTION`,
  `RESOLVE_FLAG`, `RUN_INDUSTRY_ANALYSIS`.
- Connectors (auth-secured): `saveOAuthToken` calls emit through the
  connector server action; the chain covers any future connector events
  once they route through `logAction`.
- Security events: `LOGIN_SUCCESS`, `LOGIN_FAIL`, `LOGIN_RATE_LIMITED`,
  `LOGOUT`, `PASSWORD_CHANGED`, `PASSWORD_RESET_*`, `EMAIL_VERIFIED`,
  `SIGNUP`.

The chain-key resolution rule ensures each event lands on the right
chain: `LOGIN_FAIL` for an unknown email → `global:anon`; every other
auth event → the actor's org chain.

## Follow-up work (not in Slice 6)

- RFC-3161 timestamping of the chain tip on a schedule. Adds external
  non-repudiation without changing the on-write path.
- Merkle-tree indexing for O(log n) subrange proofs. Enables "prove
  event #42 belongs to this chain without shipping the whole log".
- Cryptographic sealing of `oldValue` / `newValue` payloads for
  sensitive fields (Slice 3-style envelope encryption on top of the
  chain).
- Dedicated per-org "chain tip" table so verifiers don't have to walk
  the whole chain to know the current head hash.
