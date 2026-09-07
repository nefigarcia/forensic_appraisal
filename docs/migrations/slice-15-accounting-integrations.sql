-- ─────────────────────────────────────────────────
-- Slice 15 — Structured Accounting and Spreadsheet Integrations
-- ─────────────────────────────────────────────────
-- Purely additive except for two extension columns on `FinancialValue`
-- (`origin` and `sourceRowId`). Existing rows default `origin='AI'`
-- (backward-compatible: every legacy value was AI-extracted or hand-
-- entered under the Slice-0 semantics) and `sourceRowId=NULL`.
--
-- New models:
--   AccountingConnector       — per-case QBO/Xero/Sage/NetSuite tokens
--                                (envelope-encrypted via Slice-3 pattern)
--   AccountingIngestionRun    — one row per connector fetch or Excel import
--   AccountingSourceRow       — canonical structured row from any provider
--   ExcelImportRun            — Excel dry-run + apply audit trail
--
-- Rollback: DROP the four new tables + revert the two columns on
-- FinancialValue.
-- ─────────────────────────────────────────────────

-- ── FinancialValue extensions ────────────────────────────────────
ALTER TABLE `FinancialValue`
  ADD COLUMN `origin`      VARCHAR(191) NOT NULL DEFAULT 'AI',
  ADD COLUMN `sourceRowId` VARCHAR(191) NULL;

CREATE INDEX `FinancialValue_caseId_origin_idx`     ON `FinancialValue` (`caseId`, `origin`);
CREATE INDEX `FinancialValue_sourceRowId_idx`       ON `FinancialValue` (`sourceRowId`);

-- Per-case connectors
CREATE TABLE `AccountingConnector` (
  `id`                    VARCHAR(191) NOT NULL,
  `organizationId`        VARCHAR(191) NOT NULL,
  `caseId`                VARCHAR(191) NOT NULL,
  `provider`              VARCHAR(191) NOT NULL,
  `providerAccountId`     VARCHAR(191) NOT NULL,
  `providerAccountLabel`  VARCHAR(191) NULL,
  `encryptedSecrets`      JSON NULL,
  `encryptionKeyVersion`  VARCHAR(191) NULL,
  `expiresAt`             DATETIME(3) NULL,
  `status`                VARCHAR(191) NOT NULL DEFAULT 'CONNECTED',
  `connectedBy`           VARCHAR(191) NOT NULL,
  `connectedAt`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSyncAt`            DATETIME(3) NULL,
  `createdAt`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`             DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AccountingConnector_caseId_provider_providerAccountId_key`
    (`caseId`, `provider`, `providerAccountId`),
  INDEX `AccountingConnector_organizationId_provider_idx` (`organizationId`, `provider`),
  INDEX `AccountingConnector_caseId_provider_idx`        (`caseId`, `provider`),
  INDEX `AccountingConnector_encryptionKeyVersion_idx`   (`encryptionKeyVersion`),
  CONSTRAINT `AccountingConnector_organizationId_fkey`
    FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE,
  CONSTRAINT `AccountingConnector_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE
);

-- Excel run row — created BEFORE the ingestion run so we can link back
CREATE TABLE `ExcelImportRun` (
  `id`                VARCHAR(191) NOT NULL,
  `caseId`            VARCHAR(191) NOT NULL,
  `templateKind`      VARCHAR(191) NOT NULL,
  `templateVersion`   VARCHAR(191) NOT NULL,
  `filename`          VARCHAR(191) NOT NULL,
  `fileSha256`        VARCHAR(64) NOT NULL,
  `detectedCaseId`    VARCHAR(191) NULL,
  `status`            VARCHAR(191) NOT NULL DEFAULT 'PENDING_REVIEW',
  `triggeredBy`       VARCHAR(191) NOT NULL,
  `createdAt`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedAt`        DATETIME(3) NULL,
  `reviewedBy`        VARCHAR(191) NULL,
  `appliedAt`         DATETIME(3) NULL,
  `appliedBy`         VARCHAR(191) NULL,
  `validationSummary` JSON NULL,
  `proposedChanges`   JSON NULL,
  `diffSummary`       JSON NULL,
  PRIMARY KEY (`id`),
  INDEX `ExcelImportRun_caseId_templateKind_idx` (`caseId`, `templateKind`),
  INDEX `ExcelImportRun_caseId_status_idx`       (`caseId`, `status`),
  CONSTRAINT `ExcelImportRun_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE
);

CREATE TABLE `AccountingIngestionRun` (
  `id`                VARCHAR(191) NOT NULL,
  `caseId`            VARCHAR(191) NOT NULL,
  `connectorId`       VARCHAR(191) NULL,
  `provider`          VARCHAR(191) NOT NULL,
  `reportType`        VARCHAR(191) NOT NULL,
  `periodLabel`       VARCHAR(191) NULL,
  `status`            VARCHAR(191) NOT NULL DEFAULT 'RUNNING',
  `rowsIngested`      INT NOT NULL DEFAULT 0,
  `triggeredBy`       VARCHAR(191) NOT NULL,
  `startedAt`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt`       DATETIME(3) NULL,
  `errorCategory`     VARCHAR(191) NULL,
  `errorMessage`      TEXT NULL,
  `excelImportRunId`  VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AccountingIngestionRun_excelImportRunId_key` (`excelImportRunId`),
  INDEX `AccountingIngestionRun_caseId_provider_idx`   (`caseId`, `provider`),
  INDEX `AccountingIngestionRun_caseId_reportType_idx` (`caseId`, `reportType`),
  INDEX `AccountingIngestionRun_connectorId_idx`       (`connectorId`),
  CONSTRAINT `AccountingIngestionRun_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE,
  CONSTRAINT `AccountingIngestionRun_connectorId_fkey`
    FOREIGN KEY (`connectorId`) REFERENCES `AccountingConnector`(`id`) ON DELETE SET NULL,
  CONSTRAINT `AccountingIngestionRun_excelImportRunId_fkey`
    FOREIGN KEY (`excelImportRunId`) REFERENCES `ExcelImportRun`(`id`) ON DELETE SET NULL
);

CREATE TABLE `AccountingSourceRow` (
  `id`              VARCHAR(191) NOT NULL,
  `caseId`          VARCHAR(191) NOT NULL,
  `connectorId`     VARCHAR(191) NULL,
  `ingestionRunId`  VARCHAR(191) NOT NULL,
  `provider`        VARCHAR(191) NOT NULL,
  `reportType`      VARCHAR(191) NOT NULL,
  `externalRowId`   VARCHAR(191) NULL,
  `accountCode`     VARCHAR(191) NULL,
  `accountName`     VARCHAR(191) NOT NULL,
  `category`        VARCHAR(191) NULL,
  `period`          VARCHAR(191) NOT NULL,
  `amountDecimal`   DECIMAL(19,4) NULL,
  `currency`        VARCHAR(191) NOT NULL DEFAULT 'USD',
  `rawPayload`      JSON NULL,
  `ingestedAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ingestedBy`      VARCHAR(191) NULL,
  `status`          VARCHAR(191) NOT NULL DEFAULT 'PENDING_PROMOTION',
  PRIMARY KEY (`id`),
  INDEX `AccountingSourceRow_caseId_provider_reportType_idx` (`caseId`, `provider`, `reportType`),
  INDEX `AccountingSourceRow_ingestionRunId_idx`             (`ingestionRunId`),
  INDEX `AccountingSourceRow_caseId_status_idx`              (`caseId`, `status`),
  INDEX `AccountingSourceRow_caseId_provider_externalRowId_idx`
    (`caseId`, `provider`, `externalRowId`),
  CONSTRAINT `AccountingSourceRow_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE,
  CONSTRAINT `AccountingSourceRow_connectorId_fkey`
    FOREIGN KEY (`connectorId`) REFERENCES `AccountingConnector`(`id`) ON DELETE SET NULL,
  CONSTRAINT `AccountingSourceRow_ingestionRunId_fkey`
    FOREIGN KEY (`ingestionRunId`) REFERENCES `AccountingIngestionRun`(`id`) ON DELETE CASCADE
);

ALTER TABLE `FinancialValue`
  ADD CONSTRAINT `FinancialValue_sourceRowId_fkey`
    FOREIGN KEY (`sourceRowId`) REFERENCES `AccountingSourceRow`(`id`) ON DELETE SET NULL;
