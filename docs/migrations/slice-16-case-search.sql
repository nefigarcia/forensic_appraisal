-- ─────────────────────────────────────────────────
-- Slice 16 — Institutional Valuation Intelligence
-- ─────────────────────────────────────────────────
-- Purely additive except for three nullable geography columns on
-- `Case`. Every existing case starts with NULL geography and no
-- `CaseSearchIndex` row — the search returns them once an analyst
-- fills in subjectState / subjectCity / subjectCountry OR the case's
-- Slice-13/14 workflow triggers a refresh.
--
-- Rollback: drop the two new tables + revert the three columns on Case.
-- ─────────────────────────────────────────────────

ALTER TABLE `Case`
  ADD COLUMN `subjectState`   VARCHAR(191) NULL,
  ADD COLUMN `subjectCity`    VARCHAR(191) NULL,
  ADD COLUMN `subjectCountry` VARCHAR(191) NULL;

-- Denormalized per-case search index. One row per Case; refreshed by
-- `refreshCaseSearchIndex` after material lifecycle events.
CREATE TABLE `CaseSearchIndex` (
  `caseId`                    VARCHAR(191) NOT NULL,
  `organizationId`            VARCHAR(191) NOT NULL,
  `hasEngagementTeam`         TINYINT(1) NOT NULL DEFAULT 0,
  `caseName`                  VARCHAR(191) NOT NULL,
  `clientName`                VARCHAR(191) NOT NULL,
  `engagementType`            VARCHAR(191) NULL,
  `caseStatus`                VARCHAR(191) NULL,
  `subjectState`              VARCHAR(191) NULL,
  `subjectCity`               VARCHAR(191) NULL,
  `subjectCountry`            VARCHAR(191) NULL,
  `naicsCode`                 VARCHAR(191) NULL,
  `sicCode`                   VARCHAR(191) NULL,
  `industryLabel`             VARCHAR(191) NULL,
  `valuationDate`             DATETIME(3) NULL,
  `reportDueDate`             DATETIME(3) NULL,
  `reportFinalizedAt`         DATETIME(3) NULL,
  `reportStatus`              VARCHAR(191) NULL,
  `methodsApplied`            JSON NULL,
  `approvedAddBackCategories` JSON NULL,
  `hasRelatedPartyAddBack`    TINYINT(1) NOT NULL DEFAULT 0,
  `approvedAssumptions`       JSON NULL,
  `approvedDlocPercent`       DECIMAL(9,6) NULL,
  `approvedDlomPercent`       DECIMAL(9,6) NULL,
  `concludedEnterpriseValue`  DECIMAL(19,4) NULL,
  `concludedEquityValue`      DECIMAL(19,4) NULL,
  `concludedOwnershipValue`   DECIMAL(19,4) NULL,
  `documentCount`             INT NOT NULL DEFAULT 0,
  `documentCategories`        JSON NULL,
  `refreshedAt`               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `refreshedBy`               VARCHAR(191) NULL,
  PRIMARY KEY (`caseId`),
  INDEX `CaseSearchIndex_organizationId_hasEngagementTeam_idx`      (`organizationId`, `hasEngagementTeam`),
  INDEX `CaseSearchIndex_organizationId_naicsCode_idx`              (`organizationId`, `naicsCode`),
  INDEX `CaseSearchIndex_organizationId_subjectState_idx`           (`organizationId`, `subjectState`),
  INDEX `CaseSearchIndex_organizationId_valuationDate_idx`          (`organizationId`, `valuationDate`),
  INDEX `CaseSearchIndex_organizationId_reportStatus_idx`           (`organizationId`, `reportStatus`),
  INDEX `CaseSearchIndex_organizationId_hasRelatedPartyAddBack_idx` (`organizationId`, `hasRelatedPartyAddBack`),
  INDEX `CaseSearchIndex_organizationId_approvedDlomPercent_idx`    (`organizationId`, `approvedDlomPercent`),
  INDEX `CaseSearchIndex_organizationId_approvedDlocPercent_idx`    (`organizationId`, `approvedDlocPercent`),
  CONSTRAINT `CaseSearchIndex_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE
);

CREATE TABLE `AiCaseSearchRun` (
  `id`               VARCHAR(191) NOT NULL,
  `organizationId`   VARCHAR(191) NOT NULL,
  `userId`           VARCHAR(191) NOT NULL,
  `question`         TEXT NOT NULL,
  `proposedFilters`  JSON NOT NULL,
  `executedFilters`  JSON NULL,
  `returnedCaseIds`  JSON NULL,
  `aiExecutionId`    VARCHAR(191) NULL,
  `isConfident`      TINYINT(1) NOT NULL DEFAULT 1,
  `fallbackReason`   TEXT NULL,
  `createdAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `AiCaseSearchRun_organizationId_createdAt_idx` (`organizationId`, `createdAt`),
  INDEX `AiCaseSearchRun_userId_idx`                   (`userId`),
  INDEX `AiCaseSearchRun_aiExecutionId_idx`            (`aiExecutionId`),
  CONSTRAINT `AiCaseSearchRun_organizationId_fkey`
    FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE,
  CONSTRAINT `AiCaseSearchRun_aiExecutionId_fkey`
    FOREIGN KEY (`aiExecutionId`) REFERENCES `AiExecution`(`id`) ON DELETE SET NULL
);
