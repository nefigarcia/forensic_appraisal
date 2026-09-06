-- ─────────────────────────────────────────────────
-- Slice 12 — Client Request List and Secure Client Portal
-- ─────────────────────────────────────────────────
-- Purely additive. No existing table is altered destructively.
-- Two categories:
--   1. New tables — request lists, request items, item→document join,
--      client contacts, opaque-token portal access rows, reminder log,
--      firm-owned request templates.
--   2. New foreign-key columns on RequestItem/PortalAccess that point
--      at existing rows via ON DELETE CASCADE.
--
-- No data backfill is required. Existing cases just start out with
-- `requestLists = []`; the UI shows an empty state until an analyst
-- creates the first list.
--
-- Rollback: DROP the new tables in reverse foreign-key order. No
-- pre-existing rows are touched, so rollback is a clean revert.
-- ─────────────────────────────────────────────────

-- Request template (firm-editable)
CREATE TABLE `RequestTemplate` (
  `id`             VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `name`           VARCHAR(191) NOT NULL,
  `description`    TEXT NULL,
  `engagementType` VARCHAR(191) NULL,
  `isSystem`       TINYINT(1) NOT NULL DEFAULT 0,
  `createdBy`      VARCHAR(191) NULL,
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `RequestTemplate_organizationId_idx` (`organizationId`),
  INDEX `RequestTemplate_organizationId_engagementType_idx` (`organizationId`, `engagementType`),
  CONSTRAINT `RequestTemplate_organizationId_fkey`
    FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE
);

CREATE TABLE `RequestTemplateItem` (
  `id`           VARCHAR(191) NOT NULL,
  `templateId`   VARCHAR(191) NOT NULL,
  `title`        VARCHAR(191) NOT NULL,
  `description`  TEXT NULL,
  `category`     VARCHAR(191) NULL,
  `priority`     VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
  `displayOrder` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `RequestTemplateItem_templateId_idx` (`templateId`),
  CONSTRAINT `RequestTemplateItem_templateId_fkey`
    FOREIGN KEY (`templateId`) REFERENCES `RequestTemplate`(`id`) ON DELETE CASCADE
);

-- Request list per case (PBC list)
CREATE TABLE `RequestList` (
  `id`          VARCHAR(191) NOT NULL,
  `caseId`      VARCHAR(191) NOT NULL,
  `title`       VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `status`      VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  `createdBy`   VARCHAR(191) NOT NULL,
  `templateId`  VARCHAR(191) NULL,
  `sentAt`      DATETIME(3) NULL,
  `closedAt`    DATETIME(3) NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `RequestList_caseId_status_idx` (`caseId`, `status`),
  INDEX `RequestList_templateId_idx` (`templateId`),
  CONSTRAINT `RequestList_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE,
  CONSTRAINT `RequestList_templateId_fkey`
    FOREIGN KEY (`templateId`) REFERENCES `RequestTemplate`(`id`) ON DELETE SET NULL
);

-- Individual request items
CREATE TABLE `RequestItem` (
  `id`                       VARCHAR(191) NOT NULL,
  `requestListId`            VARCHAR(191) NOT NULL,
  `caseId`                   VARCHAR(191) NOT NULL,
  `title`                    VARCHAR(191) NOT NULL,
  `description`              TEXT NULL,
  `category`                 VARCHAR(191) NULL,
  `requestedFrom`            VARCHAR(191) NULL,
  `dueDate`                  DATETIME(3) NULL,
  `priority`                 VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
  `status`                   VARCHAR(191) NOT NULL DEFAULT 'NOT_REQUESTED',
  `assignedToUserId`         VARCHAR(191) NULL,
  `reviewerUserId`           VARCHAR(191) NULL,
  `notes`                    TEXT NULL,
  `clarificationNote`        TEXT NULL,
  `aiCompleteness`           VARCHAR(191) NULL,
  `aiCompletenessConfident`  TINYINT(1) NOT NULL DEFAULT 1,
  `aiCompletenessNote`       TEXT NULL,
  `aiExecutionId`            VARCHAR(191) NULL,
  `statusChangedAt`          DATETIME(3) NULL,
  `displayOrder`             INT NOT NULL DEFAULT 0,
  `createdAt`                DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`                DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `RequestItem_requestListId_status_idx` (`requestListId`, `status`),
  INDEX `RequestItem_caseId_status_idx` (`caseId`, `status`),
  INDEX `RequestItem_status_idx` (`status`),
  INDEX `RequestItem_aiExecutionId_idx` (`aiExecutionId`),
  CONSTRAINT `RequestItem_requestListId_fkey`
    FOREIGN KEY (`requestListId`) REFERENCES `RequestList`(`id`) ON DELETE CASCADE,
  CONSTRAINT `RequestItem_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE,
  CONSTRAINT `RequestItem_aiExecutionId_fkey`
    FOREIGN KEY (`aiExecutionId`) REFERENCES `AiExecution`(`id`) ON DELETE SET NULL
);

-- Join: RequestItem ↔ Document
CREATE TABLE `RequestItemDocument` (
  `id`                   VARCHAR(191) NOT NULL,
  `requestItemId`        VARCHAR(191) NOT NULL,
  `documentId`           VARCHAR(191) NOT NULL,
  `uploadedByPortal`     TINYINT(1) NOT NULL DEFAULT 0,
  `uploadedByContactId`  VARCHAR(191) NULL,
  `uploadedAt`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `RequestItemDocument_requestItemId_documentId_key`
    (`requestItemId`, `documentId`),
  INDEX `RequestItemDocument_documentId_idx` (`documentId`),
  CONSTRAINT `RequestItemDocument_requestItemId_fkey`
    FOREIGN KEY (`requestItemId`) REFERENCES `RequestItem`(`id`) ON DELETE CASCADE,
  CONSTRAINT `RequestItemDocument_documentId_fkey`
    FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE
);

-- Client-side contacts
CREATE TABLE `ClientContact` (
  `id`        VARCHAR(191) NOT NULL,
  `caseId`    VARCHAR(191) NOT NULL,
  `name`      VARCHAR(191) NOT NULL,
  `email`     VARCHAR(191) NOT NULL,
  `role`      VARCHAR(191) NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `isActive`  TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ClientContact_caseId_idx` (`caseId`),
  INDEX `ClientContact_caseId_email_idx` (`caseId`, `email`),
  CONSTRAINT `ClientContact_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE
);

-- Opaque-token portal access (PK is SHA-256(rawToken))
CREATE TABLE `PortalAccess` (
  `tokenHash`       VARCHAR(191) NOT NULL,
  `clientContactId` VARCHAR(191) NOT NULL,
  `requestListId`   VARCHAR(191) NOT NULL,
  `caseId`          VARCHAR(191) NOT NULL,
  `invitedBy`       VARCHAR(191) NOT NULL,
  `invitedAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt`       DATETIME(3) NOT NULL,
  `revokedAt`       DATETIME(3) NULL,
  `revokedBy`       VARCHAR(191) NULL,
  `lastUsedAt`      DATETIME(3) NULL,
  `usageCount`      INT NOT NULL DEFAULT 0,
  `lastUsedIp`      VARCHAR(191) NULL,
  PRIMARY KEY (`tokenHash`),
  INDEX `PortalAccess_requestListId_idx` (`requestListId`),
  INDEX `PortalAccess_clientContactId_idx` (`clientContactId`),
  INDEX `PortalAccess_caseId_idx` (`caseId`),
  INDEX `PortalAccess_expiresAt_idx` (`expiresAt`),
  CONSTRAINT `PortalAccess_clientContactId_fkey`
    FOREIGN KEY (`clientContactId`) REFERENCES `ClientContact`(`id`) ON DELETE CASCADE,
  CONSTRAINT `PortalAccess_requestListId_fkey`
    FOREIGN KEY (`requestListId`) REFERENCES `RequestList`(`id`) ON DELETE CASCADE,
  CONSTRAINT `PortalAccess_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE
);

-- Reminder / notification log
CREATE TABLE `ReminderEvent` (
  `id`              VARCHAR(191) NOT NULL,
  `caseId`          VARCHAR(191) NOT NULL,
  `requestListId`   VARCHAR(191) NULL,
  `requestItemId`   VARCHAR(191) NULL,
  `clientContactId` VARCHAR(191) NULL,
  `kind`            VARCHAR(191) NOT NULL,
  `channel`         VARCHAR(191) NOT NULL DEFAULT 'EMAIL',
  `toEmail`         VARCHAR(191) NULL,
  `sentBy`          VARCHAR(191) NULL,
  `sentAt`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `status`          VARCHAR(191) NOT NULL DEFAULT 'SENT',
  `errorMessage`    TEXT NULL,
  PRIMARY KEY (`id`),
  INDEX `ReminderEvent_caseId_sentAt_idx` (`caseId`, `sentAt`),
  INDEX `ReminderEvent_requestListId_sentAt_idx` (`requestListId`, `sentAt`),
  INDEX `ReminderEvent_requestItemId_sentAt_idx` (`requestItemId`, `sentAt`),
  INDEX `ReminderEvent_clientContactId_sentAt_idx` (`clientContactId`, `sentAt`),
  CONSTRAINT `ReminderEvent_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ReminderEvent_requestListId_fkey`
    FOREIGN KEY (`requestListId`) REFERENCES `RequestList`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ReminderEvent_requestItemId_fkey`
    FOREIGN KEY (`requestItemId`) REFERENCES `RequestItem`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ReminderEvent_clientContactId_fkey`
    FOREIGN KEY (`clientContactId`) REFERENCES `ClientContact`(`id`) ON DELETE SET NULL
);
