# Case Team & Professional Review Workflow

Landed in Slice 11. Adds engagement-level access control on top of the
Slice-0 organization RBAC, plus a review-item lifecycle for material
targets (financial values, add-backs, valuation assumptions,
discrepancies, report sections, documents, tie-outs).

## Why

A CPA firm's client roster contains confidential engagements. Every
firm member does not automatically deserve visibility into every
engagement. Slice 1 gave us tenant scoping at the organization level;
Slice 11 tightens that to the case level.

## Two-layer authorization

```
   session exists                    (Slice 2)
        &&
   case in caller's org              (Slice 1)
        &&
   [ engagement gate ]               (Slice 11 — this doc)
        &&
   [ required permission ]           (Slice 0 RBAC or case role)
```

The engagement gate:

- `Case.hasEngagementTeam == false` → whole-org access (Slice 1 semantics).
- `Case.hasEngagementTeam == true` → caller is an **org ADMIN** OR an
  **active CaseMember** (`removedAt IS NULL`). Everyone else gets
  `NotFoundError` — indistinguishable from a nonexistent case, per the
  Slice-1 anti-enumeration rule.

Composition is done inside `requireCaseAccess(caseId, permission?)`.
No callsite change — every server action that already routed through
this helper picks up the engagement gate for free.

## The monotonic flag

`Case.hasEngagementTeam` starts `false`. Adding the first CaseMember
flips it to `true`. From that moment forward, the case is team-scoped.

**The flag never flips back to `false`.** Even removing the last member
leaves it `true`. Rationale: an operator who removes the last member
would be surprised to see the whole org regain access. Explicit team
membership is safer than a silent revert.

If you truly want to open a case to the whole org again, remove the
`hasEngagementTeam` flag from the DB directly — an intentional,
audit-visible step, not something an ordinary click could cause.

## Case roles

Distinct from the org RBAC role (VIEWER / REVIEWER / EDITOR / ADMIN).

| Role | Rank | Notes |
|---|---:|---|
| `ENGAGEMENT_PARTNER` | 100 | Can manage the team; refuse to remove the last one on a case |
| `MANAGER` | 80 | Can manage the team |
| `SENIOR` | 60 | |
| `ANALYST` | 40 | |
| `REVIEWER` | 30 | |
| `READ_ONLY` | 10 | |
| `EXTERNAL_COLLABORATOR` | 5 | Architected — no automatic access yet |

`canManageTeam(role)` gates the team-management writes. Anyone below
`MANAGER` cannot invite, remove, or re-role members. `atLeastCaseRole`
is exposed for future callers wanting "SENIOR or above" style checks.

## Guardrails

- **Refuse to remove the last active Engagement Partner** — throws
  with an explicit message.
- **Refuse to demote the last Engagement Partner** — same rule for
  role changes.
- **Adding a member re-activates a soft-deleted membership** — no
  duplicate rows for the same `(caseId, userId)`.

## Review workflow

`ReviewItem` attaches a lightweight review lifecycle to any material
target on the case. Polymorphic parent via `(targetType, targetId)`,
unique on `(caseId, targetType, targetId)` — one review item per
target.

### Status machine

```
    DRAFT ──► READY_FOR_REVIEW ──► APPROVED
                    │
                    ├── CHANGES_REQUESTED ──► READY_FOR_REVIEW
                    └── DRAFT (author sends back to themselves)
    APPROVED ──► READY_FOR_REVIEW  (reviewer reopens for rework)
```

`CHANGES_REQUESTED` requires a note (stored on the row). `APPROVED`
does not — the reviewer + timestamp is the trail.

### Comments

`ReviewComment` is append-only at the app layer. No `update` or
`delete` action exists on purpose. The review conversation is part of
the audit trail.

## Review queue

`getCaseReviewQueue(caseId)` combines two shapes into one summary:

1. **Explicit `ReviewItem` rows** grouped by `targetType` — how many
   are ready for review, how many have changes requested, etc.
2. **Derived counts** from earlier slices:
   - `FinancialValue.reviewStatus = 'PENDING'` (Slice 0)
   - `AddBack.status = 'PROPOSED' | 'NEEDS_SUPPORT'` (Slice 10)
   - `TieOut.status = 'DISCREPANCY'` (Slice 9)
   - `Document.status = 'PENDING'` (Slice 5) — "missing documents"
   - `AnomalyFlag.status = 'OPEN'` (Slice 0)

Both shapes are returned. The header badge displays the total.

## Server actions

All tenant + engagement-gate scoped through `requireCaseAccess`.

| Action | Permission | Notes |
|---|---|---|
| `getCaseMembers(caseId)` | `case:read` | |
| `addCaseMember` | Partner/Manager or ADMIN | Flips `hasEngagementTeam` on first add |
| `removeCaseMember` | Partner/Manager or ADMIN | Refuses to remove last Partner |
| `changeCaseMemberRole` | Partner/Manager or ADMIN | Refuses to demote last Partner |
| `getReviewItemsForCase` | `case:read` | |
| `createReviewItem` | `value:accept` | Auto-returns existing item on duplicate target |
| `changeReviewStatus` | `value:accept` | Transitions gated by `canReviewTransition` |
| `addReviewComment` | `case:read` | Append-only |
| `getCaseReviewQueue` | `case:read` | |

Every mutation writes an `AuditLog` event (`UPDATE_CASE` action) that
lands on the Slice-6 tamper-evident hash chain.

## Migration

Purely additive. New columns on `Case` are `NOT NULL DEFAULT 0`. New
tables have foreign keys to existing tables with `ON DELETE CASCADE`
so cleanup happens naturally when a case is removed.

**No data backfill** — existing cases all have `hasEngagementTeam=0`
and continue to behave under Slice-1 rules until an operator adds the
first member.

## Explicit non-goals (Slice 11)

- **Cross-case case-member view** — a "which cases am I on" list for a
  user. Server-ready (a `caseMember.findMany({ where: { userId } })`
  is a couple of lines), UI is a follow-up.
- **`getOrgReviewQueue`** — like Slice 10's `getOrgReviewerQueue` but
  for `ReviewItem` rows. Not yet built.
- **External collaborator access rules** — enum value exists;
  automatic case-permission scopes for this role are future work.
- **Notifications** — no email or in-app ping when a reviewer requests
  changes. UI shows the queue; a notification transport is future work.
- **Case-role-based permissions**: this slice enforces the *membership*
  boundary and the *team-management* privilege. Further gating (e.g.
  "only Senior+ can approve add-backs") is layered by the server
  actions themselves via `requireCaseRole` in a follow-up.
- **Slice 1–10 backlogs** all remain open.
