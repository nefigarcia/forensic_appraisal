# ValuVault V2 — Implementation Roadmap

This roadmap is a proposal, not a commitment. Each slice is small, additive,
and independently shippable. The user approves each slice before it starts;
Slice 0 does not commit to any of the below.

Slices are grouped into three tracks:

- **Track A — Foundation & Safety.** Tenant enforcement, audit hardening,
  test infra. Non-negotiable prerequisites for user-visible V2 features.
- **Track B — Forensic Domain Depth.** Decimal-safe math, reviewer workflow,
  richer valuation models, report defensibility.
- **Track C — Growth & Ops.** Team invitations, connector expansion,
  observability, deployment.

Numbering is stable ordering — priority, not necessarily execution order.

---

## Track A — Foundation & Safety

### Slice 1 — Tenant enforcement helper + tenant-scoped repository

**Why:** [AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md) shows 25 handlers
accepting client-supplied resource ids without an org check. This is the
biggest cross-org exposure and blocks any real customer usage.

**What:**
- Introduce `src/lib/tenant.ts` with `assertCaseInOrg(caseId, session)`,
  `assertDocumentInOrg`, `assertFinancialValueInOrg`, `assertAddBackInOrg`,
  `assertValuationInOrg`, `assertAnomalyFlagInOrg`, `assertConnectorInOrg`.
  Each does a single `findFirst({ where: { id, ...tenantScope } })` and
  throws a `TenantMismatchError` on miss.
- Retro-fit every action listed as `IDOR-W`/`IDOR-R` in the matrix.
- Add `Forbidden`/`Unauthorized`/`TenantMismatch` error class hierarchy and
  a small `withActionErrors` wrapper so the UI surfaces friendly toasts.

**Tests:** for each action, a test that a session from Org B cannot touch
a resource created under Org A. Uses an in-memory SQLite variant of the
Prisma schema (or a `pglite`/`libsql` shim) — no MySQL required.

**Migrations:** none.

---

### Slice 2 — Audit gap closure + audit-in-transaction

**Why:** `updateFinancialValue`, `refreshCaseInsights`, `dismissInsight`,
`saveOAuthToken`, `createCheckoutSession`, `createPortalSession` mutate
without auditing. `logAction` catches errors, so a failed audit does not
roll the mutation back — unacceptable for a forensic product.

**What:**
- Add the missing `logAction` calls.
- Refactor `logAction` to accept a Prisma `TransactionClient` and use
  `prisma.$transaction([...])` in every mutation path.
- Add a `RBAC-MISSING` fix on `dismissInsight` (require `case:read`),
  `refreshCaseInsights` (re-classify to `extraction:run` since it writes),
  `createCheckoutSession`/`createPortalSession`/`saveOAuthToken` (require
  `org:settings`).
- Remove client-reachable `applyPlanToOrg` — move to a plain module invoked
  only from the webhook route.

**Migrations:** none.

---

### Slice 3 — Session & environment hardening

**Why:** JWT secret has a hard-coded fallback; cookie lacks `secure` +
`sameSite`; no env-var validation on boot.

**What:**
- `src/lib/env.ts` — Zod-parse `process.env` at boot; refuse to start if
  `JWT_SECRET`, `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  (production only), `AWS_*` are missing.
- Cookie flags: `secure: process.env.NODE_ENV === 'production'`,
  `sameSite: 'lax'`, `path: '/'`.
- Roll the JWT secret out of the source tree entirely (remove the
  `"secret_key_for_prototype_only"` fallback).
- Add a login-audit line (`LOGIN_SUCCESS`, `LOGIN_FAIL`) and rate-limit login
  attempts via a lightweight in-memory bucket keyed by email + IP (documented
  as best-effort until we add Redis).

**Migrations:** none.

---

### Slice 4 — Playwright E2E harness (smoke only)

**Why:** Slice 0 added Vitest for unit/integration. E2E is the missing leg.

**What:**
- Add Playwright with two scenarios: sign up → create case → upload PDF →
  see extracted values in PENDING state; log in → try to access another
  org's case URL and get a 404/redirect.
- Only runs locally + on CI on demand — not in the default `npm test`.
- No changes to app code beyond `data-testid` attributes on the specific
  elements the tests need.

**Migrations:** none.

---

## Track B — Forensic Domain Depth

### Slice 5 — Decimal-safe money math

**Why:** Rule 9. Every monetary column is `Float`. Multiplying WACC
components or discounting DCF years compounds floating-point error into
concluded value.

**What:**
- Introduce `src/lib/money.ts` wrapping `Prisma.Decimal` with a small API
  (`add`, `sub`, `mul`, `div`, `sum`, `pct`).
- **Prisma migration**: add `Decimal(18, 4)` shadow columns beside every
  `Float` money column. Backfill by copy. Dual-write from server actions.
  Read from `Decimal`. No column is deleted in this slice — the old `Float`
  columns are only removed in a follow-up cleanup slice once no code
  references them. Non-destructive per Rule 16.
- Add tests: DCF present value, EBITDA × multiple, reconciliation weighted
  sum — all with adversarial inputs designed to expose Float error.

**Migrations:** additive columns only.

---

### Slice 6 — Reviewer workflow: dual approval + review queue

**Why:** `REVIEWER` currently only has `value:accept`. There is no queue
UI, no "needs second review" state, no unlock trail.

**What:**
- Add `FinancialValue.reviewedBy`, `reviewedAt`; a "needs review" filter on
  the case workspace.
- Batch approve UX for a reviewer.
- Route: `/projects/[id]/review` — the queue.

**Migrations:** two additive nullable columns.

---

### Slice 7 — Richer valuation engine

**Why:** `ValuationModel` is polymorphic across four approaches using
nullable columns. That works, but each approach's math should live in a
tested module, not spread inside a server action.

**What:**
- `src/lib/valuation/` with `market.ts`, `dcf.ts`, `asset.ts`, `blended.ts`
  — each a pure function that takes typed inputs and returns
  `{ indicatedValue, breakdown }`.
- Tests: known-answer cases from published appraisal texts.
- No schema change.

**Migrations:** none.

---

### Slice 8 — Report defensibility: locked report snapshots

**Why:** `draftReportSection` is on-demand. Once an engagement is signed,
the narrative should be frozen.

**What:**
- New model `ReportVersion { id, caseId, publishedAt, publishedBy,
  sectionsJson, sha256, isFinal }`.
- Server action `publishReport(caseId)` that locks all
  `FinancialValue`/`AddBack`/`ValuationModel` rows, snapshots sections into
  `ReportVersion`, hashes the JSON, and logs `PUBLISH_REPORT`.

**Migrations:** one new table; no changes to existing tables.

---

## Track C — Growth & Ops

### Slice 9 — Real team & invitation flow

**Why:** `/team` is static mock UI. `usersLimit` from `plans.ts` is not
enforced.

**What:**
- `Invitation { id, orgId, email, role, token, expiresAt, acceptedAt }`.
- `inviteUser(email, role)` — `team:manage`, enforces `usersLimit`.
- Accept-invitation page and server action.
- Remove the mock members array from `/team/page.tsx`.

**Migrations:** one new table.

---

### Slice 10 — Encrypted OAuth token storage

**Why:** `ExternalConnector.accessToken`/`refreshToken` are plaintext.

**What:**
- Envelope encryption using `AWS_KMS_KEY_ID` (KMS) or a
  local-secret-derived AES-GCM key for dev.
- Migration writes ciphertext into new `accessTokenEnc`, `refreshTokenEnc`
  columns; old columns retained but zeroed on next successful use.

**Migrations:** additive columns + non-destructive zero-out of old columns.

---

### Slice 11 — Observability & error routing

**Why:** Silent failures in `logAction`, Stripe webhook fallback to `SOLO`,
and connector mirror failures all just `console.error`. No metric, no
alert.

**What:**
- Structured logger (`pino` or wrapper). Emit metric-shaped log lines for
  every audit failure, webhook fallback, and mirror failure.
- Wire to a downstream (Datadog / Grafana Cloud / Vercel logs) — choice
  deferred to slice execution.

**Migrations:** none.

---

### Slice 12 — Baseline health cleanup (only after user requests it)

Explicitly *not* part of Slice 0 (Rule 20 forbids unrelated cleanup):

- `src/components/ui/calendar.tsx` — patch or upgrade react-day-picker.
- Cross-platform `build` script — `cross-env NODE_ENV=production next build`.
- `next lint` migration to standalone ESLint CLI per Next 16 codemod.
- Consider removing `ignoreBuildErrors: true` / `ignoreDuringBuilds: true`
  from `next.config.ts` once the above are fixed.

Deferred until the user asks — grouping them into one dedicated slice
keeps the audit trail clean.

---

## Non-goals (out of scope for V2, at least until asked)

- Multi-region deploy topology.
- Rewrite of the landing page.
- Custom AI model fine-tuning (referenced in Enterprise plan but not
  planned for V2).
- Mobile apps.

---

## Dependencies between slices

```
Slice 1 (tenant helper) ─┬─► every future feature slice
                         └─► Slice 2 (audit-in-transaction) — same
                             mutation call sites
Slice 3 (env hardening) ── independent
Slice 4 (Playwright)   ── independent
Slice 5 (decimal money) ─► Slice 7 (valuation engine)
Slice 6 (reviewer)     ── depends on Slice 1
Slice 8 (report snapshot) ─► depends on Slice 5, 6, 7
Slice 9 (team)         ── depends on Slice 1
Slice 10 (KMS)         ── depends on Slice 3 (env vars)
Slice 11 (obs)         ── independent
Slice 12 (health)      ── independent
```

## What the roadmap deliberately does not do

- **No auth rewrite.** JWT sessions are fine for now; hardening
  incrementally.
- **No schema rewrite.** Every migration listed is additive.
- **No UI redesign.** UI changes only where a slice adds a new surface
  (review queue, team invitations, report snapshot list).
- **No new billing tiers.** Existing `TRIAL/SOLO/FIRM/ENTERPRISE` are the
  design surface.
