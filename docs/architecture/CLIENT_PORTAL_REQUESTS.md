# Client Request List and Secure Portal

Landed in Slice 12. Replaces ad-hoc email-based "please send us the tax
returns" collection with a structured PBC (prepared-by-client) workflow
and a narrow-scope client portal.

## The problem

Historically, engagements collected documents by email:

- Analyst emails a numbered list to the client.
- Client emails a zip back.
- Someone renames files, uploads to the case, marks the item done.
- Follow-ups happen in a thread that becomes an audit-review headache.

The engagement's chain of custody effectively lives in a mail server.
There is no reliable "what's still missing" view, no dedupe, and no
guardrail against forwarding sensitive materials to the wrong person.

## The solution

Two connected surfaces:

1. **Firm-side Request List** — a case-scoped list of `RequestItem`s,
   with statuses, categories, and (optional) AI-assisted completeness
   suggestions. Analysts + reviewers see the "17 / 24 received, 3 need
   clarification, 7 outstanding" dashboard on the case page.

2. **Client portal** — a per-invitation `https://…/portal/<token>` link
   the firm emails to a client contact. The token is opaque — its
   SHA-256 hash is what's stored in the DB. The portal shows only the
   list that token was issued for; nothing else.

## Two auth surfaces, one codebase

```
  Firm surface                        Portal surface
  ────────────                        ──────────────
  cookie: pv_session (JWT)            capability: raw token in URL
  → requireCaseAccess()               → resolvePortalAccess(rawToken)
  → org RBAC roles                    → NO org role, NO firm session
  → engagement-team gate              → single RequestList scope
```

There is no shared session store. A portal caller NEVER appears to
`getSession()`. A firm caller NEVER hits `resolvePortalAccess`. The
middleware carves `/portal/*` out of the firm-session redirect logic:
an unauthenticated user hitting the portal URL sees the portal (or a
"link expired" page), not the login screen.

## Portal-token security model

The Slice-2 password-reset scheme is the template:

- 32 bytes from `randomBytes()`, base64url-encoded → the raw token.
- `SHA-256(rawToken).hex` → the DB primary key (`PortalAccess.tokenHash`).
- The raw value exists exclusively in the outgoing email URL and the
  single return value of `invitePortalAccess`. It is never logged,
  never stored, never surfaced back to a client (`listPortalInvites`
  returns tokenHash only).

Consequences:

- A DB dump does not leak usable portal URLs.
- Revocation is a real capability — flipping `PortalAccess.revokedAt`
  invalidates the URL server-side without waiting for expiry.
- There is no signed claim to forge. Compromising the JWT secret does
  not compromise the portal.

## `resolvePortalAccess(rawToken)` — the sole gate

Every portal-side server action starts with this call. It:

1. Shape-checks the raw token cheaply (before hashing).
2. Hashes it and looks up the row by `tokenHash`.
3. Rejects (with `NotFoundError`) if any of:
   - no row,
   - `revokedAt IS NOT NULL`,
   - `expiresAt <= now`,
   - the parent `RequestList.status = 'CLOSED'`,
   - the `ClientContact.isActive = false`.
4. Returns a `PortalScope` — the token hash + `requestListId` +
   `caseId` + `organizationId` + contact identity.

Every downstream write in `portal.ts` is filtered by this scope.
`portal.ts` never calls `requireCaseAccess`, `requireSession`, or
`hasPermission`. A test enforces this invariant:
`tests/integration/portal-access.test.ts` primes `prisma.case.findFirst`
to *throw* if invoked, so any regression that reaches for firm-side
tenant scoping surfaces as a test failure, not a security regression.

Every failure surfaces as the same `NotFoundError`. The client can
tell "your link no longer works" but not *why* — consistent with the
Slice-1 anti-enumeration rule.

## Client-facing DTO scrubs firm-internal fields

`sanitizeItemForPortal` strips:

- `notes` — firm-internal notes.
- `assignedToUserId`, `reviewerUserId` — org identity of firm staff.
- `aiCompleteness`, `aiCompletenessNote` — AI-assisted signal, only
  for the reviewer.

The scrub is by construction (allowlist), not by omission. The test
`tests/integration/portal-access.test.ts` primes an item with a
distinctive `notes: 'firm-internal — NEVER RETURN'` value and asserts
it does not appear in the JSON view returned to the portal.

## `RequestItem` status machine

```
       NOT_REQUESTED                        (initial; list is DRAFT)
             │
             │  markRequestListSent / invite
             ▼
        REQUESTED
             │
             │  portal upload
             ▼
         RECEIVED  ←── NEEDS_CLARIFICATION
             │              ▲
   accept    │              │  reviewer flags, note required
             ▼              │
         ACCEPTED           │
             │              │
             └──── reopen ──┘
```

- `NEEDS_CLARIFICATION` requires a note. Writing the transition also
  writes a `ReminderEvent` (`kind='CLARIFICATION'`) so the client sees
  the ask on their next portal visit.
- `ACCEPTED` may be reopened → `REQUESTED` or `NEEDS_CLARIFICATION`.
  The reviewer decides.
- `NOT_APPLICABLE` is terminal but reopenable.

The state machine lives in `src/lib/requests/statuses.ts` and is
exercised at both the unit level (`tests/unit/request-status.test.ts`)
and via the real action code path
(`tests/integration/request-actions.test.ts`).

## Dashboard classification

The three headline counts match the slice-prompt copy
("17 / 24 received, 3 need clarification, 7 outstanding"):

| Bucket        | Statuses included         |
|---------------|---------------------------|
| received      | `RECEIVED` + `ACCEPTED`   |
| clarification | `NEEDS_CLARIFICATION`     |
| outstanding   | `REQUESTED`               |

`NOT_REQUESTED` (draft) and `NOT_APPLICABLE` (excluded on purpose)
DO NOT contribute to the visible totals.

## Templates

Two shapes:

1. **`SEED_TEMPLATES`** — a code-side literal in
   `src/lib/requests/templates-seed.ts`. Presets for Business
   Valuation, Divorce, Litigation. Firms clone into org-owned
   templates before editing.
2. **`RequestTemplate`** — org-owned rows firms can edit freely.
   System templates (`isSystem = true`) can be cloned but not
   modified or deleted.

Applying a template at list-creation time copies each
`RequestTemplateItem` into a `RequestItem` on the list — the copy is
detached, so later template edits don't reach into open engagements.

## AI-assisted completeness detection

The `requestCompletenessFlow` (in `src/ai/flows/`) reads file names +
metadata for the documents attached to a `RequestItem` and emits:

```ts
{ verdict: 'AUTO_COMPLETE' | 'NEEDS_HUMAN' | 'INSUFFICIENT',
  isConfident: boolean, reason: string }
```

Two invariants echo Slice 7 and Slice 8:

1. **Never auto-transitions the status.** The `aiCompleteness` field
   is written; the RequestItem `status` is not. Reviewer sees the
   suggestion, decides.
2. **Unconfident output is downgraded to `NEEDS_HUMAN`.** Even if the
   model returns `AUTO_COMPLETE` with `isConfident=false`, the persisted
   verdict is `NEEDS_HUMAN`. The reviewer surface makes this obvious
   with an "(unconfident)" tag.

The call is wrapped by Slice 8's `withAIExecution`, so every
completeness run creates an `AiExecution` row with the scrubbed input
hash + output hash + `documentVersionIds` (the immutable Slice-5
versions the client uploaded). Full traceability.

## Reminders

`ReminderEvent` is the log for every notification touching a request:
`INVITE`, `REMINDER`, `CLARIFICATION`, `RECEIVED_ACK`. Two uses:

1. **Rate-limit** — `sendPortalReminder` refuses to fire twice within
   24h. The refused attempt still writes a `ReminderEvent` with
   `status='SUPPRESSED'`, so the reviewer can see the intent.
2. **Portal timeline** — a future slice will surface the reminder
   history to the portal so the client sees "you were reminded on X".

The mailer is still the Slice-2 stub (`src/lib/mailer.ts`). Rolling
out a real provider is a separate slice; the interface here doesn't
change.

## Migration

Purely additive. Every new table has cascading FKs to existing tables:

- `RequestList` → `Case`
- `RequestItem` → `RequestList` + `Case` (denormalized for indexing)
- `RequestItemDocument` → `RequestItem` + `Document`
- `ClientContact` → `Case`
- `PortalAccess` → `ClientContact` + `RequestList` + `Case`
- `ReminderEvent` → `Case` + optional `RequestList` + `RequestItem` + `ClientContact`
- `RequestTemplate` / `RequestTemplateItem` → `Organization`

No data backfill. Existing cases have `requestLists = []` until an
analyst creates the first one.

Migration SQL at
[docs/migrations/slice-12-client-portal.sql](docs/migrations/slice-12-client-portal.sql).

## Explicit non-goals (Slice 12)

- **Real email transport.** Still the Slice-2 stub. Portal invites
  currently rely on the analyst copy-pasting the link.
- **Portal contact self-service.** No "invite additional collaborators
  from the portal" surface. All contacts are added firm-side.
- **File-content analysis for completeness.** The AI flow only sees
  file names + metadata — not the file bytes. A Slice-7-style
  bounding-box coverage check is a future add.
- **Automatic reminder cadence.** `sendPortalReminder` is manual +
  rate-limited. A scheduled reminder job comes later.
- **Portal-side comment thread.** The firm can write a
  `clarificationNote`; there's no bi-directional chat yet.
- **Extended engagement types.** Only `BUSINESS_VALUATION`, `DIVORCE`,
  `LITIGATION`, `ESTATE`, `OTHER` are recognized as template
  engagement types; seed presets cover the first three.
- **`getOrgRequestQueue`** — a cross-case "all my clients' outstanding
  items" view. Server-ready (`prisma.requestItem.groupBy({ … caseId
  IN … })`); the UI + org-level dashboard is a follow-up.
- **All Slice 1–11 backlogs** remain open.
