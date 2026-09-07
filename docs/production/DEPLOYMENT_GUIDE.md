# Deployment Guide

Slice-17 production deployment reference.

## Prerequisites

- **Node.js** 20.x (matches CI). Higher majors have not been validated.
- **MySQL** 8.0+ with `utf8mb4` character set. All Slice-15 `JSON`
  columns and Slice-14 `LONGTEXT` columns require it.
- **AWS S3** bucket with per-object write + read permissions for the
  runtime IAM role. See [SECURITY_MODEL.md](SECURITY_MODEL.md).
- **AWS KMS** key (production) OR a 32-byte base64 KEK (dev/staging).
  See [SECURITY_MODEL.md](SECURITY_MODEL.md) for rotation strategy.
- **Genkit / Google GenAI** API key for the AI flows.
- **Stripe** account (optional; billing surface).

## Required environment variables

Runtime (`process.env`):

| Var | Required | Notes |
|---|---|---|
| `JWT_SECRET`                      | yes     | ≥ 32 chars in prod. Fail-closed if unset. |
| `DATABASE_URL`                    | yes     | MySQL connection string. |
| `NEXT_PUBLIC_APP_URL`             | yes     | Base URL for OAuth redirects, portal invites, exports. |
| `AWS_REGION`                      | yes     | S3 + KMS region. |
| `AWS_S3_BUCKET_NAME`              | prod    | Readiness probe checks presence. |
| `AWS_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | prod | OR use an instance role. |
| `AWS_KMS_KEY_ID`                  | prod    | Envelope-encryption KEK. |
| `CONNECTOR_KEK_B64`               | dev only | 32-byte KEK for local encryption. |
| `STRIPE_SECRET_KEY` / `_WEBHOOK_SECRET` | if billing | Required only if the billing surface is enabled. |
| `MICROSOFT_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | if MS connector | Slice-3 OAuth. |
| `QUICKBOOKS_CLIENT_ID` / `_SECRET` | if QBO connector | Slice-15 OAuth. |
| `GOOGLE_GENAI_API_KEY`            | if AI flows | Slice-8+. |
| `LOG_LEVEL`                       | no      | `debug` \| `info` \| `warn` \| `error`. Default `info` in prod. |

## First-time deployment

```
git clone <repo>
cd forensic_appraisal
npm ci
npx prisma generate

# One-time DB bootstrap:
mysql --user=root --execute="CREATE DATABASE valuvault CHARACTER SET utf8mb4;"
DATABASE_URL=<url> npx prisma migrate deploy

# Apply Slice-2 through Slice-16 SQL migrations in order:
for f in docs/migrations/slice-{2..16}-*.sql; do
  mysql --user=<user> --password=<pw> valuvault < "$f"
done

# Build + start:
NODE_ENV=production npx next build
NODE_ENV=production npx next start
```

## Reverse-proxy notes

- Terminate TLS upstream. The app sets `Secure` on session cookies
  when `NODE_ENV=production`, so it MUST be served over HTTPS.
- Forward the `X-Forwarded-For` header so login-rate-limit audit rows
  record real client IPs.
- Time out slow uploads at ≥ 120 s. Slice-5 upload validation reads
  the whole buffer before writing to S3.

## Health probes

- Liveness  → `GET /api/health`       — 200 unless the process crashed.
- Readiness → `GET /api/health/ready` — 200 when DB + S3 config are OK,
                                        503 during degraded window.
                                        Response body includes per-check status.

Recommended kubelet defaults: liveness every 30 s (3 fails restart),
readiness every 10 s (3 fails drain traffic).

## CI

`.github/workflows/ci.yml` runs four jobs on every push / PR:

1. **static**   — Prisma generate + validate + `tsc --noEmit`
2. **tests**    — `npm test` (1000+ Vitest)
3. **build**    — `npx next build`
4. **audit**    — `npm audit --production --audit-level=high` (advisory)

`release-gate` fans in on 1-3. Branch protection points to
`release-gate` — no merge unless all three pass.

## Playwright E2E (opt-in)

The Slice-17 canonical E2E test lives at
`tests/e2e/full-workflow.spec.ts`. It is intentionally excluded from
the CI Vitest job because it needs a live server + seeded DB +
Chromium.

To run locally:

```
npm install -D @playwright/test
npx playwright install --with-deps chromium
# Start dev server with a seeded DB, then:
E2E_EMAIL=analyst@e2e.valuvault.test \
E2E_PASSWORD=<seeded-password> \
npx playwright test
```

Recommended CI wiring: separate GitHub Actions job that runs on
release-cut, spins up a docker-compose stack with MySQL, seeds
fixtures, and drives Playwright.

## Rollback strategy

- Database rollback is by migration reversal. Every slice migration
  in `docs/migrations/` documents rollback under its `-- Rollback:`
  block.
- Application rollback is by re-deploying the previous artifact. The
  Slice-14 `Report`, Slice-13 `ValuationEngagement`, and Slice-6
  audit chain are all forward-compatible with a one-version-back
  rollback.
- Never manually mutate `AuditLog` rows on a rollback — the Slice-6
  hash chain detects mutations. Follow
  [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

## Configuration checklist

Before a first production deploy:

- [ ] `JWT_SECRET` ≥ 32 chars, rotated from any dev value.
- [ ] `DATABASE_URL` points at production DB with utf8mb4.
- [ ] `AWS_KMS_KEY_ID` set and the runtime IAM role has `Encrypt`/`Decrypt`.
- [ ] `AWS_S3_BUCKET_NAME` set; bucket policy denies public read.
- [ ] TLS enforced end-to-end at the reverse proxy.
- [ ] `NEXT_PUBLIC_APP_URL` matches the public HTTPS URL.
- [ ] Every OAuth `redirect_uri` on the provider console matches
      `${NEXT_PUBLIC_APP_URL}/api/connect/{provider}/callback`.
- [ ] Log aggregation configured to consume stdout JSON.
- [ ] Health probes wired.
- [ ] Backup schedule active — see [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md).
