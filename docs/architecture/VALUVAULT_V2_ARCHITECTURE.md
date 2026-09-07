# ValuVault V2 — Baseline Architecture

Snapshot taken during **Slice 0** (production baseline audit). All facts below
are grounded in the code as it stands **before any V2 changes**. If a future
slice contradicts something here, the slice report must call it out and this
document must be updated in that slice.

---

## 1. Stack

| Layer                | Choice                                                     |
| -------------------- | ---------------------------------------------------------- |
| Framework            | Next.js 15.5.9 (App Router, Turbopack dev)                 |
| Runtime              | Node.js                                                    |
| UI                   | React 19, Radix UI + ShadCN components, Tailwind 3         |
| Language             | TypeScript 5 (`strict: true` in `tsconfig.json`)           |
| Data                 | MySQL via Prisma 5                                         |
| Object storage       | AWS S3 (`@aws-sdk/client-s3`)                              |
| Auth                 | Bespoke JWT session cookie via `jose`; bcryptjs password hash |
| AI                   | Genkit + `googleai/gemini-2.5-flash`                       |
| Billing              | Stripe (subscriptions + billing portal + webhooks)         |
| External connectors  | Microsoft Graph (OAuth 2 code grant)                       |
| Analytics            | `@vercel/analytics`                                        |
| Spreadsheet export   | `exceljs`, `xlsx`                                          |
| Landing animations   | GSAP, Lenis                                                |

`next.config.ts` sets **`typescript.ignoreBuildErrors: true`** and
**`eslint.ignoreDuringBuilds: true`** — production builds pass even when
`tsc` fails. Type/lint safety must be enforced by the `typecheck`/`lint`
scripts, not by the build.

## 2. Directory map (files, not folders)

```
src/
  middleware.ts                # session gate for non-public routes
  ai/
    genkit.ts                  # Genkit + Gemini client
    dev.ts                     # local Genkit dev entrypoint
    flows/                     # 7 AI flows, all "use server"
  lib/
    prisma.ts                  # Prisma singleton (query-logged)
    auth-utils.ts              # encrypt/decrypt/getSession/updateSession
    rbac.ts                    # Role + Permission + guardAction
    audit.ts                   # logAction — write-only chain of custody
    plans.ts                   # PLANS registry + limit helpers
    stripe.ts                  # Stripe client + webhook secret
    s3-client.ts               # S3Client + BUCKET_NAME
    utils.ts                   # cn() tailwind helper
    placeholder-images.{ts,json}
  app/
    layout.tsx                 # root layout
    page.tsx                   # marketing / landing
    globals.css
    login/, signup/            # auth pages
    dashboard/                 # signed-in home
    projects/                  # case list + /projects/[id] workspace + valuation subpage
    connections/, knowledge-base/, search/, settings/, team/  # supporting pages
    actions/                   # ALL mutations are server actions here
      auth.ts, cases.ts, documents.ts, addback-actions.ts,
      ai-actions.ts, billing-actions.ts, connectors.ts
    api/
      auth/logout/route.ts
      connect/microsoft/route.ts
      connect/microsoft/callback/route.ts
      webhooks/stripe/route.ts
  components/
    app-sidebar.tsx, add-back-schedule.tsx, ai-thinking-dialog.tsx,
    audit-log-panel.tsx, confidence-badge.tsx, override-dialog.tsx,
    ui/                        # ShadCN primitives (unmodified)
prisma/
  schema.prisma
```

## 3. Domain model (Prisma)

Twelve models. Cascade behavior noted where applicable.

```
Organization ──1:N── User
             ──1:N── Case
             ──1:N── ExternalConnector

Case ──1:N── Document                (onDelete Cascade)
     ──1:N── FinancialValue          (onDelete Cascade)
     ──1:N── AddBack                 (onDelete Cascade)
     ──1:1── IndustryClassification  (onDelete Cascade)
     ──1:N── ValuationModel          (onDelete Cascade)
     ──1:N── AnomalyFlag             (onDelete Cascade)
     ──1:N── CaseInsight             (onDelete Cascade)
     ──1:N── AuditLog                (no cascade — audit outlives the case)

Document ──1:N── FinancialValue      (nullable — value may not have a doc)
User     ──1:N── AuditLog
```

Key columns worth naming for V2:

- **`Case.ttmReport Json?`** — normalized TTM report is persisted to avoid
  re-running the LLM on every reload.
- **`Document.sha256Hash`** — tamper-evident custody hash (SHA-256 of the raw
  bytes) computed at upload time.
- **`FinancialValue`** — hybrid AI+human workflow lives here:
  `aiSuggestedValue` (immutable AI reference), `confidence`, `sourceRef`,
  `isVerified`, `isLocked`, `reviewStatus`, `overrideReason`, `overriddenBy`,
  `overriddenAt`.
- **`AddBack.rationale`** — required before report generation per the schema
  comment; not currently enforced in code.
- **`ValuationModel`** — polymorphic across MARKET_APPROACH / DCF /
  ASSET_BASED / BLENDED using nullable columns per approach. Includes WACC
  components and a `weight` for reconciliation.
- **`AnomalyFlag.affectedRows`** — JSON string of affected `FinancialValue` ids.
- **`AuditLog`** — `oldValue`/`newValue` are JSON strings; indexed on
  `[caseId, createdAt]` and `[userId]`.

**Financial arithmetic risk (documented, not fixed here):** every monetary
column uses `Float` (`FinancialValue.value`, all `AddBack` amounts, every
`ValuationModel` monetary + ratio column). Rule 9 requires decimal-safe math;
a future slice touching a money-arithmetic path will need a decimal helper or
a schema migration to `Decimal(...)`. Not addressed in Slice 0.

## 4. Request lifecycle

### Page requests
1. `src/middleware.ts` runs. It reads the `session` cookie via `getSession()`
   from [src/lib/auth-utils.ts](../../src/lib/auth-utils.ts).
2. If no session and the path is not in `['/','/login','/signup']`, redirect
   to `/login`. If there is a session and the user is on `/login` or
   `/signup`, redirect to `/dashboard`.
3. The middleware matcher excludes `api`, `_next/static`, `_next/image`,
   `favicon.ico`, `landing`, `videos`, and common asset extensions — so API
   handlers are **not** protected by middleware and must enforce their own
   auth.

### Server actions (all mutations)
Every file under `src/app/actions/` begins with `'use server'`. The dominant
pattern is:

```ts
const session = await getSession()          // (1) read JWT session cookie
guardAction(session, 'permission:string')   // (2) RBAC — throws on fail
// (3) mutate via prisma.<model>.<verb>({ ... })
await logAction({ userId, action, ... })    // (4) audit chain of custody
revalidatePath(`/projects/${caseId}`)       // (5) invalidate the workspace
```

There is **no shared helper** that also enforces tenant scoping (see
[AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md) for the gap analysis).

### API routes
- `POST/GET /api/auth/logout` — clears the cookie and redirects.
- `GET /api/connect/microsoft` — sends the user to Azure AD.
- `GET /api/connect/microsoft/callback` — exchanges code for token, then
  calls `saveOAuthToken('microsoft', tokenData)` (a server action) which
  reads `getSession()` to bind the token to an org.
- `POST /api/webhooks/stripe` — verifies HMAC signature via
  `stripe.webhooks.constructEvent`, handles `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`. Uses `event.metadata.organizationId` to route
  updates.

## 5. Auth & session

- Cookie name: `session`. Set as `httpOnly`, no `secure` / `sameSite` set
  explicitly. TTL 2h from creation.
- Payload signed HS256 via `jose`. Secret is `process.env.JWT_SECRET` and
  falls back to the string literal `"secret_key_for_prototype_only"` when
  missing. That fallback should be removed in a hardening slice.
- Session payload shape:
  `{ userId, organizationId, role, email }`.
- Password hashing via `bcrypt.hash(password, 10)`.

## 6. RBAC

Four roles, listed lowest → highest:
`VIEWER < REVIEWER < EDITOR < ADMIN`.

Permission map lives in [src/lib/rbac.ts](../../src/lib/rbac.ts). Behavior
worth pinning:

- `hasPermission(role, perm)` — case-normalizes the role via `toUpperCase()`.
- Unknown role → **fail-closed** (returns `false`). The `?? 'VIEWER'` fallback
  only fires when the role is nullish, not when it is a non-matching string.
- `guardAction(null, ...)` throws `Unauthorized`.
- `requirePermission(role, missing)` throws
  `Forbidden: role '<r>' cannot perform '<p>'`.

Permissions currently defined:
`case:create|delete|read`, `document:upload|delete`, `extraction:run`,
`value:accept|override|reject|lock|approve_batch`,
`addback:write|approve`, `valuation:write`, `report:generate`,
`anomaly:run`, `team:manage`, `org:settings`, `audit:read`.

## 7. Audit trail

[src/lib/audit.ts](../../src/lib/audit.ts) exposes `logAction({...})`. It
never throws — audit failures are caught and logged, so a mutation is not
rolled back if the audit write fails. That is intentional but is a
compliance risk in a forensic context; a future slice may want to move
audit into the same DB transaction as the mutation, or at least alert on
failed audit writes.

## 8. Storage (S3) & document custody

- `src/lib/s3-client.ts` reads `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME` from env.
- Uploads go through `addDocument(caseId, formData)`
  (`src/app/actions/documents.ts`). Steps:
  1. Read the `File` from `FormData`.
  2. SHA-256 the buffer.
  3. Put to key `cases/<caseId>/<timestamp>-<sanitizedName>`.
  4. If a non-S3 storage provider is chosen, mirror the file to the
     matching `ExternalConnector` (Microsoft Graph today).
  5. Persist a `Document` row with `status: 'VERIFIED'` (note: no PENDING
     handoff to extraction).
  6. `logAction({ action: 'UPLOAD_DOCUMENT', ... })`.
- Extraction fetches the object via `GetObjectCommand`, derives a data URI
  from the extension → mime type, and passes it to the Genkit flow.

## 9. AI flows (Genkit)

All seven flows are `'use server'` modules. None reach the database directly;
they take structured inputs and return Zod-validated output that server
actions then persist.

| Flow                                              | Purpose                                                        |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `ai-financial-statement-extraction-flow.ts`       | Multi-page OCR + line-item extraction with confidence + sourceRef |
| `ai-industry-code-suggestion-flow.ts`             | Suggest NAICS/SIC from a business description                  |
| `anomaly-detection-flow.ts`                       | Margin/outlier/Benford/ratio/duplicate/related-party checks    |
| `binder-query-flow.ts`                            | Natural-language Q&A against the case ledger                   |
| `insights-flow.ts`                                | Proactive next-step suggestions on the case dashboard          |
| `normalize-ttm-flow.ts`                           | Map raw items into TTM normalized categories                   |
| `report-narrative-flow.ts`                        | Draft one of 8 report sections in formal appraisal language    |

Model: `googleai/gemini-2.5-flash`.

## 10. Billing

- Plans in [src/lib/plans.ts](../../src/lib/plans.ts):
  `TRIAL`, `SOLO`, `FIRM`, `ENTERPRISE`. Each defines `casesLimit`,
  `usersLimit`, Stripe price ID (from env), features.
- `casesLimit` is enforced server-side inside `createCase` in
  `src/app/actions/cases.ts`. `usersLimit` is **not** enforced anywhere in
  code — the `/team` page is currently static mock UI, no
  create/invite server action exists.
- Webhook handler at `src/app/api/webhooks/stripe/route.ts` upgrades the
  org's `plan`, `casesLimit`, `usersLimit`, `subscriptionStatus`,
  `currentPeriodEnd` from Stripe events. Signature is HMAC-verified.

## 11. Middleware coverage & public surface

- Middleware matcher intentionally excludes `api/*`. That includes
  `/api/webhooks/stripe` (correct — must be public + signature verified) and
  the OAuth callback routes.
- Public pages: `/`, `/login`, `/signup`.
- Every other page is behind the session gate.

## 12. Known baseline behavior worth preserving

- Financial values start life as `isVerified: false`, `reviewStatus:
  'PENDING'`. `aiSuggestedValue` is set once and treated as immutable.
- A locked `FinancialValue` cannot be overridden — `overrideFinancialValue`
  and `updateFinancialValue` both throw when `isLocked === true`.
- Deleting a document cascades to its `FinancialValue` rows (Prisma
  `onDelete: Cascade`).
- Anomaly re-runs delete only OPEN flags, so INVESTIGATED / EXPLAINED /
  ESCALATED history survives.
- Insight re-runs delete only non-dismissed insights.
- `Case.ttmReport` caches the normalized report; the AI flow is only run
  when the user explicitly asks for a refresh.

## 13. Baseline command results (recorded on Windows 11 / PowerShell 5.1)

| Command             | Result                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------- |
| `npm run typecheck` | **Fails**. 3 errors in `src/components/ui/calendar.tsx` — react-day-picker v9 renamed `IconLeft`. Pre-existing; unrelated to product code. |
| `npm run lint`      | **Blocked**. `next lint` is deprecated in Next 16 and enters an interactive setup prompt because no `.eslintrc` exists. |
| `npm run build`     | **Fails on Windows**. `"NODE_ENV=production next build"` uses POSIX env syntax that PowerShell/CMD reject. Setting `$env:NODE_ENV="production"` and running `next build` succeeds — all 17 routes are emitted. `ignoreBuildErrors` masks the typecheck failure. |
| `npm test`          | **Passes (new)**. 45 tests across 3 files (`tests/unit/rbac.test.ts`, `tests/unit/plans.test.ts`, `tests/smoke/repo-shape.test.ts`). |

## 14. Test infrastructure (added in Slice 0)

- `vitest@^2`, `@vitest/coverage-v8@^2` (v2 chosen for `@types/node@20` peer
  compat).
- `vitest.config.ts` at repo root resolves the `@/*` alias to `./src` and
  runs in the Node environment.
- Test locations: `tests/unit/*.test.ts`, `tests/smoke/*.test.ts`. E2E slot
  reserved at `tests/e2e/` (excluded from Vitest — Playwright to be added
  in a later slice).
- Scripts: `npm test`, `npm run test:watch`, `npm run test:coverage`.
- No application code was changed to make tests pass. The only behavior
  the tests assert is what the current code already does — including the
  fail-closed unknown-role behavior of `hasPermission`.
