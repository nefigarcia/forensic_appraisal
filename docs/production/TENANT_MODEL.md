# Tenant Model

## Shape

```
Organization (firm)
   └── User        (firm employee)
   └── Case        (engagement)
         └── Document, FinancialValue, AddBack, …
         └── CaseMember       (engagement-team scoping — Slice 11)
         └── ClientContact    (portal user — never a firm user)
```

- **Organization** is the top-level tenant. Every persistent row
  belongs (directly or transitively) to one.
- **Case** = engagement = matter. 1:many under Organization.
- **User** is a firm employee. Cross-org visibility is architecturally
  impossible: session carries `organizationId`, every helper filters
  on it.
- **ClientContact** (Slice 12) is a client-side identity distinct
  from `User`. It never has a firm password or JWT.

## Access levels

| Layer | Gate | Enforced by |
|---|---|---|
| Session               | Signed JWT + valid `jti` + `passwordChangedAt` check | Slice-2 `getSession` |
| Tenant                | `record.organizationId = session.organizationId` | Slice-1 helpers |
| Engagement (opt-in)   | `!hasEngagementTeam` OR ADMIN OR active `CaseMember` | Slice-11 gate inside Slice-1 helpers |
| RBAC                  | `hasPermission(role, permission)` | Slice-0 `rbac.ts` |
| Case role (optional)  | `atLeastCaseRole(caseRole, minimum)` | Slice-11 helpers |

## RBAC role summary

- **VIEWER**   — read-only on assigned cases.
- **REVIEWER** — read + comment + accept individual values.
- **EDITOR**   — full case work.
- **ADMIN**    — everything above + team management + engagement gate bypass.

Case-level roles (Slice 11) — Engagement Partner / Manager / Senior /
Analyst / Reviewer / Read-Only / External Collaborator — do NOT
replace org RBAC. They gate team-management writes and future
per-role case permissions.

## Cross-tenant guarantees

- **Search (Slice 16)** — `CaseSearchIndex.organizationId` is
  denormalized so a search query joins tenant filter + `caseId IN
  (authorized)` at index time. A defense-in-depth post-query pass
  drops any leaked row and audits it.
- **Portal (Slice 12)** — the token grants access to ONE
  `RequestList` under ONE case. Even a firm user in the same org sees
  the same portal surface via a separate action; the two code paths
  never share state.
- **Case member (Slice 11)** — removing a member surfaces the case as
  `NotFoundError` for that user. The row is retained for audit.

## Offboarding a tenant

Follow these steps to fully remove an organization's data. Order
matters — evidence must be exported BEFORE cascade deletes fire.

1. **Freeze** — `UPDATE Organization SET subscriptionStatus = 'CANCELED'`.
   No new logins can create side effects (billing gate).
2. **Export** — run `docs/scripts/export-organization.sh` (to be added
   per-firm need). Produces:
   - Every `AuditLog` row (chain intact),
   - Every `DocumentVersion` from S3 with SHA-256 receipts,
   - Every `Report` snapshot as DOCX,
   - The Slice-13 valuation workbench as JSON,
   - The Slice-15 accounting source rows as JSON.
3. **Deliver** — encrypted with a passphrase agreed with the client.
4. **Delete** — `DELETE FROM Organization WHERE id = ?`. Cascade FKs
   (Slice 1 through Slice 16) remove every downstream row. S3 objects
   are removed by an out-of-band job using the exported `s3Key` list.
5. **Retain** — an audit copy of the export receipt + the deletion
   confirmation is retained for 7 years per
   [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md).

Never `DELETE` an individual `User` while their org is active — a
soft flag on `User.deletedAt` is recommended (not yet built; a future
slice can add it without touching the tenant boundary).

## Multi-org users

Not supported at the schema level. `User.organizationId` is a single
FK. A firm employee who moves to another firm gets a new `User` row
in the new organization.

## Firm-owned templates

- Slice-12 `RequestTemplate` — per-org, cloneable seed presets.
- Slice-14 `StandardsChecklist` — per-org, cloneable seed presets.
- Slice-15 `AccountingConnector` — per-case, per-provider tokens.

None of these cross the tenant boundary.
