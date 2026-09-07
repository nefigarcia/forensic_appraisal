-- ─────────────────────────────────────────────────────────────────────────
-- Slice 2 — Authentication and Session Hardening
-- Manual migration script (MySQL).
--
-- HOW TO APPLY
-- ------------
-- The project has no `prisma/migrations/` folder — schema sync is done
-- through `npx prisma db push` in dev. This file is provided as a review
-- artifact for production DBAs.
--
-- Option A (dev / staging):
--     npx prisma db push       # syncs the whole schema to the DB
--
-- Option B (production, reviewed):
--     Apply this SQL manually inside a transaction and verify row counts.
--
-- All changes are ADDITIVE except one: AuditLog.userId is relaxed from
-- NOT NULL to nullable, so pre-auth events (e.g. LOGIN_FAIL for an
-- unknown email) can be recorded. That relaxation is safe for existing
-- rows — every current row has a non-null userId.
-- ─────────────────────────────────────────────────────────────────────────

START TRANSACTION;

-- ── User: three new columns ────────────────────────────────────────────
ALTER TABLE `User`
  ADD COLUMN `emailVerifiedAt`   DATETIME(3) NULL,
  ADD COLUMN `passwordChangedAt` DATETIME(3) NULL,
  ADD COLUMN `mfaEnabled`        TINYINT(1)  NOT NULL DEFAULT 0;

-- ── AuditLog: relax userId to nullable; add index on (action, createdAt)
ALTER TABLE `AuditLog`
  MODIFY COLUMN `userId` VARCHAR(191) NULL;

CREATE INDEX `AuditLog_action_createdAt_idx`
  ON `AuditLog` (`action`, `createdAt`);

-- ── SessionRevocation ─────────────────────────────────────────────────
CREATE TABLE `SessionRevocation` (
  `jti`       VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `reason`    VARCHAR(191) NOT NULL,
  `revokedAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3)  NOT NULL,
  PRIMARY KEY (`jti`),
  INDEX `SessionRevocation_expiresAt_idx` (`expiresAt`),
  INDEX `SessionRevocation_userId_idx`    (`userId`),
  CONSTRAINT `SessionRevocation_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

-- ── PasswordResetToken ────────────────────────────────────────────────
CREATE TABLE `PasswordResetToken` (
  `tokenHash`  VARCHAR(191) NOT NULL,
  `userId`     VARCHAR(191) NOT NULL,
  `expiresAt`  DATETIME(3)  NOT NULL,
  `consumedAt` DATETIME(3)  NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tokenHash`),
  INDEX `PasswordResetToken_userId_expiresAt_idx` (`userId`, `expiresAt`),
  CONSTRAINT `PasswordResetToken_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

-- ── EmailVerificationToken ────────────────────────────────────────────
CREATE TABLE `EmailVerificationToken` (
  `tokenHash`  VARCHAR(191) NOT NULL,
  `userId`     VARCHAR(191) NOT NULL,
  `expiresAt`  DATETIME(3)  NOT NULL,
  `consumedAt` DATETIME(3)  NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tokenHash`),
  INDEX `EmailVerificationToken_userId_expiresAt_idx` (`userId`, `expiresAt`),
  CONSTRAINT `EmailVerificationToken_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

-- ── LoginAttempt ──────────────────────────────────────────────────────
CREATE TABLE `LoginAttempt` (
  `id`        VARCHAR(191) NOT NULL,
  `email`     VARCHAR(191) NOT NULL,
  `ipAddress` VARCHAR(191) NULL,
  `ok`        TINYINT(1)   NOT NULL,
  `reason`    VARCHAR(191) NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `LoginAttempt_email_createdAt_idx` (`email`, `createdAt`),
  INDEX `LoginAttempt_createdAt_idx`       (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

-- ── MfaSecret ─────────────────────────────────────────────────────────
CREATE TABLE `MfaSecret` (
  `userId`     VARCHAR(191) NOT NULL,
  `secret`     VARCHAR(191) NOT NULL,
  `verifiedAt` DATETIME(3)  NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3)  NOT NULL,
  PRIMARY KEY (`userId`),
  CONSTRAINT `MfaSecret_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

-- ── MfaBackupCode ─────────────────────────────────────────────────────
CREATE TABLE `MfaBackupCode` (
  `id`        VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `codeHash`  VARCHAR(191) NOT NULL,
  `usedAt`    DATETIME(3)  NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `MfaBackupCode_userId_idx` (`userId`),
  CONSTRAINT `MfaBackupCode_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Roll-back
-- ─────────────────────────────────────────────────────────────────────────
-- START TRANSACTION;
-- DROP TABLE IF EXISTS `MfaBackupCode`;
-- DROP TABLE IF EXISTS `MfaSecret`;
-- DROP TABLE IF EXISTS `LoginAttempt`;
-- DROP TABLE IF EXISTS `EmailVerificationToken`;
-- DROP TABLE IF EXISTS `PasswordResetToken`;
-- DROP TABLE IF EXISTS `SessionRevocation`;
-- DROP INDEX `AuditLog_action_createdAt_idx` ON `AuditLog`;
-- -- If you must re-tighten AuditLog.userId, replace any nulls first:
-- -- UPDATE `AuditLog` SET `userId` = '<placeholder>' WHERE `userId` IS NULL;
-- -- ALTER TABLE `AuditLog` MODIFY COLUMN `userId` VARCHAR(191) NOT NULL;
-- ALTER TABLE `User`
--   DROP COLUMN `mfaEnabled`,
--   DROP COLUMN `passwordChangedAt`,
--   DROP COLUMN `emailVerifiedAt`;
-- COMMIT;
