# Security Model

The Slice-17 consolidated reference for how ValuVault enforces
authentication, authorization, secret protection, and evidence
integrity.

## Authentication (Slice 2)

- Password: bcrypt cost 12 with rehash-on-login for legacy hashes.
- Session: JWT via `jose` (HS256) signed by `JWT_SECRET`. The env
  parser (Slice 2) requires `JWT_SECRET` ≥ 32 chars in production
  and fails closed on missing/short values.
- Session revocation: per-token `jti` written to `SessionRevocation`.
  `getSession()` fails-closed on unreachable revocation store.
- Password-change invalidation: `getSession()` compares JWT `iat`
  against `User.passwordChangedAt`; older tokens are rejected.
- Rate limiting: `LoginAttempt` per `(email, ipAddress)`, with an
  audit trail entry for rate-limited attempts (`LOGIN_RATE_LIMITED`).
- MFA: TOTP + one-time backup codes, backup codes single-use with
  SHA-256 hashing.

## Authorization

Every server action routes through one of the Slice-1
`require*Access` helpers. The pattern is:

```
session → tenant → engagement gate → RBAC permission
```

Bypass surfaces:

- **Portal (Slice 12)**  — `resolvePortalAccess(rawToken)` grants a
  narrow, per-invitation capability scoped to a single
  `RequestList`. Portal actions never call `requireCaseAccess`.
- **Public API** — only `/api/health` and `/api/health/ready`.

## Tenant boundaries

- Every `Case`, `Document`, `FinancialValue`, and downstream row
  carries an `organizationId` (directly or via a parent).
- The Slice-1 helpers query with `where: { … organizationId: session.organizationId }`
  so a cross-tenant read collapses to `NotFoundError` —
  indistinguishable from a non-existent row (anti-enumeration).

## Engagement gate (Slice 11)

- `Case.hasEngagementTeam` is a monotonic bool: false → true on the
  first CaseMember; never flips back.
- With the gate on, only ADMINs and active CaseMembers reach the
  case. Removed members surface as `NotFoundError`.

## Evidence integrity (Slice 5 + Slice 6)

- **DocumentVersion** — immutable per-upload row. `s3Key` /
  `sha256Hash` are pinned; the `Document` row denormalizes the
  current version pointer.
- **Malware scan** — `scanStatus` starts PENDING; INFECTED versions
  refuse signed-URL generation.
- **Audit chain (Slice 6)** — every mutation writes an `AuditLog`
  event on a per-organization SHA-256 hash chain (`chainKey +
  sequence + previousHash + eventHash`). Application code cannot
  update or delete `AuditLog` rows (asserted by the smoke test).
  Manual DB edits are detected by the chain verifier.

## Secret storage

- **Passwords** — bcrypt cost 12.
- **JWT** — signed with `JWT_SECRET`, never persisted client-side
  except as an HttpOnly cookie with `SameSite=Lax`, `Secure` in
  production.
- **OAuth tokens (Slice 3, Slice 15)** — envelope-encrypted:
  `AES-256-GCM` payload wrapped by a KMS-backed KEK (production) or
  a 32-byte local KEK (dev). `encryptionKeyVersion` records the KEK
  used, so rotation queries can find rows keyed to an old KEK.
- **Portal invite tokens (Slice 12)** — `randomBytes(32).base64url`.
  Only `SHA-256(rawToken)` is stored. Raw exists only in the
  outgoing email URL.
- **Password reset / email verify tokens (Slice 2)** — same pattern.

## Cookies

All app cookies are:

- `HttpOnly` — no JS access.
- `SameSite=Lax` — CSRF defense while permitting cross-site links.
- `Secure` in production — served over TLS only.
- `Path=/` — cross-route valid.

Explicit cookies:

- `pv_session`         — session JWT (7-day TTL).
- `oauth_state`        — 10-min OAuth CSRF token.
- `qbo_connect_ctx`    — 10-min case-scoping ctx for QBO OAuth.

## OWASP Top-10 posture

| Category | Enforcement |
|---|---|
| A01 Broken Access Control      | Slice-1 `require*Access` helpers + Slice-11 gate + defense-in-depth Slice-16 `filterResultsToAuthorized`. |
| A02 Cryptographic Failures     | Slice-3 envelope encryption + no plaintext token storage + bcrypt cost 12. |
| A03 Injection                  | Every DB access via Prisma (parameterized). Filter DSL closed whitelist (Slice 16). |
| A04 Insecure Design            | Explicit approve → immutable → snapshot pattern across Slice-5/6/7/13/14. |
| A05 Security Misconfiguration  | Fail-closed env parser (Slice 2). Health checks refuse to serve without required env in prod. |
| A06 Vulnerable Components      | `npm audit` in CI (advisory). Docs on how to escalate. |
| A07 ID / Auth Failures         | Session revocation + password-changed-at + MFA + rate limit. |
| A08 Software / Data Integrity  | Slice-5 SHA-256 per version + Slice-6 tamper-evident audit chain. |
| A09 Logging & Monitoring       | Slice-6 chain + Slice-17 structured logger + health endpoints. |
| A10 SSRF                       | No user-controlled outbound URL fetching. All external URLs (OAuth authorize, S3, Genkit) are code-configured. |

## Signed URLs

- S3 signed URLs use the AWS SDK v3 presigner with a **short TTL**
  (default 1 hour). Sessions with the signed URL have S3 permission
  only for that key.
- Signed URLs refuse to issue for INFECTED versions (Slice 5).

## Dependency policy

- `npm audit --production --audit-level=high` runs in CI as an
  advisory job. See `docs/production/SECURITY_REVIEW.md` for the
  Slice-17 snapshot.
- Slice 4 dep pin: `@types/node@20` — do not upgrade past Node 20 in
  CI without validating Vitest 2.x compatibility.

## Reporting

Security reports: `security@<domain>` (configure at deploy time).
Response SLA: 24 h acknowledge, 7-day remediation for high-severity.
See [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
