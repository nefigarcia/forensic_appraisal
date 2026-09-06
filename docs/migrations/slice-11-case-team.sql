-- ─────────────────────────────────────────────────────────────────────────
-- Slice 11 — Case Team and Professional Review Workflow
-- Manual migration script (MySQL). Purely additive. No backfill required.
--
-- HOW TO APPLY
-- ------------
-- Dev / staging:  npx prisma db push
-- Production:     apply this SQL inside a transaction and verify with:
--                     SHOW TABLES LIKE 'CaseMember';
--                     SHOW TABLES LIKE 'ReviewItem';
--                     SHOW TABLES LIKE 'ReviewComment';
--                     DESCRIBE `Case`;
--
-- BACKWARD COMPAT
-- ---------------
-- Every existing Case row gets `hasEngagementTeam = false` by default.
-- Slice-1 whole-org access continues to apply until a team member is
-- added. Adding the first CaseMember flips the flag to true (via the
-- server action, not this SQL) and access becomes team-scoped from that
-- moment on.
-- ─────────────────────────────────────────────────────────────────────────

START TRANSACTION;

-- ── Case: engagement-team gate flag ──────────────────────────────────
ALTER TABLE `Case`
  ADD COLUMN `hasEngagementTeam` TINYINT(1) NOT NULL DEFAULT 0;

-- ── CaseMember ───────────────────────────────────────────────────────
CREATE TABLE `CaseMember` (
  `id`        VARCHAR(191) NOT NULL,
  `caseId`    VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `caseRole`  VARCHAR(191) NOT NULL,
  `addedBy`   VARCHAR(191) NULL,
  `addedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `removedAt` DATETIME(3)  NULL,
  `removedBy` VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CaseMember_caseId_userId_key` (`caseId`, `userId`),
  INDEX `CaseMember_caseId_idx` (`caseId`),
  INDEX `CaseMember_userId_idx` (`userId`),
  CONSTRAINT `CaseMember_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CaseMember_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

-- ── ReviewItem ───────────────────────────────────────────────────────
CREATE TABLE `ReviewItem` (
  `id`                   VARCHAR(191) NOT NULL,
  `caseId`               VARCHAR(191) NOT NULL,
  `targetType`           VARCHAR(191) NOT NULL,
  `targetId`             VARCHAR(191) NOT NULL,
  `status`               VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  `title`                VARCHAR(191) NOT NULL,
  `description`          TEXT         NULL,
  `createdBy`            VARCHAR(191) NOT NULL,
  `assignedTo`           VARCHAR(191) NULL,
  `approvedBy`           VARCHAR(191) NULL,
  `approvedAt`           DATETIME(3)  NULL,
  `changesRequestedBy`   VARCHAR(191) NULL,
  `changesRequestedAt`   DATETIME(3)  NULL,
  `changesRequestedNote` TEXT         NULL,
  `createdAt`            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`            DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ReviewItem_caseId_targetType_targetId_key` (`caseId`, `targetType`, `targetId`),
  INDEX `ReviewItem_caseId_status_idx` (`caseId`, `status`),
  INDEX `ReviewItem_status_idx` (`status`),
  INDEX `ReviewItem_assignedTo_idx` (`assignedTo`),
  CONSTRAINT `ReviewItem_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

-- ── ReviewComment ────────────────────────────────────────────────────
CREATE TABLE `ReviewComment` (
  `id`           VARCHAR(191) NOT NULL,
  `reviewItemId` VARCHAR(191) NOT NULL,
  `authorId`     VARCHAR(191) NOT NULL,
  `body`         TEXT         NOT NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ReviewComment_reviewItemId_createdAt_idx` (`reviewItemId`, `createdAt`),
  CONSTRAINT `ReviewComment_reviewItemId_fkey`
    FOREIGN KEY (`reviewItemId`) REFERENCES `ReviewItem` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ReviewComment_authorId_fkey`
    FOREIGN KEY (`authorId`) REFERENCES `User` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Roll-back
-- ─────────────────────────────────────────────────────────────────────────
-- START TRANSACTION;
-- DROP TABLE `ReviewComment`;
-- DROP TABLE `ReviewItem`;
-- DROP TABLE `CaseMember`;
-- ALTER TABLE `Case` DROP COLUMN `hasEngagementTeam`;
-- COMMIT;
