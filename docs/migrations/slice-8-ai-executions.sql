-- ─────────────────────────────────────────────────────────────────────────
-- Slice 8 — AI Execution Registry and Reproducibility
-- Manual migration script (MySQL). Purely additive.
--
-- HOW TO APPLY
-- ------------
-- Dev / staging:  npx prisma db push
-- Production:     apply this SQL inside a transaction and verify with:
--                     SHOW TABLES LIKE 'AiExecution';
--                     DESCRIBE `FinancialValue`;
-- ─────────────────────────────────────────────────────────────────────────

START TRANSACTION;

-- ── AiExecution ──────────────────────────────────────────────────────
CREATE TABLE `AiExecution` (
  `id`                 VARCHAR(191) NOT NULL,
  `organizationId`     VARCHAR(191) NOT NULL,
  `caseId`             VARCHAR(191) NULL,
  `userId`             VARCHAR(191) NOT NULL,
  `flowName`           VARCHAR(191) NOT NULL,
  `flowVersion`        VARCHAR(191) NULL,
  `promptTemplateHash` VARCHAR(191) NULL,
  `promptTemplateKey`  VARCHAR(191) NULL,
  `modelProvider`      VARCHAR(191) NOT NULL,
  `modelName`          VARCHAR(191) NOT NULL,
  `modelVersion`       VARCHAR(191) NULL,
  `inputHash`          VARCHAR(191) NOT NULL,
  `outputHash`         VARCHAR(191) NULL,
  `documentVersionIds` JSON         NULL,
  `startedAt`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt`        DATETIME(3)  NULL,
  `durationMs`         INT          NULL,
  `status`             VARCHAR(191) NOT NULL DEFAULT 'RUNNING',
  `errorCategory`      VARCHAR(191) NULL,
  `errorMessage`       TEXT         NULL,
  `inputTokens`        INT          NULL,
  `outputTokens`       INT          NULL,
  `totalTokens`        INT          NULL,
  `estimatedCostUsd`   DECIMAL(10, 6) NULL,
  `reviewStatus`       VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `reviewedBy`         VARCHAR(191) NULL,
  `reviewedAt`         DATETIME(3)  NULL,
  `createdAt`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `AiExecution_organizationId_createdAt_idx` (`organizationId`, `createdAt`),
  INDEX `AiExecution_caseId_createdAt_idx`         (`caseId`, `createdAt`),
  INDEX `AiExecution_userId_idx`                   (`userId`),
  INDEX `AiExecution_flowName_createdAt_idx`       (`flowName`, `createdAt`),
  INDEX `AiExecution_status_idx`                   (`status`),
  CONSTRAINT `AiExecution_organizationId_fkey`
    FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `AiExecution_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `AiExecution_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

-- ── FinancialValue.aiExecutionId ─────────────────────────────────────
ALTER TABLE `FinancialValue`
  ADD COLUMN `aiExecutionId` VARCHAR(191) NULL,
  ADD CONSTRAINT `FinancialValue_aiExecutionId_fkey`
    FOREIGN KEY (`aiExecutionId`) REFERENCES `AiExecution` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `FinancialValue_aiExecutionId_idx` ON `FinancialValue` (`aiExecutionId`);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Roll-back
-- ─────────────────────────────────────────────────────────────────────────
-- START TRANSACTION;
-- DROP INDEX `FinancialValue_aiExecutionId_idx` ON `FinancialValue`;
-- ALTER TABLE `FinancialValue`
--   DROP FOREIGN KEY `FinancialValue_aiExecutionId_fkey`,
--   DROP COLUMN `aiExecutionId`;
-- DROP TABLE `AiExecution`;
-- COMMIT;
