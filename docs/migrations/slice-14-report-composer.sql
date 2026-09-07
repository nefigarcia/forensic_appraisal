-- ─────────────────────────────────────────────────
-- Slice 14 — Evidence-Grounded Report Composer
-- ─────────────────────────────────────────────────
-- Purely additive. Every new table has FKs to existing tables with
-- CASCADE / SET NULL semantics that leave existing rows untouched.
--
-- Composition:
--   Report (1:1 with Case)
--     └── ReportSection (per section key)
--           └── ReportSectionVersion (append-only edit history)
--                 └── ReportCitation (grounding evidence)
--     └── ReportVersion (labeled snapshot with frozen facts hash)
--     └── ReportChecklistItem (per-report copies of standards items)
--
-- Firm-owned templates:
--   StandardsChecklist / StandardsChecklistItem (per organization,
--     configurable; NOT a compliance certification).
--
-- No data backfill. Existing cases open with `report = NULL` until
-- an analyst calls initializeReport.
-- ─────────────────────────────────────────────────

CREATE TABLE `Report` (
  `id`               VARCHAR(191) NOT NULL,
  `caseId`           VARCHAR(191) NOT NULL,
  `title`            VARCHAR(191) NOT NULL,
  `status`           VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  `createdBy`        VARCHAR(191) NOT NULL,
  `finalizedBy`      VARCHAR(191) NULL,
  `finalizedAt`      DATETIME(3) NULL,
  `templateKey`      VARCHAR(191) NULL,
  `standardsFamily`  VARCHAR(191) NULL,
  `currentVersionId` VARCHAR(191) NULL,
  `createdAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Report_caseId_key` (`caseId`),
  INDEX `Report_caseId_idx` (`caseId`),
  CONSTRAINT `Report_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE
);

CREATE TABLE `ReportVersion` (
  `id`             VARCHAR(191) NOT NULL,
  `reportId`       VARCHAR(191) NOT NULL,
  `versionNumber`  INT NOT NULL,
  `label`          VARCHAR(191) NULL,
  `factsHash`      VARCHAR(64) NOT NULL,
  `factsSnapshot`  JSON NOT NULL,
  `compiledBody`   LONGTEXT NULL,
  `createdBy`      VARCHAR(191) NOT NULL,
  `frozenAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ReportVersion_reportId_versionNumber_key` (`reportId`, `versionNumber`),
  INDEX `ReportVersion_reportId_frozenAt_idx` (`reportId`, `frozenAt`),
  CONSTRAINT `ReportVersion_reportId_fkey`
    FOREIGN KEY (`reportId`) REFERENCES `Report`(`id`) ON DELETE CASCADE
);

ALTER TABLE `Report`
  ADD CONSTRAINT `Report_currentVersionId_fkey`
    FOREIGN KEY (`currentVersionId`) REFERENCES `ReportVersion`(`id`) ON DELETE SET NULL;

CREATE TABLE `ReportSection` (
  `id`              VARCHAR(191) NOT NULL,
  `reportId`        VARCHAR(191) NOT NULL,
  `key`             VARCHAR(191) NOT NULL,
  `title`           VARCHAR(191) NOT NULL,
  `displayOrder`    INT NOT NULL DEFAULT 0,
  `isRequired`      TINYINT(1) NOT NULL DEFAULT 1,
  `status`          VARCHAR(191) NOT NULL DEFAULT 'NOT_STARTED',
  `currentBody`     LONGTEXT NULL,
  `currentFactsHash` VARCHAR(64) NULL,
  `updatedAt`       DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ReportSection_reportId_key_key` (`reportId`, `key`),
  INDEX `ReportSection_reportId_status_idx` (`reportId`, `status`),
  CONSTRAINT `ReportSection_reportId_fkey`
    FOREIGN KEY (`reportId`) REFERENCES `Report`(`id`) ON DELETE CASCADE
);

CREATE TABLE `ReportSectionVersion` (
  `id`               VARCHAR(191) NOT NULL,
  `sectionId`        VARCHAR(191) NOT NULL,
  `reportVersionId`  VARCHAR(191) NULL,
  `status`           VARCHAR(191) NOT NULL,
  `body`             LONGTEXT NOT NULL,
  `aiExecutionId`    VARCHAR(191) NULL,
  `missingInformation` JSON NULL,
  `isConfident`      TINYINT(1) NOT NULL DEFAULT 1,
  `factsHash`        VARCHAR(64) NULL,
  `authorUserId`     VARCHAR(191) NOT NULL,
  `approvedBy`       VARCHAR(191) NULL,
  `approvedAt`       DATETIME(3) NULL,
  `createdAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ReportSectionVersion_sectionId_createdAt_idx` (`sectionId`, `createdAt`),
  INDEX `ReportSectionVersion_aiExecutionId_idx` (`aiExecutionId`),
  CONSTRAINT `ReportSectionVersion_sectionId_fkey`
    FOREIGN KEY (`sectionId`) REFERENCES `ReportSection`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ReportSectionVersion_reportVersionId_fkey`
    FOREIGN KEY (`reportVersionId`) REFERENCES `ReportVersion`(`id`) ON DELETE SET NULL,
  CONSTRAINT `ReportSectionVersion_aiExecutionId_fkey`
    FOREIGN KEY (`aiExecutionId`) REFERENCES `AiExecution`(`id`) ON DELETE SET NULL
);

CREATE TABLE `ReportCitation` (
  `id`               VARCHAR(191) NOT NULL,
  `sectionVersionId` VARCHAR(191) NOT NULL,
  `targetType`       VARCHAR(191) NOT NULL,
  `targetId`         VARCHAR(191) NOT NULL,
  `snippet`          TEXT NULL,
  `isConfident`      TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ReportCitation_sectionVersionId_idx` (`sectionVersionId`),
  INDEX `ReportCitation_targetType_targetId_idx` (`targetType`, `targetId`),
  CONSTRAINT `ReportCitation_sectionVersionId_fkey`
    FOREIGN KEY (`sectionVersionId`) REFERENCES `ReportSectionVersion`(`id`) ON DELETE CASCADE
);

CREATE TABLE `StandardsChecklist` (
  `id`              VARCHAR(191) NOT NULL,
  `organizationId`  VARCHAR(191) NOT NULL,
  `standardsFamily` VARCHAR(191) NOT NULL,
  `name`            VARCHAR(191) NOT NULL,
  `description`     TEXT NULL,
  `disclaimer`      TEXT NULL,
  `isSystem`        TINYINT(1) NOT NULL DEFAULT 0,
  `createdBy`       VARCHAR(191) NULL,
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `StandardsChecklist_organizationId_idx` (`organizationId`),
  INDEX `StandardsChecklist_organizationId_standardsFamily_idx` (`organizationId`, `standardsFamily`),
  CONSTRAINT `StandardsChecklist_organizationId_fkey`
    FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE
);

CREATE TABLE `StandardsChecklistItem` (
  `id`           VARCHAR(191) NOT NULL,
  `checklistId`  VARCHAR(191) NOT NULL,
  `key`          VARCHAR(191) NOT NULL,
  `title`        VARCHAR(191) NOT NULL,
  `guidance`     TEXT NULL,
  `displayOrder` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `StandardsChecklistItem_checklistId_idx` (`checklistId`),
  CONSTRAINT `StandardsChecklistItem_checklistId_fkey`
    FOREIGN KEY (`checklistId`) REFERENCES `StandardsChecklist`(`id`) ON DELETE CASCADE
);

CREATE TABLE `ReportChecklistItem` (
  `id`              VARCHAR(191) NOT NULL,
  `reportId`        VARCHAR(191) NOT NULL,
  `standardsFamily` VARCHAR(191) NOT NULL,
  `key`             VARCHAR(191) NOT NULL,
  `title`           VARCHAR(191) NOT NULL,
  `guidance`        TEXT NULL,
  `status`          VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `note`            TEXT NULL,
  `addressedBy`     VARCHAR(191) NULL,
  `addressedAt`     DATETIME(3) NULL,
  `displayOrder`    INT NOT NULL DEFAULT 0,
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ReportChecklistItem_reportId_status_idx` (`reportId`, `status`),
  INDEX `ReportChecklistItem_reportId_standardsFamily_idx` (`reportId`, `standardsFamily`),
  CONSTRAINT `ReportChecklistItem_reportId_fkey`
    FOREIGN KEY (`reportId`) REFERENCES `Report`(`id`) ON DELETE CASCADE
);
