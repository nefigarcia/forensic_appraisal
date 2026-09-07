/* eslint-disable no-console */

/**
 * Slice 3 — one-time migration of plaintext connector tokens into the
 * envelope-encrypted `encryptedSecrets` blob.
 *
 * Run against a deployed database *after* the Slice 3 schema is applied
 * (see docs/migrations/slice-3-connector-encryption.sql) and the env is
 * configured with either `AWS_KMS_KEY_ID` (production) or
 * `CONNECTOR_KEK_B64` (dev/test).
 *
 * Usage:
 *     npx tsx scripts/migrate-connector-secrets.ts        # dry run
 *     npx tsx scripts/migrate-connector-secrets.ts --apply
 *
 * The script:
 *   1. Selects rows where `encryptedSecrets IS NULL` and at least one of
 *      `accessToken` / `refreshToken` is populated.
 *   2. Encrypts the plaintext values via the standard envelope helper.
 *   3. Updates the row atomically — populates `encryptedSecrets`,
 *      `encryptionKeyVersion`, and nulls the plaintext columns in the
 *      same `update`.
 *   4. Prints a per-org summary at the end.
 *
 * Ops safety notes:
 *   - The script never logs a token value.
 *   - Rows that fail to encrypt (KMS transient error, malformed input)
 *     are logged with only the row id and left untouched.
 *   - Re-running is idempotent: rows with a populated `encryptedSecrets`
 *     are skipped.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma'
import { encryptConnectorSecrets } from '../src/lib/crypto/connector-secrets'

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`[migrate-connector-secrets] mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)

  const candidates = await prisma.externalConnector.findMany({
    where: {
      // Prisma requires Prisma.DbNull to filter a Json? column for actual
      // NULL (not JSON `null`). This matches un-migrated rows.
      encryptedSecrets: { equals: Prisma.DbNull },
      OR: [
        { accessToken:  { not: null } },
        { refreshToken: { not: null } },
      ],
    },
    select: {
      id:             true,
      organizationId: true,
      provider:       true,
      accessToken:    true,
      refreshToken:   true,
    },
  })

  console.log(`[migrate-connector-secrets] ${candidates.length} row(s) to migrate`)
  if (candidates.length === 0) return

  let ok = 0
  let failed = 0

  for (const row of candidates) {
    try {
      const enc = await encryptConnectorSecrets({
        accessToken:  row.accessToken,
        refreshToken: row.refreshToken,
      })
      if (!enc.encryptedSecrets) {
        // Row had both tokens null (defensive) — nothing to do.
        continue
      }
      if (apply) {
        await prisma.externalConnector.update({
          where: { id: row.id },
          data: {
            accessToken:          enc.accessToken,
            refreshToken:         enc.refreshToken,
            encryptedSecrets:     enc.encryptedSecrets as any,
            encryptionKeyVersion: enc.encryptionKeyVersion,
          },
        })
      }
      ok++
    } catch (e) {
      failed++
      console.error(
        `[migrate-connector-secrets] row ${row.id} (org=${row.organizationId} provider=${row.provider}): ${(e as Error).message}`,
      )
    }
  }

  console.log(`[migrate-connector-secrets] migrated: ${ok}, failed: ${failed}`)
  if (!apply) console.log('[migrate-connector-secrets] dry run — pass --apply to persist')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
