-- ─────────────────────────────────────────────────────────────────────────
-- Slice 9 — Financial Tie-Out Engine
-- Manual migration script (MySQL). Purely additive.
--
-- HOW TO APPLY
-- ------------
-- Dev / staging:  npx prisma db push
-- Production:     apply this SQL inside a transaction and verify with:
--                     SHOW TABLES LIKE 'TieOut';
--                     SHOW TABLES LIKE 'TieOutItem';
-- ─────────────────────────────────────────────────────────────────────────

START TRANSACTION;

CREATE TABLE `TieOut` (
  `id`                VARCHAR(191) NOT NULL,
  `caseId`            VARCHAR(191) NOT NULL,
  `concept`           VARCHAR(191) NOT NULL,
  `year`              VARCHAR(191) NOT NULL,
  `toleranceAbsolute` DECIMAL(19, 4) NULL,
  `tolerancePercent`  DECIMAL(9,  6) NULL,
  `status`            VARCHAR(191) NOT NULL DEFAULT 'UNRESOLVED',
  `maxDifference`     DECIMAL(19, 4) NULL,
  `resolvedBy`        VARCHAR(191) NULL,
  `resolvedAt`        DATETIME(3)  NULL,
  `resolutionNote`    TEXT         NULL,
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `TieOut_caseId_concept_year_key` (`caseId`, `concept`, `year`),
  INDEX `TieOut_caseId_status_idx` (`caseId`, `status`),
  INDEX `TieOut_status_idx`        (`status`),
  CONSTRAINT `TieOut_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE `TieOutItem` (
  `id`                VARCHAR(191)   NOT NULL,
  `tieOutId`          VARCHAR(191)   NOT NULL,
  `sourceLabel`       VARCHAR(191)   NOT NULL,
  `value`             DECIMAL(19, 4) NOT NULL,
  `financialValueId`  VARCHAR(191)   NULL,
  `documentVersionId` VARCHAR(191)   NULL,
  `createdAt`         DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `TieOutItem_tieOutId_idx`          (`tieOutId`),
  INDEX `TieOutItem_financialValueId_idx`  (`financialValueId`),
  INDEX `TieOutItem_documentVersionId_idx` (`documentVersionId`),
  CONSTRAINT `TieOutItem_tieOutId_fkey`
    FOREIGN KEY (`tieOutId`) REFERENCES `TieOut` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TieOutItem_financialValueId_fkey`
    FOREIGN KEY (`financialValueId`) REFERENCES `FinancialValue` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `TieOutItem_documentVersionId_fkey`
    FOREIGN KEY (`documentVersionId`) REFERENCES `DocumentVersion` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Roll-back
-- ─────────────────────────────────────────────────────────────────────────
-- START TRANSACTION;
-- DROP TABLE `TieOutItem`;
-- DROP TABLE `TieOut`;
-- COMMIT;
