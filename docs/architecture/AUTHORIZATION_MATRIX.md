# ValuVault V2 — Authorization Matrix (Baseline)

Snapshot at **Slice 0**. Every server action (`src/app/actions/`) and API
handler (`src/app/api/`) is catalogued. The purpose is not to redesign
authorization here — it is to make the current state visible so future
slices can close specific gaps deliberately.

---

## Legend

- **Session**: does the handler read `getSession()` before doing work?
- **RBAC**: does it call `guardAction(session, 'permission')` or otherwise
  check role?
- **Tenant**: does it constrain the resource to the caller's
  `session.organizationId` (server-side, from the JWT — not from a
  client-supplied parameter)?
- **Audit**: does it call `logAction(...)`?
- **Gap**: shorthand for the class of issue.
  - **`IDOR-W`** — accepts a client-supplied resource id and mutates it
    without verifying the resource belongs to the caller's org.
  - **`IDOR-R`** — same, but the leak is a read.
  - **`RBAC-MISSING`** — session-only check where a stricter role should
    apply.
  - **`SESSION-MISSING`** — no session check at all on a `'use server'`
    export that is remotely callable.

Findings in this document are baseline observations. **No code was changed
in Slice 0 to remediate them.**

---

## Server actions — `src/app/actions/`

### `auth.ts`

| Handler | Session | RBAC | Tenant | Audit | Gap | Notes |
|---|---|---|---|---|---|---|
| `signup(formData)` | n/a | n/a | creates org | none | — | Sets ADMIN on the first user. No email verification. |
| `login(formData)` | n/a | n/a | n/a | none | — | Returns `{error}` on bad credentials — does not audit failed attempts. |
| `logout()` | n/a | n/a | n/a | none | — | Just clears the cookie. |

### `cases.ts`

| Handler | Session | RBAC | Tenant | Audit | Gap | Notes |
|---|---|---|---|---|---|---|
| `getCases()` | yes | no | **yes** (`where.organizationId = session.organizationId`) | — | — | Returns `[]` when no session. |
| `createCase(formData)` | yes | `case:create` | **yes** (`organizationId` injected from session) | `CREATE_CASE` | — | Also enforces `casesLimit`. |
| `getCaseDetails(id)` | yes | `case:read` | **NO** — `prisma.case.findUnique({ where: { id } })` uses the caller-supplied id with no org constraint | — | **IDOR-R** | Any authenticated user can read any case in any org given the id. |
| `saveValuation(caseId, data)` | yes | `valuation:write` | **NO** — writes `valuationModel` under `caseId` without checking the case's org | `SAVE_VALUATION` | **IDOR-W** | Attacker with any EDITOR role can write valuations into another org's case. |
| `searchCases(query)` | yes | no | **yes** | — | — | Returns `[]` when no session. |
| `getCaseCompleteness(caseId)` | yes | `case:read` | **NO** | — | **IDOR-R** | |

### `documents.ts`

| Handler | Session | RBAC | Tenant | Audit | Gap | Notes |
|---|---|---|---|---|---|---|
| `addDocument(caseId, formData)` | yes | `document:upload` | **NO** — `caseId` is trusted from client | `UPLOAD_DOCUMENT` | **IDOR-W** | Also uploads to S3 and optionally mirrors to Microsoft Graph before the org check would have failed. |
| `deleteDocument(documentId)` | yes | `document:delete` | **NO** — looks up doc by id then deletes S3 object + row | `DELETE_DOCUMENT` | **IDOR-W** | |

### `ai-actions.ts`

| Handler | Session | RBAC | Tenant | Audit | Gap | Notes |
|---|---|---|---|---|---|---|
| `runFinancialExtraction(caseId, documentId?)` | yes | `extraction:run` | **NO** | `RUN_EXTRACTION` | **IDOR-W** | Also charges the org's AI usage. |
| `acceptFinancialValue(id)` | yes | `value:accept` | **NO** | `ACCEPT_VALUE` | **IDOR-W** | |
| `overrideFinancialValue(id, newValue, reason)` | yes | `value:override` | **NO** | `OVERRIDE_VALUE` | **IDOR-W** | Tampering with financial values in another org. Highest severity. |
| `rejectFinancialValue(id, reason)` | yes | `value:reject` | **NO** | `REJECT_VALUE` | **IDOR-W** | |
| `toggleLockFinancialValue(id)` | yes | `value:lock` | **NO** | `LOCK_VALUE`/`UNLOCK_VALUE` | **IDOR-W** | |
| `updateFinancialValue(id, value, lineItem)` | yes | `value:override` | **NO** | none | **IDOR-W** + no audit | Silent tamper — no `logAction` call. |
| `approveFinancialValues(caseId, statementType, year)` | yes | `value:approve_batch` | **NO** | `APPROVE_BATCH` | **IDOR-W** | |
| `askBinder(caseId, query)` | yes | `case:read` | **NO** | none | **IDOR-R** | Reads up to 50 rows from any org's ledger. |
| `runIndustryAnalysis(caseId, description)` | yes | `extraction:run` | **NO** | `RUN_INDUSTRY_ANALYSIS` | **IDOR-W** | |
| `runTtmNormalization(caseId)` | yes | `extraction:run` | **NO** | `RUN_TTM_NORMALIZATION` | **IDOR-W** | Overwrites `Case.ttmReport`. |
| `runAnomalyDetection(caseId)` | yes | `anomaly:run` | **NO** | `RUN_ANOMALY_DETECTION` | **IDOR-W** | Also deletes existing OPEN flags before insert. |
| `resolveAnomalyFlag(flagId, resolution, status)` | yes | `anomaly:run` | **NO** | `RESOLVE_FLAG` | **IDOR-W** | |
| `refreshCaseInsights(caseId)` | yes | `case:read` | **NO** | none | **IDOR-W** | Actually mutates (`caseInsight.deleteMany` + `createMany`) despite requiring only the read permission — RBAC classification mismatch. |
| `dismissInsight(insightId)` | yes | **none** | **NO** | none | **IDOR-W** + **RBAC-MISSING** | Only checks that a session exists. |
| `draftReportSection(caseId, section, existingText?)` | yes | `report:generate` | **NO** | none | **IDOR-R** | Pulls full case incl. valuationModels/addBacks/financialData across orgs. |
| `getAuditLog(caseId)` | yes | `audit:read` | **NO** | — | **IDOR-R** | Reads chain-of-custody for any case by id — worst-case leak because audit logs contain user identities and diffs. |

### `addback-actions.ts`

| Handler | Session | RBAC | Tenant | Audit | Gap | Notes |
|---|---|---|---|---|---|---|
| `getAddBacks(caseId)` | yes | `case:read` | **NO** | — | **IDOR-R** | |
| `createAddBack(caseId, data)` | yes | `addback:write` | **NO** | `CREATE_ADDBACK` | **IDOR-W** | |
| `updateAddBack(id, data)` | yes | `addback:write` | **NO** | `UPDATE_ADDBACK` | **IDOR-W** | |
| `deleteAddBack(id)` | yes | `addback:write` | **NO** | `DELETE_ADDBACK` | **IDOR-W** | |
| `approveAddBack(id)` | yes | `addback:approve` | **NO** | `APPROVE_ADDBACK`/`UNAPPROVE_ADDBACK` | **IDOR-W** | |

### `billing-actions.ts`

| Handler | Session | RBAC | Tenant | Audit | Gap | Notes |
|---|---|---|---|---|---|---|
| `getBillingInfo()` | yes | no | **yes** (`where.id = session.organizationId`) | — | — | |
| `createCheckoutSession(planId)` | yes | **none** | **yes** (org from session) | none | **RBAC-MISSING** | Any EDITOR/REVIEWER/VIEWER can initiate a subscription change on behalf of the org. Should require `org:settings`. |
| `createPortalSession()` | yes | **none** | **yes** | none | **RBAC-MISSING** | Same as above — should require `org:settings`. |
| `applyPlanToOrg(organizationId, planId)` | **no** | **none** | client-supplied | none | **SESSION-MISSING** + trust boundary | Exported from a `'use server'` file → callable from any authenticated client as a server-action RPC (Next.js only requires that the *page* embedding it is signed in). Trusts `organizationId` from the caller. Only intended callsite is the webhook, but the function is remotely reachable. |

### `connectors.ts`

| Handler | Session | RBAC | Tenant | Audit | Gap | Notes |
|---|---|---|---|---|---|---|
| `getExternalConnections()` | yes | no | **yes** | — | — | Returns access tokens too — see note below. |
| `saveOAuthToken(provider, tokenData)` | yes | **none** | **yes** | none | **RBAC-MISSING** | Any authenticated user can overwrite the org's stored OAuth tokens. Should require `org:settings`. |

Additional connector observation: `ExternalConnector.accessToken`/
`refreshToken` are stored in plaintext (`@db.Text`). Not an authorization
matrix concern per se but worth flagging alongside — the roadmap includes
an encryption-at-rest slice.

---

## API routes — `src/app/api/`

| Route | Method | Auth model | Tenant | Notes |
|---|---|---|---|---|
| `/api/auth/logout` | `GET` + `POST` | none | n/a | Clears cookie and redirects. GET accepted intentionally to survive prefetch. |
| `/api/connect/microsoft` | `GET` | none | n/a | Redirects to Microsoft OAuth. Uses fixed `state=forensic_valuvault` — **no per-session state**, no CSRF binding. Future slice should rotate a random `state` bound to the session. |
| `/api/connect/microsoft/callback` | `GET` | delegates to `saveOAuthToken()` which requires a session | via session | If the callback is hit without a session cookie (e.g. Safari 3P cookies), the exception surfaces as a 500 instead of a friendly redirect. |
| `/api/webhooks/stripe` | `POST` | Stripe HMAC (`stripe.webhooks.constructEvent`) | `event.metadata.organizationId` | Correct trust model. Falls back to `SOLO` when a subscription's price ID doesn't match any known plan — worth logging louder for observability. |

---

## Resource → operation → required permission (target design)

This is the target the roadmap will drive towards. It combines existing
permissions plus a `tenant` requirement column that Slice 1 will enforce
via a shared helper. **Rows marked ✱ currently pass the RBAC check but
skip the tenant check.**

| Resource | Op | Required permission | Tenant scope | Baseline compliance |
|---|---|---|---|---|
| `Case` | read | `case:read` | must belong to session.org | ✱ `getCaseDetails`, `getCaseCompleteness` |
| `Case` | create | `case:create` | injected from session | ✅ `createCase` |
| `Case` | delete | `case:delete` | must belong to session.org | not implemented |
| `Case` | search | (session only) | ✅ | ✅ `searchCases` |
| `Document` | upload | `document:upload` | case must belong to session.org | ✱ `addDocument` |
| `Document` | delete | `document:delete` | doc's case must belong to session.org | ✱ `deleteDocument` |
| `FinancialValue` | accept | `value:accept` | value's case must belong to session.org | ✱ `acceptFinancialValue` |
| `FinancialValue` | override | `value:override` | ✱ | ✱ `overrideFinancialValue`, `updateFinancialValue` (silent) |
| `FinancialValue` | reject | `value:reject` | ✱ | ✱ `rejectFinancialValue` |
| `FinancialValue` | lock | `value:lock` | ✱ | ✱ `toggleLockFinancialValue` |
| `FinancialValue` | batch approve | `value:approve_batch` | ✱ | ✱ `approveFinancialValues` |
| `FinancialValue` | run extraction | `extraction:run` | ✱ | ✱ `runFinancialExtraction` |
| `AddBack` | read | `case:read` | ✱ | ✱ `getAddBacks` |
| `AddBack` | create/update/delete | `addback:write` | ✱ | ✱ addback CRUD |
| `AddBack` | approve | `addback:approve` | ✱ | ✱ `approveAddBack` |
| `IndustryClassification` | write | `extraction:run` | ✱ | ✱ `runIndustryAnalysis` |
| `Case.ttmReport` | write | `extraction:run` | ✱ | ✱ `runTtmNormalization` |
| `ValuationModel` | create | `valuation:write` | ✱ | ✱ `saveValuation` |
| `AnomalyFlag` | run | `anomaly:run` | ✱ | ✱ `runAnomalyDetection` |
| `AnomalyFlag` | resolve | `anomaly:run` | ✱ | ✱ `resolveAnomalyFlag` |
| `CaseInsight` | refresh | `case:read` (should be `extraction:run` — writes rows) | ✱ | ✱ `refreshCaseInsights` — classification mismatch |
| `CaseInsight` | dismiss | should be `case:read` at minimum | ✱ | ✱ `dismissInsight` — no RBAC check today |
| `AuditLog` | read | `audit:read` | ✱ | ✱ `getAuditLog` |
| `Report` | draft | `report:generate` | ✱ | ✱ `draftReportSection` |
| `ExternalConnector` | list | (session only) | ✅ | ✅ `getExternalConnections` |
| `ExternalConnector` | write | should require `org:settings` | ✅ | ⚠️ `saveOAuthToken` — no role check |
| `Organization.billing` | checkout | should require `org:settings` | ✅ | ⚠️ `createCheckoutSession`, `createPortalSession` |
| `Organization.plan` | apply from Stripe | webhook-only (HMAC) | via metadata | ⚠️ `applyPlanToOrg` reachable from client |
| `Binder chat` | ask | `case:read` | ✱ | ✱ `askBinder` |

---

## Summary of gaps to prioritize

1. **Tenant enforcement (IDOR)** — 25 handlers accept a client-supplied
   resource id and never verify the resource belongs to
   `session.organizationId`. This is the single biggest cross-org exposure
   in the codebase and is the target of the first V2 slice.

2. **Silent mutations** — `updateFinancialValue`, `refreshCaseInsights`,
   `dismissInsight`, `saveOAuthToken`, `createCheckoutSession`,
   `createPortalSession` mutate state without calling `logAction`. Forensic
   posture requires them to.

3. **RBAC classification mismatch** — `refreshCaseInsights` (guarded by
   `case:read` but mutates), `dismissInsight` (no role check).

4. **Reachable internal server action** — `applyPlanToOrg` is exported from
   a `'use server'` file with no session check and trusts a client-supplied
   `organizationId`. Should move to a plain module or gate on a webhook-only
   trust token.

5. **OAuth CSRF** — Microsoft OAuth `state` is a fixed string; not bound to
   the session.

6. **JWT secret fallback** — `auth-utils.ts` falls back to a hard-coded
   default when `JWT_SECRET` is unset. Environment validation should refuse
   to boot without the secret.

7. **OAuth tokens in plaintext** — `ExternalConnector.accessToken` /
   `refreshToken` are stored as plain text. Encryption at rest recommended.

8. **Session cookie** — no `secure`, no `sameSite`, no domain hardening.

All of the above are recorded here and mapped onto the roadmap. Slice 0
does not fix any of them.
