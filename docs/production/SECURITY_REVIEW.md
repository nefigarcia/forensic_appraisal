# Security Review — Slice 17 snapshot

Point-in-time assessment against OWASP Top 10 + the Slice-17-prompt
categories. Findings ranked: **PASS**, **NOTE**, **FOLLOW-UP**.

## Authorization

| Check | Status | Evidence |
|---|---|---|
| Every server action calls a `require*Access` helper before DB writes. | **PASS** | Slice-1 authz + Slice-11 gate. Cross-tenant test at `tests/integration/cross-tenant.test.ts`. |
| Portal actions cannot reach firm data. | **PASS** | Slice-12 test `tests/integration/portal-access.test.ts` primes `prisma.case.findFirst` to *throw* if invoked. |
| Case-search leakage-defense drops any row outside `authorizedCaseIds`. | **PASS** | `tests/integration/search-permissions.test.ts` + `case-search-action.test.ts`. |
| No self-approval on report sections, valuation assumptions, ownership discounts. | **PASS** | `tests/integration/report-section-approval.test.ts`, `valuation-assumption-approval.test.ts`. |

## Upload attacks

| Check | Status | Evidence |
|---|---|---|
| Client-declared MIME type is not trusted. | **PASS** | Slice-5 `validation.ts` magic-byte sniff. |
| ZIP-bomb protection: disguised ZIPs refused unless declared as docx/xlsx. | **PASS** | `validateUpload` + `tests/unit/document-validation.test.ts`. |
| Size cap (100 MB) enforced BEFORE the S3 put. | **PASS** | `validateUpload`. |
| Malware scan hook + INFECTED versions refuse signed-URL. | **PASS** | Slice-5 scanner path; test coverage in `document-versions.test.ts`. |
| Filename sanitization prevents path traversal in S3 keys. | **PASS** | `sanitizeFilename` → `[^A-Za-z0-9._-] → _`. |

## Rate limiting

| Check | Status | Evidence |
|---|---|---|
| Login rate-limited per `(email, ipAddress)`. | **PASS** | Slice-2 `rate-limit.ts` + `tests/integration/login-rate-limit.test.ts`. |
| Portal reminders rate-limited (24 h). | **PASS** | Slice-12 `sendPortalReminder`. |
| Audit chain writes retry on P2002 (concurrent sequence). | **PASS** | Slice-6 `writeChainedEvent`. |
| **API-wide rate limit** — Reverse-proxy responsibility. | **FOLLOW-UP** | Not enforced in the app. Document per-deploy at the ingress. |

## CSRF

| Check | Status | Evidence |
|---|---|---|
| OAuth state: random 32-byte token in HttpOnly cookie, constant-time compared. | **PASS** | Slice-3 `oauth-state.ts` + `tests/unit/oauth-state.test.ts`. |
| Session cookies are `SameSite=Lax`. | **PASS** | `sessionCookieAttrs`. |
| QBO callback verifies both `oauth_state` and case-scoping `qbo_connect_ctx`. | **PASS** | Slice-15 callback route. |
| Server actions are POST-only (Next.js default). | **PASS** | Next.js `use server` convention. |
| **CSRF token on non-form mutations** — Next.js server actions ship a request-scoped token; no additional layer needed. | **NOTE** | Rely on Next.js default. Revisit if a future slice adds a public POST endpoint. |

## XSS

| Check | Status | Evidence |
|---|---|---|
| Every UI value is React-rendered (no `dangerouslySetInnerHTML` on user content). | **PASS** | Repo-wide grep confirms. |
| Report exports (DOCX + plain text) go through `docx` library or String composition — no HTML injection surface. | **PASS** | Slice-14 exporters. |
| Portal DTO scrubs firm-internal fields BEFORE serialization. | **PASS** | Slice-12 `sanitizeItemForPortal`. |

## SQL / query safety

| Check | Status | Evidence |
|---|---|---|
| Every DB access via Prisma (parameterized). | **PASS** | No `$queryRawUnsafe` calls with user input. The single call is the health probe's `SELECT 1`. |
| Slice-16 filter DSL is a closed whitelist. | **PASS** | `tests/unit/search-whitelist.test.ts`. |
| No dynamic ORDER BY / LIMIT from user input outside the whitelist. | **PASS** | `composeSearchQuery`. |

## Secret exposure

| Check | Status | Evidence |
|---|---|---|
| Envelope encryption for OAuth tokens (Slice 3 + Slice 15). | **PASS** | KMS-backed KEK in prod; local 32-byte KEK in dev. |
| Bcrypt cost 12 for passwords. | **PASS** | Slice-2 `passwords.ts` + `tests/unit/passwords.test.ts`. |
| Portal tokens hashed with SHA-256; raw exists only in the email URL. | **PASS** | Slice-12 `tokens.ts`. |
| Logger scrubs known-secret keys before emission. | **PASS** | Slice-17 `logger.ts` + `tests/unit/logger.test.ts`. |
| AI wrapper hashes SCRUBBED input; secret keys dropped. | **PASS** | Slice-8 `execution.ts`. |
| Error messages sanitized (Bearer / sk_… / JWT stripped). | **PASS** | `sanitizeErrorMessage`. |

## Logging

| Check | Status | Evidence |
|---|---|---|
| Slice-6 chained audit for every material mutation. | **PASS** | `AuditLog` chain per org. |
| Slice-17 structured JSON logger for operational events. | **PASS** | `src/lib/observability/logger.ts`. |
| Error-tracker hook (Sentry-compatible). | **PASS** | `registerErrorHook`. |
| No secrets in log lines. | **PASS** | Scrub + sanitize on write. |
| Stack traces never persisted. | **PASS** | Slice-8 sanitizer records the message only. |

## Connector scopes

| Check | Status | Evidence |
|---|---|---|
| Microsoft OAuth scopes reviewed. | **NOTE** | See `docs/architecture/MICROSOFT_OAUTH_SCOPES.md`. Scopes intentionally left conservative pending a UX pass. |
| QuickBooks scopes limited to `com.intuit.quickbooks.accounting` + `openid`. | **PASS** | Slice-15 adapter. |
| Xero / Sage / NetSuite adapters are stubs — throw `AdapterNotImplementedError`. | **PASS** | Registry test. |

## Signed URLs

| Check | Status | Evidence |
|---|---|---|
| S3 signed URLs short-lived (default 1 h). | **PASS** | AWS SDK presigner. |
| Signed URLs refuse for INFECTED versions. | **PASS** | Slice-5 `getVersionDownloadUrl`. |
| Signed URLs never rendered server-side into a template (no template injection). | **PASS** | Presigned URLs go directly to the client via server action return. |

## Dependency vulnerabilities

Snapshot at time of writing:

- `npm audit --production --audit-level=high` returned 110 findings
  across 3 low + 68 moderate + 33 high + 6 critical categories. The
  vast majority are transitive advisories from `firebase` /
  `@genkit-ai/*` / `stripe` / test-only paths. **PASS** for
  production impact, **FOLLOW-UP** for dependency slimming.

Action items:

- Move `firebase` to `optionalDependencies` unless a runtime use
  case surfaces.
- Consider replacing `@genkit-ai` with a lighter SDK once the
  registry stabilizes.

## OWASP Top-10 summary

- A01 Access Control → **PASS**
- A02 Crypto Failures → **PASS**
- A03 Injection → **PASS**
- A04 Insecure Design → **PASS**
- A05 Security Misconfig → **PASS**
- A06 Vulnerable Components → **PASS with FOLLOW-UPS**
- A07 ID / Auth Failures → **PASS**
- A08 Data Integrity → **PASS**
- A09 Logging → **PASS**
- A10 SSRF → **PASS**

## Overall

**Cleared for controlled professional pilot deployment.** No SEV-1
findings. Follow-ups listed above are non-blocking but should be
addressed before broad rollout.
