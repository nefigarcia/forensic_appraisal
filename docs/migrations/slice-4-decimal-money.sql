-- ─────────────────────────────────────────────────────────────────────────
-- Slice 4 — Decimal-Safe Financial Domain
-- Manual migration script (MySQL). Purely additive.
--
-- HOW TO APPLY
-- ------------
-- Option A (dev / staging):
--     npx prisma db push
-- Option B (production, reviewed):
--     Apply this SQL inside a transaction and verify with:
--         DESCRIBE `FinancialValue`;
--         DESCRIBE `AddBack`;
--         DESCRIBE `ValuationModel`;
--
-- After the schema is live, backfill the Decimal shadow columns from the
-- Float columns of existing rows:
--     npx tsx scripts/migrate-money-to-decimal.ts --apply
--
-- IMPORTANT: this migration does NOT alter or drop any existing Float
-- column. Historical data is preserved bit-for-bit. A follow-up slice can
-- drop the Float columns once every environment has run the backfill
-- and confirmed the Decimal columns match business expectations.
-- ─────────────────────────────────────────────────────────────────────────

START TRANSACTION;

-- ── FinancialValue ────────────────────────────────────────────────────
ALTER TABLE `FinancialValue`
  ADD COLUMN `valueDecimal`            DECIMAL(19, 4) NULL,
  ADD COLUMN `aiSuggestedValueDecimal` DECIMAL(19, 4) NULL;

-- ── AddBack ───────────────────────────────────────────────────────────
ALTER TABLE `AddBack`
  ADD COLUMN `year2Decimal` DECIMAL(19, 4) NULL,
  ADD COLUMN `year1Decimal` DECIMAL(19, 4) NULL,
  ADD COLUMN `ttmDecimal`   DECIMAL(19, 4) NULL;

-- ── ValuationModel ────────────────────────────────────────────────────
-- Money-valued: Decimal(19, 4).
-- Rates / multiples / weights: Decimal(9, 6).
ALTER TABLE `ValuationModel`
  ADD COLUMN `ebitdaDecimal`            DECIMAL(19, 4) NULL,
  ADD COLUMN `multiplierDecimal`        DECIMAL(9,  6) NULL,
  ADD COLUMN `growthRateDecimal`        DECIMAL(9,  6) NULL,
  ADD COLUMN `dcfYear1Decimal`          DECIMAL(19, 4) NULL,
  ADD COLUMN `dcfYear2Decimal`          DECIMAL(19, 4) NULL,
  ADD COLUMN `dcfYear3Decimal`          DECIMAL(19, 4) NULL,
  ADD COLUMN `dcfYear4Decimal`          DECIMAL(19, 4) NULL,
  ADD COLUMN `dcfYear5Decimal`          DECIMAL(19, 4) NULL,
  ADD COLUMN `terminalGrowthDecimal`    DECIMAL(9,  6) NULL,
  ADD COLUMN `discountRateDecimal`      DECIMAL(9,  6) NULL,
  ADD COLUMN `riskFreeRateDecimal`      DECIMAL(9,  6) NULL,
  ADD COLUMN `equityRiskPremiumDecimal` DECIMAL(9,  6) NULL,
  ADD COLUMN `sizePremiumDecimal`       DECIMAL(9,  6) NULL,
  ADD COLUMN `specificRiskDecimal`      DECIMAL(9,  6) NULL,
  ADD COLUMN `indicatedValueDecimal`    DECIMAL(19, 4) NULL,
  ADD COLUMN `weightDecimal`            DECIMAL(9,  6) NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Roll-back
-- ─────────────────────────────────────────────────────────────────────────
-- START TRANSACTION;
-- ALTER TABLE `ValuationModel`
--   DROP COLUMN `weightDecimal`,
--   DROP COLUMN `indicatedValueDecimal`,
--   DROP COLUMN `specificRiskDecimal`,
--   DROP COLUMN `sizePremiumDecimal`,
--   DROP COLUMN `equityRiskPremiumDecimal`,
--   DROP COLUMN `riskFreeRateDecimal`,
--   DROP COLUMN `discountRateDecimal`,
--   DROP COLUMN `terminalGrowthDecimal`,
--   DROP COLUMN `dcfYear5Decimal`,
--   DROP COLUMN `dcfYear4Decimal`,
--   DROP COLUMN `dcfYear3Decimal`,
--   DROP COLUMN `dcfYear2Decimal`,
--   DROP COLUMN `dcfYear1Decimal`,
--   DROP COLUMN `growthRateDecimal`,
--   DROP COLUMN `multiplierDecimal`,
--   DROP COLUMN `ebitdaDecimal`;
-- ALTER TABLE `AddBack`
--   DROP COLUMN `ttmDecimal`,
--   DROP COLUMN `year1Decimal`,
--   DROP COLUMN `year2Decimal`;
-- ALTER TABLE `FinancialValue`
--   DROP COLUMN `aiSuggestedValueDecimal`,
--   DROP COLUMN `valueDecimal`;
-- COMMIT;
