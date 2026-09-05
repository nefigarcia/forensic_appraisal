-- ─────────────────────────────────────────────────────────────────────────
-- Slice 3 — Connector Credential Protection
-- Manual migration script (MySQL). Purely additive.
--
-- HOW TO APPLY
-- ------------
-- Option A (dev / staging):
--     npx prisma db push
--
-- Option B (production, reviewed):
--     Apply this SQL inside a transaction and verify with:
--         DESCRIBE `ExternalConnector`;
--
-- After the schema is live and the app is configured with either
-- `AWS_KMS_KEY_ID` (production) or `CONNECTOR_KEK_B64` (dev), run the
-- one-shot backfill:
--     npx tsx scripts/migrate-connector-secrets.ts --apply
-- ─────────────────────────────────────────────────────────────────────────

START TRANSACTION;

ALTER TABLE `ExternalConnector`
  ADD COLUMN `encryptedSecrets`     JSON         NULL,
  ADD COLUMN `encryptionKeyVersion` VARCHAR(191) NULL;

CREATE INDEX `ExternalConnector_encryptionKeyVersion_idx`
  ON `ExternalConnector` (`encryptionKeyVersion`);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Roll-back
-- ─────────────────────────────────────────────────────────────────────────
-- START TRANSACTION;
-- DROP INDEX `ExternalConnector_encryptionKeyVersion_idx` ON `ExternalConnector`;
-- ALTER TABLE `ExternalConnector`
--   DROP COLUMN `encryptionKeyVersion`,
--   DROP COLUMN `encryptedSecrets`;
-- COMMIT;
