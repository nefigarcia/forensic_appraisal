# Incident Response

## Roles

- **On-call engineer** — first responder. Triage + acknowledge.
- **Security lead** — decides communication scope. Signs off on
  post-mortem.
- **Legal counsel** — engaged for any suspected data exposure or
  legal-hold event.

## Severity classification

| Level | Definition | Response SLA |
|---|---|---|
| SEV-1 | Data exposure confirmed (any). Prolonged outage > 1 h. Audit chain tampering detected. | Immediate. |
| SEV-2 | Degraded service > 15 min. Failed authentication for a subset of users. Backup failure. | 30 minutes. |
| SEV-3 | Isolated bug affecting < 5 % of users. Non-blocking dep vuln. | Next business day. |

## Immediate steps by category

### Suspected data exposure (SEV-1)

1. Do NOT log the offending payload.
2. Preserve state — take a MySQL snapshot BEFORE any mitigation.
3. Revoke exposure surface:
   - Session compromise → `pruneExpiredRevocations` then bulk-write
     `SessionRevocation` for the impacted userIds.
   - Portal-link leak → mass-set `PortalAccess.revokedAt` for the
     affected `RequestList`.
   - OAuth token leak → deactivate the connector row (`status =
     DISCONNECTED`, clear `encryptedSecrets`).
4. Verify the Slice-6 audit chain with
   `scripts/verify-audit-chain.ts`. Confirm no tampering.
5. Notify legal within 1 hour.

### Audit chain tampering

1. Freeze writes to the affected `chainKey` if possible.
2. Run the verifier: `verifyAuditChain(chainKey)` — the first
   mismatched sequence is the earliest suspect row.
3. Preserve the current DB snapshot. Do not restore over it yet.
4. Restore the most recent pre-tamper snapshot to a shadow instance.
5. Compare row counts + hashes between shadow and prod for the
   window.
6. Report per SEV-1 timeline.

### Prolonged outage

1. Check health endpoints:
   - `/api/health`     → liveness.
   - `/api/health/ready` → readiness (db + s3 config).
2. Structured logger emits JSON to stdout; grep for
   `"level":"error"` in the aggregation service.
3. If DB is the bottleneck:
   - Verify pool size.
   - Check for a Prisma N+1 (see `PERFORMANCE_REVIEW.md`).
4. If S3 is the bottleneck:
   - Check throttling headers; consider batching or presigned-URL
     hand-off.

### Malware or infected upload

1. `DocumentVersion.scanStatus = INFECTED` should already refuse
   signed-URL downloads.
2. Confirm the row's `scanReport` field.
3. Notify the case owner via out-of-band channel.
4. Do NOT hard-delete the row — chain-of-custody requires the
   evidence trail.

### Rate-limit storm

1. Slice-2 rate limiter is per-`(email, ipAddress)`. A storm of
   `LOGIN_RATE_LIMITED` events without prior successful logins
   suggests credential stuffing.
2. Optionally raise the block interval by modifying
   `LOGIN_RATE_LIMIT` in `src/lib/auth/rate-limit.ts`.
3. If a single IP dominates, block at the reverse proxy — not in
   the app (avoids cache pollution).

### Dependency vulnerability

1. CI's `npm audit` job is advisory. Escalate `high` and `critical`
   only.
2. Read the advisory carefully — most are dev-only.
3. Patch: `npm update <pkg>` OR `npm audit fix` OR pin a safe
   version. Run the Vitest suite before merge.
4. Document the change in a slice report.

## Post-mortem template

Every SEV-1 requires a post-mortem within 5 business days. Sections:

1. **Timeline** — every action with timestamps.
2. **Root cause** — the one thing that, if fixed earlier, prevents
   this class.
3. **Blast radius** — how many orgs / users / cases affected.
4. **Detection** — how the incident was first noticed, and how it
   would ideally have been detected (metric, log alert).
5. **Response** — what worked; what didn't.
6. **Follow-ups** — concrete PRs / issues with owners and dates.
7. **User-facing communication** — record of what the affected orgs
   were told.

## Contacts (fill in per deploy)

- On-call rotation: `<rotation URL>`
- Security lead: `security@<domain>`
- Legal counsel: `<name / firm>`
- Cloud vendor support: `<AWS enterprise support #>`
