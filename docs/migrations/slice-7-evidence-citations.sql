-- ─────────────────────────────────────────────────────────────────────────
-- Slice 7 — Evidence-Level Financial Citations
-- Manual migration script (MySQL). Purely additive.
--
-- HOW TO APPLY
-- ------------
-- Dev / staging:  npx prisma db push
-- Production:     apply this SQL inside a transaction and verify with:
--                     SHOW TABLES LIKE 'EvidenceCitation';
--                     SHOW INDEX FROM `EvidenceCitation`;
--
-- After the schema is live, backfill citations from the legacy free-text
-- FinancialValue.sourceRef column:
--     npx tsx scripts/migrate-source-refs-to-citations.ts --apply
-- The backfill never parses coordinates out of the free text (Rule 9 —
-- no fabrication); it creates a low-confidence citation whose
-- sourceLabel = <sourceRef>.
-- ─────────────────────────────────────────────────────────────────────────

START TRANSACTION;

CREATE TABLE `EvidenceCitation` (
  `id`                VARCHAR(191) NOT NULL,
  `documentVersionId` VARCHAR(191) NOT NULL,
  `financialValueId`  VARCHAR(191) NULL,
  `addBackId`         VARCHAR(191) NULL,
  `valuationModelId`  VARCHAR(191) NULL,
  `pageNumber`        INT          NULL,
  `sourceLabel`       VARCHAR(191) NULL,
  `tableName`         VARCHAR(191) NULL,
  `rowLabel`          VARCHAR(191) NULL,
  `columnLabel`       VARCHAR(191) NULL,
  `boundingBox`       JSON         NULL,
  `rawText`           TEXT         NULL,
  `extractor`         VARCHAR(191) NULL,
  `extractorVersion`  VARCHAR(191) NULL,
  `confidence`        DOUBLE       NULL,
  `isConfident`       TINYINT(1)   NOT NULL DEFAULT 1,
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `EvidenceCitation_documentVersionId_idx` (`documentVersionId`),
  INDEX `EvidenceCitation_financialValueId_idx`  (`financialValueId`),
  INDEX `EvidenceCitation_addBackId_idx`         (`addBackId`),
  INDEX `EvidenceCitation_valuationModelId_idx`  (`valuationModelId`),
  CONSTRAINT `EvidenceCitation_documentVersionId_fkey`
    FOREIGN KEY (`documentVersionId`) REFERENCES `DocumentVersion` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `EvidenceCitation_financialValueId_fkey`
    FOREIGN KEY (`financialValueId`) REFERENCES `FinancialValue` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `EvidenceCitation_addBackId_fkey`
    FOREIGN KEY (`addBackId`) REFERENCES `AddBack` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `EvidenceCitation_valuationModelId_fkey`
    FOREIGN KEY (`valuationModelId`) REFERENCES `ValuationModel` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Roll-back
-- ─────────────────────────────────────────────────────────────────────────
-- START TRANSACTION;
-- DROP TABLE `EvidenceCitation`;
-- COMMIT;
