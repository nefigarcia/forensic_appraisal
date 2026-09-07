# Connector Credential Encryption

Envelope encryption for connector OAuth tokens and any future connector
credentials. Introduced in Slice 3.

## Threat model

- **Adversary**: has read-only access to a database dump (leaked backup,
  accidental log, compromised replica).
- **What we protect**: OAuth `access_token` and `refresh_token` for
  Microsoft Graph, plus any future connector credentials (Google Drive
  refresh tokens, SharePoint app secrets, etc.).
- **What we do not protect**: an adversary with live app credentials
  and network access to KMS. If they can execute code with the app's
  IAM role, they can decrypt. Defense-in-depth is out of scope here —
  IAM least-privilege belongs to the deployment layer.

## Design at a glance

```
plaintext token → AES-256-GCM(with fresh DEK) → ciphertext blob
                        DEK → KEK.wrap()      → wrapped DEK
                                                └── stored beside ciphertext
```

Both blobs (ciphertext, wrapped DEK) plus a `keyVersion` tag are stored
per row. Nothing about the encryption depends on the DB — the same blobs
can be moved between environments as long as the KEK is reachable.

## KEK providers

Selected by `src/lib/crypto/kek.ts::kekProvider()`. Selection order:

1. **`AWS_KMS_KEY_ID` present** → `KmsKekProvider`. `Encrypt`/`Decrypt`
   against the KMS key alias/ARN. Region comes from `AWS_REGION`.
2. **Production, no `AWS_KMS_KEY_ID`** → boot fails with a message. We
   refuse to encrypt production tokens with a local key.
3. **Dev/test with `CONNECTOR_KEK_B64`** → `LocalKekProvider`. 32-byte
   AES-256-GCM key supplied via env.
4. **Dev/test with neither** → ephemeral random `LocalKekProvider` +
   loud warning. Anything encrypted this way is unreadable after
   process restart. Fine for a scratch dev environment; never OK for
   anything else.

## Storage shape

`ExternalConnector.encryptedSecrets` (JSON):

```json
{
  "version": "v1",
  "secrets": {
    "accessToken":  { "ciphertext": "…base64…", "dek": "…base64…" },
    "refreshToken": { "ciphertext": "…base64…", "dek": "…base64…" }
  }
}
```

Companion column: `encryptionKeyVersion` — either `local-v1` or
`kms:<key-arn-or-alias>`. Indexed so rotation queries can find rows
still keyed to an old KEK.

The legacy plaintext columns `accessToken` and `refreshToken` are
retained (nullable). Any write through `saveOAuthToken()` explicitly
sets them to `null` in the same `upsert`, so a fresh row never carries a
plaintext copy.

## Read path

- **List views** (`getExternalConnections`) use
  `CONNECTOR_METADATA_SELECT` — a strict field whitelist that never
  includes `accessToken`, `refreshToken`, `encryptedSecrets`, or
  `encryptionKeyVersion`. Nothing about the token can reach a client
  component through this action.
- **Outbound HTTP** (`documents.ts` Microsoft Graph mirror) calls
  `decryptConnectorSecret(row, 'accessToken')` at the *moment of the
  fetch*. The plaintext exists only in a local variable, is never
  logged, never persisted, and is eligible for GC as soon as the fetch
  Promise settles.

## Dev vs prod

| Concern | Dev / Test | Production |
|---|---|---|
| KEK | `CONNECTOR_KEK_B64` (32 bytes base64) | KMS (`AWS_KMS_KEY_ID`) |
| Boot on missing KEK | ephemeral key + warning | hard fail |
| Cost per encrypt | free | 1 KMS `Encrypt` call |
| Cost per decrypt | free | 1 KMS `Decrypt` call |
| Rotation | change env var + run script | rotate KMS key + run script |

### Setting up dev

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# copy the output into .env:
CONNECTOR_KEK_B64=<...>
```

### Setting up production

1. Provision a KMS key (symmetric, region matches `AWS_REGION`).
2. Grant the app's IAM role `kms:Encrypt` and `kms:Decrypt` on the key.
3. Set `AWS_KMS_KEY_ID` in the app environment (an alias like
   `alias/valuvault-connector-secrets` is preferred over an ARN — the
   alias survives rotations).
4. Do **not** set `CONNECTOR_KEK_B64` in production. The provider
   factory refuses to pick the KMS path if it sees a local key.

## Migration (existing plaintext rows)

Slice 3 adds two nullable columns; it does not touch existing data. Old
rows keep their plaintext `accessToken`/`refreshToken` and remain
readable via the fallback branch in `decryptConnectorSecret`.

To migrate:

```
# Apply the DDL:
psql --file docs/migrations/slice-3-connector-encryption.sql
# or:    npx prisma db push

# Configure the KEK env vars.

# Dry-run:
npx tsx scripts/migrate-connector-secrets.ts

# Persist:
npx tsx scripts/migrate-connector-secrets.ts --apply
```

The script updates each row atomically — populates
`encryptedSecrets`/`encryptionKeyVersion` **and** nulls the plaintext
columns in the same `update`. Re-running is idempotent. It never logs a
token; failures print only the row id.

## Key rotation

### Rotating a KMS KEK

The KMS approach makes rotation cheap because the wrapped DEK is
opaque to us:

1. **Provision** the new KMS key. Grant the app's IAM role
   `kms:Encrypt` + `kms:Decrypt` on it.
2. **Point the alias**: `aws kms update-alias --alias-name
   alias/valuvault-connector-secrets --target-key-id
   <new-key-id>`. If you use an alias in `AWS_KMS_KEY_ID`, no code
   change is needed.
3. **Deploy**. New writes now wrap with the new key. Existing rows
   still decrypt because KMS's `Decrypt` picks the correct key from
   the wrapped DEK blob.
4. **Re-encrypt existing rows** at your leisure. A rotation variant of
   `scripts/migrate-connector-secrets.ts` (see the follow-up work
   below) can iterate rows where `encryptionKeyVersion` still points at
   the old alias/ARN, decrypt them, and re-encrypt.
5. **Retire the old key** in KMS after the re-encrypt job has drained
   every row.

### Rotating a local dev KEK

Because the local KEK is *the* KEK (no wrapped DEK indirection to a
service that still knows the old key), a rotation without a re-encrypt
pass loses data. Procedure:

1. Generate a new `CONNECTOR_KEK_B64`.
2. Set `OLD_CONNECTOR_KEK_B64` = the current value (so a follow-up
   rotation script can accept two keys). *(Multi-key support is not
   built in Slice 3 — for now, migrate all rows before rotating.)*
3. Re-encrypt via the migration script.
4. Swap `CONNECTOR_KEK_B64` in the env.

## Follow-up work (planned, not in Slice 3)

- Rotation-oriented variant of `scripts/migrate-connector-secrets.ts`
  that accepts an `--old-key-version` filter.
- Multi-key `LocalKekProvider` accepting a comma-separated list so
  rotation can proceed without a maintenance window.
- Envelope-encrypt sensitive fields in future connectors (Google
  Drive, Slack, Notion, etc.) using the same helper — no new schema
  needed, just add fields to the `secrets` map.
- Structured metric on `kms:Encrypt` / `kms:Decrypt` call counts once
  Slice 11 (observability) lands.
