-- ─────────────────────────────────────────────────────────────────────────
-- Slice 10 — Earnings Normalization Workbench
-- Manual migration script (MySQL). Additive with one in-place backfill on
-- the new `status` column to reflect existing `isApproved` values.
--
-- HOW TO APPLY
-- ------------
-- Dev / staging:  npx prisma db push  (skips the backfill — apply it manually)
-- Production:     apply this SQL inside a transaction and verify with:
--                     DESCRIBE `AddBack`;
--                     SELECT status, COUNT(*) FROM `AddBack` GROUP BY status;
-- ─────────────────────────────────────────────────────────────────────────

START TRANSACTION;

ALTER TABLE `AddBack`
  ADD COLUMN `status`          VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN `direction`       VARCHAR(191) NOT NULL DEFAULT 'ADD',
  ADD COLUMN `recurring`       VARCHAR(191) NOT NULL DEFAULT 'NONRECURRING',
  ADD COLUMN `taxTreatment`    VARCHAR(191) NULL,
  ADD COLUMN `proposedBy`      VARCHAR(191) NULL,
  ADD COLUMN `reviewedBy`      VARCHAR(191) NULL,
  ADD COLUMN `reviewedAt`      DATETIME(3)  NULL,
  ADD COLUMN `statusChangedAt` DATETIME(3)  NULL,
  ADD COLUMN `rejectionReason` TEXT         NULL;

CREATE INDEX `AddBack_caseId_status_idx` ON `AddBack` (`caseId`, `status`);
CREATE INDEX `AddBack_status_idx`        ON `AddBack` (`status`);

-- Backfill: existing APPROVED add-backs → status='APPROVED', keep isApproved.
-- Rows that were `isApproved=false` remain DRAFT (the schema default).
UPDATE `AddBack`
   SET `status`          = 'APPROVED',
       `reviewedBy`      = COALESCE(`reviewedBy`, `approvedBy`),
       `reviewedAt`      = COALESCE(`reviewedAt`, `updatedAt`),
       `statusChangedAt` = COALESCE(`statusChangedAt`, `updatedAt`)
 WHERE `isApproved` = 1;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Roll-back
-- ─────────────────────────────────────────────────────────────────────────
-- START TRANSACTION;
-- DROP INDEX `AddBack_status_idx`        ON `AddBack`;
-- DROP INDEX `AddBack_caseId_status_idx` ON `AddBack`;
-- ALTER TABLE `AddBack`
--   DROP COLUMN `rejectionReason`,
--   DROP COLUMN `statusChangedAt`,
--   DROP COLUMN `reviewedAt`,
--   DROP COLUMN `reviewedBy`,
--   DROP COLUMN `proposedBy`,
--   DROP COLUMN `taxTreatment`,
--   DROP COLUMN `recurring`,
--   DROP COLUMN `direction`,
--   DROP COLUMN `status`;
-- COMMIT;
