-- ─────────────────────────────────────────────────
-- Slice 13 — Professional Valuation Engine V2
-- ─────────────────────────────────────────────────
-- Purely additive. Does not touch the Slice-0 `ValuationModel` table —
-- that model remains for backward compatibility on existing cases.
-- The new tables compose to form a structured multi-approach workbench:
--
--   ValuationEngagement (1:1 with Case)
--     └── ValuationScenario  (BASE / LOW / HIGH / custom)
--           └── ValuationApproach (INCOME_CAP_EARNINGS | INCOME_DCF |
--                                   MARKET_GPCM | MARKET_TRANSACTIONS | ASSET)
--                 ├── CapEarningsDetail
--                 ├── DcfDetail
--                 │     └── DcfForecastYear
--                 ├── GuidelinePublicCompany[]
--                 ├── GuidelineTransaction[]
--                 └── AssetAdjustment[]
--     └── EquityBridgeItem   (per scenario)
--     └── OwnershipAdjustment (per engagement — DLOC/DLOM)
--     └── ValuationAssumption (polymorphic — material assumptions)
--           └── AssumptionEvent (append-only history)
--     └── ValuationReconciliation (snapshot per scenario)
--
-- No data backfill required. Rollback: drop the new tables in
-- reverse-FK order; nothing else is touched.
-- ─────────────────────────────────────────────────

CREATE TABLE `ValuationEngagement` (
  `id`                VARCHAR(191) NOT NULL,
  `caseId`            VARCHAR(191) NOT NULL,
  `valuationDate`     DATETIME(3) NULL,
  `standardOfValue`   VARCHAR(191) NULL,
  `premiseOfValue`    VARCHAR(191) NULL,
  `interestType`      VARCHAR(191) NULL,
  `marketability`     VARCHAR(191) NULL,
  `reportingCurrency` VARCHAR(191) NOT NULL DEFAULT 'USD',
  `status`            VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  `createdBy`         VARCHAR(191) NOT NULL,
  `finalizedBy`       VARCHAR(191) NULL,
  `finalizedAt`       DATETIME(3) NULL,
  `createdAt`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ValuationEngagement_caseId_key` (`caseId`),
  INDEX `ValuationEngagement_caseId_idx` (`caseId`),
  CONSTRAINT `ValuationEngagement_caseId_fkey`
    FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE
);

CREATE TABLE `ValuationScenario` (
  `id`           VARCHAR(191) NOT NULL,
  `engagementId` VARCHAR(191) NOT NULL,
  `key`          VARCHAR(191) NOT NULL,
  `name`         VARCHAR(191) NOT NULL,
  `probability`  DECIMAL(9,6) NULL,
  `displayOrder` INT NOT NULL DEFAULT 0,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ValuationScenario_engagementId_key_key` (`engagementId`, `key`),
  INDEX `ValuationScenario_engagementId_idx` (`engagementId`),
  CONSTRAINT `ValuationScenario_engagementId_fkey`
    FOREIGN KEY (`engagementId`) REFERENCES `ValuationEngagement`(`id`) ON DELETE CASCADE
);

CREATE TABLE `ValuationApproach` (
  `id`             VARCHAR(191) NOT NULL,
  `scenarioId`     VARCHAR(191) NOT NULL,
  `kind`           VARCHAR(191) NOT NULL,
  `label`          VARCHAR(191) NULL,
  `weight`         DECIMAL(9,6) NOT NULL DEFAULT 0,
  `isIncluded`     TINYINT(1) NOT NULL DEFAULT 1,
  `indicatedValue` DECIMAL(19,4) NULL,
  `computedAt`     DATETIME(3) NULL,
  `computationNote` TEXT NULL,
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ValuationApproach_scenarioId_kind_key` (`scenarioId`, `kind`),
  INDEX `ValuationApproach_scenarioId_idx` (`scenarioId`),
  INDEX `ValuationApproach_kind_idx` (`kind`),
  CONSTRAINT `ValuationApproach_scenarioId_fkey`
    FOREIGN KEY (`scenarioId`) REFERENCES `ValuationScenario`(`id`) ON DELETE CASCADE
);

CREATE TABLE `CapEarningsDetail` (
  `approachId`         VARCHAR(191) NOT NULL,
  `normalizedEarnings` DECIMAL(19,4) NULL,
  `capitalizationRate` DECIMAL(9,6) NULL,
  `discountRate`       DECIMAL(9,6) NULL,
  `growthRate`         DECIMAL(9,6) NULL,
  `updatedAt`          DATETIME(3) NOT NULL,
  PRIMARY KEY (`approachId`),
  CONSTRAINT `CapEarningsDetail_approachId_fkey`
    FOREIGN KEY (`approachId`) REFERENCES `ValuationApproach`(`id`) ON DELETE CASCADE
);

CREATE TABLE `DcfDetail` (
  `approachId`           VARCHAR(191) NOT NULL,
  `discountRate`         DECIMAL(9,6) NULL,
  `terminalGrowth`       DECIMAL(9,6) NULL,
  `terminalMethod`       VARCHAR(191) NOT NULL DEFAULT 'GORDON',
  `terminalExitMultiple` DECIMAL(9,6) NULL,
  `taxRate`              DECIMAL(9,6) NULL,
  `midyearConvention`    TINYINT(1) NOT NULL DEFAULT 0,
  `pvSum`                DECIMAL(19,4) NULL,
  `pvTerminal`           DECIMAL(19,4) NULL,
  `indicatedValue`       DECIMAL(19,4) NULL,
  `updatedAt`            DATETIME(3) NOT NULL,
  PRIMARY KEY (`approachId`),
  CONSTRAINT `DcfDetail_approachId_fkey`
    FOREIGN KEY (`approachId`) REFERENCES `ValuationApproach`(`id`) ON DELETE CASCADE
);

CREATE TABLE `DcfForecastYear` (
  `id`                   VARCHAR(191) NOT NULL,
  `dcfApproachId`        VARCHAR(191) NOT NULL,
  `yearLabel`            VARCHAR(191) NOT NULL,
  `yearIndex`            INT NOT NULL,
  `revenue`              DECIMAL(19,4) NULL,
  `grossMarginPct`       DECIMAL(9,6) NULL,
  `ebitdaMargin`         DECIMAL(9,6) NULL,
  `ebitda`               DECIMAL(19,4) NULL,
  `depreciation`         DECIMAL(19,4) NULL,
  `amortization`         DECIMAL(19,4) NULL,
  `ebit`                 DECIMAL(19,4) NULL,
  `taxes`                DECIMAL(19,4) NULL,
  `capex`                DECIMAL(19,4) NULL,
  `workingCapitalChange` DECIMAL(19,4) NULL,
  `fcff`                 DECIMAL(19,4) NULL,
  `discountFactor`       DECIMAL(9,6) NULL,
  `presentValue`         DECIMAL(19,4) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DcfForecastYear_dcfApproachId_yearIndex_key` (`dcfApproachId`, `yearIndex`),
  INDEX `DcfForecastYear_dcfApproachId_idx` (`dcfApproachId`),
  CONSTRAINT `DcfForecastYear_dcfApproachId_fkey`
    FOREIGN KEY (`dcfApproachId`) REFERENCES `DcfDetail`(`approachId`) ON DELETE CASCADE
);

CREATE TABLE `GuidelinePublicCompany` (
  `id`              VARCHAR(191) NOT NULL,
  `approachId`      VARCHAR(191) NOT NULL,
  `companyName`     VARCHAR(191) NOT NULL,
  `ticker`          VARCHAR(191) NULL,
  `revenue`         DECIMAL(19,4) NULL,
  `ebitda`          DECIMAL(19,4) NULL,
  `netIncome`       DECIMAL(19,4) NULL,
  `enterpriseValue` DECIMAL(19,4) NULL,
  `marketCap`       DECIMAL(19,4) NULL,
  `evRevenue`       DECIMAL(9,6) NULL,
  `evEbitda`        DECIMAL(9,6) NULL,
  `peRatio`         DECIMAL(9,6) NULL,
  `isIncluded`      TINYINT(1) NOT NULL DEFAULT 1,
  `weight`          DECIMAL(9,6) NOT NULL DEFAULT 1,
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `GuidelinePublicCompany_approachId_idx` (`approachId`),
  CONSTRAINT `GuidelinePublicCompany_approachId_fkey`
    FOREIGN KEY (`approachId`) REFERENCES `ValuationApproach`(`id`) ON DELETE CASCADE
);

CREATE TABLE `GuidelineTransaction` (
  `id`              VARCHAR(191) NOT NULL,
  `approachId`      VARCHAR(191) NOT NULL,
  `target`          VARCHAR(191) NOT NULL,
  `acquirer`        VARCHAR(191) NULL,
  `transactionDate` DATETIME(3) NULL,
  `price`           DECIMAL(19,4) NULL,
  `revenue`         DECIMAL(19,4) NULL,
  `ebitda`          DECIMAL(19,4) NULL,
  `evRevenue`       DECIMAL(9,6) NULL,
  `evEbitda`        DECIMAL(9,6) NULL,
  `notes`           TEXT NULL,
  `isIncluded`      TINYINT(1) NOT NULL DEFAULT 1,
  `weight`          DECIMAL(9,6) NOT NULL DEFAULT 1,
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `GuidelineTransaction_approachId_idx` (`approachId`),
  CONSTRAINT `GuidelineTransaction_approachId_fkey`
    FOREIGN KEY (`approachId`) REFERENCES `ValuationApproach`(`id`) ON DELETE CASCADE
);

CREATE TABLE `AssetAdjustment` (
  `id`            VARCHAR(191) NOT NULL,
  `approachId`    VARCHAR(191) NOT NULL,
  `side`          VARCHAR(191) NOT NULL,
  `lineItem`      VARCHAR(191) NOT NULL,
  `reportedValue` DECIMAL(19,4) NOT NULL,
  `adjustment`    DECIMAL(19,4) NOT NULL,
  `fairValue`     DECIMAL(19,4) NOT NULL,
  `rationale`     TEXT NULL,
  `displayOrder`  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `AssetAdjustment_approachId_side_idx` (`approachId`, `side`),
  CONSTRAINT `AssetAdjustment_approachId_fkey`
    FOREIGN KEY (`approachId`) REFERENCES `ValuationApproach`(`id`) ON DELETE CASCADE
);

CREATE TABLE `EquityBridgeItem` (
  `id`           VARCHAR(191) NOT NULL,
  `scenarioId`   VARCHAR(191) NOT NULL,
  `category`     VARCHAR(191) NOT NULL,
  `label`        VARCHAR(191) NOT NULL,
  `amount`       DECIMAL(19,4) NOT NULL,
  `displayOrder` INT NOT NULL DEFAULT 0,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `EquityBridgeItem_scenarioId_idx` (`scenarioId`),
  CONSTRAINT `EquityBridgeItem_scenarioId_fkey`
    FOREIGN KEY (`scenarioId`) REFERENCES `ValuationScenario`(`id`) ON DELETE CASCADE
);

CREATE TABLE `OwnershipAdjustment` (
  `id`               VARCHAR(191) NOT NULL,
  `engagementId`     VARCHAR(191) NOT NULL,
  `kind`             VARCHAR(191) NOT NULL,
  `label`            VARCHAR(191) NULL,
  `percent`          DECIMAL(9,6) NOT NULL,
  `ownershipPercent` DECIMAL(9,6) NULL,
  `source`           TEXT NULL,
  `rationale`        TEXT NULL,
  `status`           VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  `proposedBy`       VARCHAR(191) NULL,
  `approvedBy`       VARCHAR(191) NULL,
  `approvedAt`       DATETIME(3) NULL,
  `rejectedBy`       VARCHAR(191) NULL,
  `rejectedAt`       DATETIME(3) NULL,
  `rejectionNote`    TEXT NULL,
  `supersededBy`     VARCHAR(191) NULL,
  `displayOrder`     INT NOT NULL DEFAULT 0,
  `createdAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `OwnershipAdjustment_engagementId_kind_status_idx` (`engagementId`, `kind`, `status`),
  INDEX `OwnershipAdjustment_engagementId_idx` (`engagementId`),
  CONSTRAINT `OwnershipAdjustment_engagementId_fkey`
    FOREIGN KEY (`engagementId`) REFERENCES `ValuationEngagement`(`id`) ON DELETE CASCADE
);

CREATE TABLE `ValuationAssumption` (
  `id`            VARCHAR(191) NOT NULL,
  `engagementId`  VARCHAR(191) NOT NULL,
  `targetType`    VARCHAR(191) NOT NULL,
  `targetId`      VARCHAR(191) NULL,
  `key`           VARCHAR(191) NOT NULL,
  `label`         VARCHAR(191) NOT NULL,
  `category`      VARCHAR(191) NULL,
  `valueString`   VARCHAR(191) NULL,
  `valueNumeric`  DECIMAL(19,6) NULL,
  `unit`          VARCHAR(191) NULL,
  `source`        TEXT NULL,
  `rationale`     TEXT NULL,
  `status`        VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
  `proposedBy`    VARCHAR(191) NULL,
  `approvedBy`    VARCHAR(191) NULL,
  `approvedAt`    DATETIME(3) NULL,
  `rejectedBy`    VARCHAR(191) NULL,
  `rejectedAt`    DATETIME(3) NULL,
  `rejectionNote` TEXT NULL,
  `supersededBy`  VARCHAR(191) NULL,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ValuationAssumption_engagementId_status_idx` (`engagementId`, `status`),
  INDEX `ValuationAssumption_engagementId_key_idx` (`engagementId`, `key`),
  INDEX `ValuationAssumption_targetType_targetId_idx` (`targetType`, `targetId`),
  CONSTRAINT `ValuationAssumption_engagementId_fkey`
    FOREIGN KEY (`engagementId`) REFERENCES `ValuationEngagement`(`id`) ON DELETE CASCADE
);

CREATE TABLE `AssumptionEvent` (
  `id`           VARCHAR(191) NOT NULL,
  `assumptionId` VARCHAR(191) NOT NULL,
  `action`       VARCHAR(191) NOT NULL,
  `userId`       VARCHAR(191) NULL,
  `oldValue`     TEXT NULL,
  `newValue`     TEXT NULL,
  `note`         TEXT NULL,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `AssumptionEvent_assumptionId_createdAt_idx` (`assumptionId`, `createdAt`),
  CONSTRAINT `AssumptionEvent_assumptionId_fkey`
    FOREIGN KEY (`assumptionId`) REFERENCES `ValuationAssumption`(`id`) ON DELETE CASCADE
);

CREATE TABLE `ValuationReconciliation` (
  `id`                       VARCHAR(191) NOT NULL,
  `engagementId`             VARCHAR(191) NOT NULL,
  `scenarioId`               VARCHAR(191) NOT NULL,
  `enterpriseValue`          DECIMAL(19,4) NULL,
  `bridgeNet`                DECIMAL(19,4) NULL,
  `equityValue`              DECIMAL(19,4) NULL,
  `ownershipDiscountApplied` DECIMAL(9,6) NULL,
  `ownershipValue`           DECIMAL(19,4) NULL,
  `hasBlockingAssumptions`   TINYINT(1) NOT NULL DEFAULT 0,
  `computedAt`               DATETIME(3) NULL,
  `computedBy`               VARCHAR(191) NULL,
  `notes`                    TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ValuationReconciliation_scenarioId_key` (`scenarioId`),
  INDEX `ValuationReconciliation_engagementId_idx` (`engagementId`),
  CONSTRAINT `ValuationReconciliation_engagementId_fkey`
    FOREIGN KEY (`engagementId`) REFERENCES `ValuationEngagement`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ValuationReconciliation_scenarioId_fkey`
    FOREIGN KEY (`scenarioId`) REFERENCES `ValuationScenario`(`id`) ON DELETE CASCADE
);
