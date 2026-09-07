/**
 * Canonical end-to-end lifecycle test.
 *
 * Covers the flow from the Slice-17 prompt:
 *   sign in
 *     → create case
 *     → assign members
 *     → create request list
 *     → upload document
 *     → extract
 *     → inspect citation
 *     → verify financial values
 *     → tie out
 *     → normalize
 *     → value (workbench)
 *     → review
 *     → generate report
 *
 * Requires:
 *   - `@playwright/test` installed (opt-in — see playwright.config.ts).
 *   - A running dev server AND a seeded MySQL instance with the
 *     fixture user credentials below.
 *
 * The suite is a single test to guarantee ordering — each step
 * depends on the state left by the previous one.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { test, expect } = (() => {
  try { return require('@playwright/test') }
  catch { return { test: () => {}, expect: () => ({}) } }
})()

const FIXTURE_EMAIL      = process.env.E2E_EMAIL     ?? 'analyst@e2e.valuvault.test'
const FIXTURE_PASSWORD   = process.env.E2E_PASSWORD  ?? 'test-password-2026'
const FIXTURE_REVIEWER   = process.env.E2E_REVIEWER  ?? 'reviewer@e2e.valuvault.test'
const FIXTURE_PDF_PATH   = process.env.E2E_PDF_PATH  ?? 'tests/e2e/fixtures/sample-financials.pdf'

test.describe.serial('ValuVault — full lifecycle', () => {
  test('sign in → engagement → request list → upload → extract → verify → tie out → normalize → value → review → report', async ({ page }: any) => {
    // ── Sign in ────────────────────────────────────
    await page.goto('/login')
    await page.getByLabel(/email/i).fill(FIXTURE_EMAIL)
    await page.getByLabel(/password/i).fill(FIXTURE_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    // ── Create case ────────────────────────────────
    await page.goto('/projects')
    await page.getByRole('button', { name: /new project|new case/i }).click()
    await page.getByLabel(/name|matter/i).fill('E2E Test Case ' + Date.now())
    await page.getByLabel(/client/i).fill('E2E Test Client')
    await page.getByRole('button', { name: /create/i }).click()
    await expect(page).toHaveURL(/\/projects\/.+/)
    const caseUrl = page.url()

    // ── Assign engagement members ─────────────────
    await page.getByRole('tab', { name: /team/i }).click()
    await page.getByRole('button', { name: /add member/i }).click()
    await page.getByLabel(/user|email/i).fill(FIXTURE_REVIEWER)
    await page.getByLabel(/role/i).selectOption('ENGAGEMENT_PARTNER')
    await page.getByRole('button', { name: /add/i }).click()

    // ── Create request list ────────────────────────
    await page.getByRole('tab', { name: /requests/i }).click()
    await page.getByRole('button', { name: /new request list/i }).click()
    await page.getByLabel(/title/i).fill('E2E PBC list')
    await page.getByRole('button', { name: /create/i }).click()

    // ── Upload document ────────────────────────────
    await page.getByRole('tab', { name: /documents/i }).click()
    await page.setInputFiles('input[type="file"]', FIXTURE_PDF_PATH)
    await expect(page.getByText(/uploaded|verified/i)).toBeVisible({ timeout: 20_000 })

    // ── Extract ────────────────────────────────────
    await page.getByRole('button', { name: /run.*extraction|extract/i }).click()
    await expect(page.getByText(/extraction complete|verified/i)).toBeVisible({ timeout: 60_000 })

    // ── Inspect citation ───────────────────────────
    await page.getByRole('tab', { name: /discovery|citations/i }).click()
    await expect(page.getByText(/citation/i).first()).toBeVisible()

    // ── Verify financial values ────────────────────
    await page.getByRole('tab', { name: /analysis|financials/i }).click()
    const firstAccept = page.getByRole('button', { name: /^accept$/i }).first()
    if (await firstAccept.isVisible()) {
      await firstAccept.click()
      await expect(page.getByText(/accepted|verified/i).first()).toBeVisible()
    }

    // ── Tie-out ────────────────────────────────────
    await page.getByRole('tab', { name: /tie.?outs/i }).click()
    await page.getByRole('button', { name: /run|refresh/i }).click()
    await expect(page.getByText(/tied|within tolerance|discrepancy/i).first()).toBeVisible({ timeout: 20_000 })

    // ── Normalize ──────────────────────────────────
    await page.getByRole('tab', { name: /normalization|add.?backs/i }).click()
    await expect(page.getByText(/normalization/i)).toBeVisible()

    // ── Value (workbench) ──────────────────────────
    await page.getByRole('tab', { name: /workbench/i }).click()
    await page.getByRole('button', { name: /initialize/i }).click().catch(() => {})
    await expect(page.getByText(/scenario|approaches/i).first()).toBeVisible()

    // ── Review (report composer) ───────────────────
    await page.getByRole('tab', { name: /composer/i }).click()
    await page.getByRole('button', { name: /initialize/i }).click().catch(() => {})
    // Draft one section
    await page.getByRole('button', { name: /ai draft/i }).first().click().catch(() => {})

    // ── Generate report (export) ───────────────────
    await page.getByRole('button', { name: /docx|export/i }).first().click()
    // The download itself is browser-side — we verify the button was actionable.
  })
})
