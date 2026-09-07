# Professional Valuation Engine V2

Landed in Slice 13. A structured multi-approach valuation workbench:
Income (Cap of Earnings, DCF), Market (GPCM, Transactions), Asset,
Enterprise → Equity Bridge, Ownership Interest Adjustments, and
per-scenario Reconciliation.

The Slice-0 `ValuationModel` table stays untouched for backward
compatibility on existing cases. This slice adds a parallel set of
tables composed under `ValuationEngagement` (1:1 with `Case`).

## Guiding rules

1. **AI does not determine conclusions.** No `withAIExecution` wrapper
   is used in this slice. Every material value is entered or approved
   by a professional. AI-assisted *suggestion* surfaces (e.g. proposed
   comparables) are out of scope; they are follow-up work that must
   themselves route through the assumption approval flow.
2. **Ownership discounts (DLOC / DLOM / …) never auto-apply.** They
   live as `OwnershipAdjustment` rows with their own status. The math
   library throws if a non-APPROVED row is passed to
   `applyOwnershipDiscounts`. Tests in
   `tests/unit/valuation-v2-ownership.test.ts` pin this invariant.
3. **Every material assumption is a first-class row** carrying
   value + source + rationale + status + reviewer + audit history
   (`AssumptionEvent`). Approving an assumption requires a distinct
   reviewer (no self-approval) and a non-empty rationale.
4. **All arithmetic is decimal-safe** via `Prisma.Decimal` through the
   Slice-4 `money` helpers. No JS-float rounding.
5. **Every reconciliation is refusable.** `runScenarioReconciliation`
   throws when any material assumption or ownership adjustment is
   non-APPROVED. `allowBlocking: true` runs a preview; the persisted
   row records `hasBlockingAssumptions = true`.

## Data model

```
Case (1:1) ──► ValuationEngagement
                 ├── ValuationScenario (BASE / LOW / HIGH / custom)
                 │     ├── ValuationApproach (per kind)
                 │     │     ├── CapEarningsDetail (1:1)
                 │     │     ├── DcfDetail (1:1)
                 │     │     │     └── DcfForecastYear[]
                 │     │     ├── GuidelinePublicCompany[]
                 │     │     ├── GuidelineTransaction[]
                 │     │     └── AssetAdjustment[]
                 │     ├── EquityBridgeItem[]
                 │     └── ValuationReconciliation (1:1)
                 ├── OwnershipAdjustment[]
                 └── ValuationAssumption[]
                       └── AssumptionEvent[] (append-only history)
```

Field-level notes are in
[docs/migrations/slice-13-valuation-v2.sql](docs/migrations/slice-13-valuation-v2.sql).

## Approach kinds

```
INCOME_CAP_EARNINGS   Value = NormalizedEarnings / capRate
INCOME_DCF            Σ PV(FCFF₁..N) + PV(terminal)
MARKET_GPCM           subject metric × median guideline multiple
MARKET_TRANSACTIONS   subject metric × median transaction multiple
ASSET                 Σ asset FV − Σ liability FV
```

Each of these maps to a `src/lib/valuation-v2/*.ts` module. The module
is the authoritative math; the server actions read + persist rows and
call into it.

## DCF specifics

`src/lib/valuation-v2/dcf.ts::deriveYear`:

```
EBITDA = ebitda ?? revenue × ebitdaMargin
EBIT   = EBITDA − depreciation − amortization
taxes  = taxes ?? EBIT × taxRate
FCFF   = EBIT × (1 − taxRate) + D&A − capex − ΔWC
```

Precedence is (a) caller-supplied value wins, (b) otherwise derive.
The workbench UI can override one component and keep the rest null.

Terminal value:
- `GORDON`: `lastFcff × (1 + g) / (r − g)`; throws if `r ≤ g`.
- `EXIT_MULTIPLE`: `lastEbitda × multiple`.

Mid-year convention: interim years discount at `t − 0.5`; the
perpetuity terminal always discounts at year `N` regardless.

## Enterprise → Equity Bridge

```
EnterpriseValue
  + Cash (non-operating)
  − Debt
  − Debt-like (unfunded pension, operating leases treated as debt, …)
  ± Non-operating assets / liabilities
  − Preferred equity
  − Non-controlling interest
  ± Other
  = Equity Value
```

`EquityBridgeItem.amount` is signed with respect to enterprise value.
The `orientAmount(category, magnitude)` helper in
`src/lib/valuation-v2/statuses.ts` normalizes magnitude-only inputs.

## Ownership Interest Adjustments

Ownership percentage, control considerations (DLOC), and marketability
considerations (DLOM) live in `OwnershipAdjustment` rows with their
own lifecycle:

```
DRAFT → PROPOSED → APPROVED
              │
              ├── REJECTED (note required) → DRAFT
              └── DRAFT (author withdraws)
APPROVED → SUPERSEDED (superseded by a newer APPROVED row of same kind)
```

**Only APPROVED rows are applied.** `applyOwnershipDiscounts` throws
on any other status. `previewOwnershipDiscounts` is a distinct-typed
alternate path for the "what if" workbench pane so the two cannot be
silently swapped.

Discounts compose multiplicatively:

```
effectiveMultiplier = Π (1 − pᵢ)
discountedValue     = equityValue × effectiveMultiplier
cumulativeDiscount  = 1 − effectiveMultiplier
```

## Material Assumptions

`ValuationAssumption` is polymorphic (`targetType` / `targetId`) — an
assumption can attach to the engagement, a scenario, an approach, a
specific DCF year, etc. Every row carries:

- `value` (as `valueString` and optionally `valueNumeric`),
- `unit` (RATE / MONEY / PERCENT / MULTIPLE / YEARS / …),
- `source` (evidence citation, professional judgment, industry study),
- `rationale`,
- `status` (DRAFT / PROPOSED / APPROVED / REJECTED / SUPERSEDED),
- `proposedBy`, `approvedBy`, `approvedAt`, `rejectionNote`,
- audit history via `AssumptionEvent`.

Rules enforced at the action layer:

1. `APPROVE` requires a non-empty `rationale`.
2. Reviewer must not equal `proposedBy` (no self-approval).
3. Reviewer must have `value:approve_batch`.
4. Approving a new row with the same `(engagementId, key)` atomically
   supersedes any older APPROVED row (status `SUPERSEDED`,
   `supersededBy` back-pointer).
5. Editing an APPROVED / SUPERSEDED row is refused — create a new row
   and go through APPROVE, which will supersede the old one.

Only `APPROVED` assumptions and `APPROVED` ownership adjustments feed
`runScenarioReconciliation` in strict mode. The single authoritative
predicate is `isEffectiveAssumption` in
`src/lib/valuation-v2/statuses.ts`.

## Reconciliation + Scenarios

`runScenarioReconciliation(scenarioId, allowBlocking?)`:

- Collects every non-APPROVED assumption + non-APPROVED ownership
  adjustment into `blockingReasons[]`.
- If any blocking reason and `allowBlocking !== true`, throws with the
  full list.
- Otherwise computes:
  ```
  EV     = Σ (wᵢ / Σw) × indicatedValueᵢ    (over included approaches)
  bridge = Σ amounts                        (signed)
  equity = EV + bridge
  ownership discount = 1 − Π(1 − pⱼ)        (APPROVED rows only)
  ownership value = equity × Π(1 − pⱼ)
  ```
- Upserts a `ValuationReconciliation` row per scenario. In blocking
  mode the row records `hasBlockingAssumptions = true` so downstream
  reports can refuse to use it.

Scenarios are Base / Low / High by default. Firms may add custom
scenarios. `probability` on a scenario is OPTIONAL; the module refuses
to compute a probability-weighted aggregate if no scenario has a
probability (no silent equal-weighting).

## Server action surface

| Action | Permission |
|---|---|
| `initializeValuationEngagement` | `valuation:write` |
| `changeEngagementStatus` | `valuation:write` |
| `addScenario`, `addApproachToScenario`, `updateApproachInclusion` | `valuation:write` |
| `createAssumption`, `updateAssumptionValue` | `valuation:write` |
| `changeAssumptionStatus` (to APPROVED) | `value:approve_batch` |
| `changeAssumptionStatus` (other) | `valuation:write` |
| `createOwnershipAdjustment`, `updateOwnershipAdjustment` | `valuation:write` |
| `changeOwnershipAdjustmentStatus` (to APPROVED) | `value:approve_batch` |
| `computeDcfApproach`, `computeCapEarningsApproach`, `computeGpcmMedianEbitda`, `computeGuidelineTransactionsMedian`, `computeAssetApproachAction` | `valuation:write` |
| `runScenarioReconciliation` | `valuation:write` |

Every mutation writes a Slice-6-chained `AuditLog` event via
`logAction`. Assumption mutations additionally write an
`AssumptionEvent` inside the same transaction.

## Migration

Purely additive. 13 new tables:

- `ValuationEngagement`, `ValuationScenario`, `ValuationApproach`
- `CapEarningsDetail`, `DcfDetail`, `DcfForecastYear`
- `GuidelinePublicCompany`, `GuidelineTransaction`, `AssetAdjustment`
- `EquityBridgeItem`
- `OwnershipAdjustment`
- `ValuationAssumption`, `AssumptionEvent`
- `ValuationReconciliation`

Nothing on `ValuationModel` (Slice 0) is touched. Existing cases open
with an empty workbench until an analyst calls
`initializeValuationEngagement`.

Migration SQL at
[docs/migrations/slice-13-valuation-v2.sql](docs/migrations/slice-13-valuation-v2.sql).

## Explicit non-goals

- **AI-suggested assumptions.** No AI flow proposes assumption values.
  A follow-up slice could add "AI suggested this multiple" as a DRAFT
  row that still requires human APPROVE — but the pathway is not
  built here on purpose.
- **Per-approach editors.** The workbench UI shows engagement state,
  approaches, assumptions, and ownership adjustments; the rich DCF
  year grid + GPCM comparable table + asset schedule are follow-up
  UI work. The math is complete and tested; the UI to *drive* the
  math end-to-end is not.
- **Cross-approach central-tendency picker.** GPCM currently uses
  median EV/EBITDA. Choosing mean / weighted / min is a
  professional judgment that will hook up to a `ValuationAssumption`
  in a follow-up slice.
- **Scenario probability blending on the final number.** The math is
  present (`probabilityWeightedEquityValue`); the reporting layer
  intentionally does not pick one number for the client. The
  professional decides which scenario is the concluded value.
- **Per-DCF-year assumption rows.** Schema supports it via
  `targetType='DCF_YEAR'`; wiring the auto-creation of one
  assumption per material year cell is a UI follow-up.
- **All Slice 1–12 backlogs** remain open.
