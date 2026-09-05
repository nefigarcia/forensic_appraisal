-- ─────────────────────────────────────────────────────────────────────────
-- Slice 5 — Immutable Evidence and Document Versioning
-- Manual migration script (MySQL). Purely additive.
--
-- HOW TO APPLY
-- ------------
-- Dev / staging:  npx prisma db push
-- Production:     apply this SQL inside the transaction, then run
--                     npx tsx scripts/migrate-documents-to-versions.ts --apply
--                 to backfill a v1 DocumentVersion for every existing
--                 Document row.
-- ─────────────────────────────────────────────────────────────────────────

START TRANSACTION;

-- ── Document: archival + current-version pointer ──────────────────────
ALTER TABLE `Document`
  ADD COLUMN `currentVersionId` VARCHAR(191) NULL,
  ADD COLUMN `isArchived`       TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN `archivedAt`       DATETIME(3)  NULL,
  ADD COLUMN `archivedBy`       VARCHAR(191) NULL,
  ADD COLUMN `archiveReason`    TEXT         NULL,
  ADD COLUMN `updatedAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

CREATE INDEX `Document_caseId_isArchived_idx` ON `Document` (`caseId`, `isArchived`);

-- ── DocumentVersion ──────────────────────────────────────────────────
CREATE TABLE `DocumentVersion` (
  `id`            VARCHAR(191) NOT NULL,
  `documentId`    VARCHAR(191) NOT NULL,
  `versionNumber` INT          NOT NULL,
  `s3Key`         VARCHAR(191) NOT NULL,
  `sha256Hash`    VARCHAR(191) NOT NULL,
  `sizeBytes`     BIGINT       NOT NULL,
  `mimeType`      VARCHAR(191) NOT NULL,
  `originalName`  VARCHAR(191) NOT NULL,
  `uploadedBy`    VARCHAR(191) NOT NULL,
  `uploadedAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `scanStatus`    VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `scanReport`    TEXT         NULL,
  `scannedAt`     DATETIME(3)  NULL,
  `isArchived`    TINYINT(1)   NOT NULL DEFAULT 0,
  `archivedAt`    DATETIME(3)  NULL,
  `archivedBy`    VARCHAR(191) NULL,
  `archiveReason` TEXT         NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DocumentVersion_documentId_versionNumber_key` (`documentId`, `versionNumber`),
  INDEX `DocumentVersion_sha256Hash_idx` (`sha256Hash`),
  INDEX `DocumentVersion_documentId_isArchived_idx` (`documentId`, `isArchived`),
  CONSTRAINT `DocumentVersion_documentId_fkey`
    FOREIGN KEY (`documentId`) REFERENCES `Document` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

-- ── Foreign key from Document.currentVersionId back to DocumentVersion.id
--    Added AFTER the DocumentVersion table exists.
ALTER TABLE `Document`
  ADD CONSTRAINT `Document_currentVersionId_fkey`
    FOREIGN KEY (`currentVersionId`) REFERENCES `DocumentVersion` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Roll-back
-- ─────────────────────────────────────────────────────────────────────────
-- START TRANSACTION;
-- ALTER TABLE `Document` DROP FOREIGN KEY `Document_currentVersionId_fkey`;
-- DROP TABLE `DocumentVersion`;
-- ALTER TABLE `Document`
--   DROP INDEX `Document_caseId_isArchived_idx`,
--   DROP COLUMN `updatedAt`,
--   DROP COLUMN `archiveReason`,
--   DROP COLUMN `archivedBy`,
--   DROP COLUMN `archivedAt`,
--   DROP COLUMN `isArchived`,
--   DROP COLUMN `currentVersionId`;
-- COMMIT;
