# Backup and Recovery

## Retention matrix

| Data                            | Retention          | Notes |
|---|---|---|
| `Case` and downstream tables    | Duration of engagement + 7 years | Legal-hold override extends. |
| `DocumentVersion` + S3 objects  | Same as above      | Slice-5 archival preserves the row after soft-delete. |
| `AuditLog` chain                | 7 years (min)      | Slice-6 hash chain must not be pruned mid-window. |
| `AiExecution`                   | 7 years            | Load-bearing for material-fact traceability. |
| `AiCaseSearchRun`               | 3 years            | Includes returned caseIds for leakage audit. |
| `LoginAttempt`                  | 1 year             | Rate-limit + anomaly detection. |
| `SessionRevocation`             | Original JWT TTL + 30 days | Pruning schedule via `pruneExpiredRevocations`. |
| `PortalAccess`, `RequestList`   | Duration of engagement | Portal tokens expire in 30 days by default. |
| `LoginAttempt` (rejected)       | 90 days            | |

## Backup schedule

- **Database (MySQL)** — automated daily snapshot, weekly full
  export to encrypted S3 (SSE-KMS with a KEK distinct from the
  runtime KEK). 30-day snapshot retention; 12-month weekly retention.
- **S3 evidence bucket** — versioning ON, MFA-delete on the bucket
  policy. Cross-region replication to a secondary region with a
  90-day retention window.
- **KMS keys** — automatic rotation on. `encryptionKeyVersion`
  column on `ExternalConnector` / `AccountingConnector` records the
  KEK used at write; a rotation query updates rows to the new KEK
  without downtime.

## Restore procedure

Assume a database catastrophe requiring restoration from snapshot.

1. **Freeze writes** — pause the load balancer or scale the app to
   zero. Any in-flight actions crash cleanly (they cannot corrupt
   downstream data — every mutation is transactional).
2. **Restore MySQL** — provision a fresh instance from the target
   snapshot. Update `DATABASE_URL` to point at the new instance.
3. **Reconcile S3** — S3 versioning survives a DB-only outage.
   No S3 restore needed unless the incident involved the bucket.
4. **Verify audit chain** — before allowing writes, run the chain
   verifier against every `chainKey`:
   ```
   npx tsx scripts/verify-audit-chain.ts
   ```
   Any mismatch means the DB restore missed rows; DO NOT open
   traffic. Escalate per [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
5. **Verify Slice-14 report snapshots** — `ReportVersion.factsHash`
   should still match the pinned `factsSnapshot`. Mismatch = restore
   was inconsistent between related tables.
6. **Re-open traffic** — restore the load balancer. Health probes
   should turn green within 30 s.

Target RPO: 24 hours. Target RTO: 4 hours.

## Deletion pathways

- **Soft delete** — `Document.isArchived = true`. Row + S3 object
  retained.
- **Portal invite revocation** — flip `PortalAccess.revokedAt`.
  Token becomes inert but the row is retained for audit.
- **Tenant offboarding** — see [TENANT_MODEL.md](TENANT_MODEL.md).
- **Legal-hold override** — no user-facing UI. DBA cascades via
  organization delete; audit copy of the deletion is retained.

## Evidence preservation during litigation

The Slice-6 audit chain is the load-bearing artifact. When a matter
enters litigation:

1. Freeze the case: `UPDATE Case SET status = 'CLOSED', updatedAt =
   NOW()`.
2. Export the case's full audit chain to a separate legal-hold
   bucket.
3. Verify the chain BEFORE and AFTER the export. Both must match.
4. Deny any admin action on the case rows until the matter is
   released — an out-of-band ACL, not a UI change.

## Restore validation checklist

After every restore:

- [ ] Chain verifier passes on every `chainKey`.
- [ ] `SELECT COUNT(*)` reconciles with the snapshot manifest.
- [ ] `Report.currentVersionId` FK integrity holds (no orphaned
      pointers).
- [ ] `Document.currentVersionId` FK integrity holds.
- [ ] `AiExecution.status = 'SUCCESS'` outnumbers RUNNING+FAILURE
      by a normal margin (a huge RUNNING count means the wrapper's
      completion write did not land).
- [ ] Sample 20 random `AuditLog` rows across three orgs; verify
      `eventHash` recomputes.
