-- ─────────────────────────────────────────────────────────────────────────
-- Slice 6 — Tamper-Evident Audit Ledger
-- Manual migration script (MySQL). Purely additive.
--
-- HOW TO APPLY
-- ------------
-- Dev / staging:  npx prisma db push
-- Production:     apply this SQL inside a transaction and verify with:
--                     DESCRIBE `AuditLog`;
--                     SHOW INDEX FROM `AuditLog`;
--
-- No data movement is required. Existing AuditLog rows keep all five new
-- columns NULL and are treated by the verifier as "pre-chain" (skipped,
-- not counted as tamper). Any AuditLog write from Slice-6 code onward
-- joins the hash chain.
-- ─────────────────────────────────────────────────────────────────────────

START TRANSACTION;

ALTER TABLE `AuditLog`
  ADD COLUMN `chainKey`     VARCHAR(191) NULL,
  ADD COLUMN `sequence`     INT          NULL,
  ADD COLUMN `previousHash` VARCHAR(64)  NULL,
  ADD COLUMN `eventHash`    VARCHAR(64)  NULL,
  ADD COLUMN `hashVersion`  VARCHAR(8)   NULL;

CREATE INDEX `AuditLog_chainKey_sequence_idx` ON `AuditLog` (`chainKey`, `sequence`);
CREATE UNIQUE INDEX `AuditLog_chainKey_sequence_key` ON `AuditLog` (`chainKey`, `sequence`);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Roll-back
-- ─────────────────────────────────────────────────────────────────────────
-- START TRANSACTION;
-- DROP INDEX `AuditLog_chainKey_sequence_key` ON `AuditLog`;
-- DROP INDEX `AuditLog_chainKey_sequence_idx` ON `AuditLog`;
-- ALTER TABLE `AuditLog`
--   DROP COLUMN `hashVersion`,
--   DROP COLUMN `eventHash`,
--   DROP COLUMN `previousHash`,
--   DROP COLUMN `sequence`,
--   DROP COLUMN `chainKey`;
-- COMMIT;
