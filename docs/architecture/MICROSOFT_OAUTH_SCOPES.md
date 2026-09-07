# Microsoft OAuth — Scope Review

Documented in Slice 3. **This document is intentionally not enforcing a
change to the request scopes in the same slice** — trimming a scope
requires every existing connected user to re-consent, which is a UX
decision that belongs to a separate slice.

## Current requested scopes

From `src/app/api/connect/microsoft/route.ts`:

```
user.read
files.read.all
sites.read.all
offline_access
```

## What the app actually does

The connector is used in `src/app/actions/documents.ts::addDocument`
to **PUT** a file into the user's OneDrive at
`/me/drive/root:/ValuVault_Archive/{caseId}/{filename}:/content`. No
SharePoint site is read. No user profile is read. No file is *read*
from Microsoft — the flow is always outbound.

## Minimum required scopes for current behavior

| Scope              | Needed? | Reason |
|--------------------|---------|--------|
| `files.readwrite`  | **yes** | The Graph PUT above requires write to the user's own drive. Note: the app currently requests `files.read.all`, which is **insufficient for the PUT** — Graph rejects with 403. Either the mirror has never been exercised at runtime or the token happens to carry a broader delegated permission through Azure app-level configuration. |
| `offline_access`   | **yes** | Enables refresh-token flow. Without it, users would need to re-authenticate every hour. |
| `user.read`        | no      | Not read anywhere in the codebase. |
| `files.read.all`   | no (for current writes) | Superseded by `files.readwrite` (write access implies read). Currently requested but too narrow to satisfy the actual PUT usage. |
| `sites.read.all`   | no      | No SharePoint access in code. |

## Recommended minimum

```
files.readwrite
offline_access
```

This grants the app write access to the signed-in user's own drive (not
"all files"), plus refresh-token capability. Nothing broader.

## Why the current scopes are wider than needed

- `files.read.all` was probably added under the assumption that the
  app would eventually read files back. That path does not exist yet.
- `sites.read.all` was added speculatively (SharePoint integration
  never landed).
- `user.read` is Microsoft's default include in most examples — it is
  not required for our flow.

## Why we are not trimming in Slice 3

- Every already-connected user has a refresh token issued against the
  current scope set. If we shrink the scopes, the existing refresh
  tokens continue to work — but the AAD app registration would show
  scopes the app can't actually justify, which is untidy.
- The current PUT usage arguably fails with the requested scope. If
  the mirror has never been exercised at runtime (very possible — S3
  is the default storage provider), trimming would surface that as a
  new failure mode. That's better than silent inconsistency, but it
  is a UX change and belongs to its own slice.

## Follow-up work (planned, not in Slice 3)

1. Change the requested scopes in `src/app/api/connect/microsoft/route.ts`
   to `files.readwrite offline_access`.
2. Update the AAD app registration to remove `Files.Read.All`,
   `Sites.Read.All`, and `User.Read` from the delegated permissions
   list.
3. Prompt existing users to re-consent (the Graph refresh flow will
   fail once AAD stops issuing tokens for the broader scopes).
4. Add a test that asserts the auth URL emitted by the route contains
   only the minimum scopes.

## Also worth capturing

- **CSRF is fixed in Slice 3.** The redirect route now generates a
  random 32-byte `state` per authorization request and stores it in an
  `oauth_state` HttpOnly cookie (10-min TTL, `sameSite=lax`). The
  callback verifies the presented state against the cookie with
  `timingSafeEqual` and rejects on mismatch. See
  `src/lib/oauth-state.ts` for the helpers.
