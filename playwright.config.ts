/**
 * Playwright configuration — Slice-17 E2E harness.
 *
 * Install (opt-in, not part of `npm ci`):
 *   npm install -D @playwright/test
 *   npx playwright install --with-deps chromium
 *
 * Run:
 *   npx playwright test
 *
 * The Playwright suite is intentionally excluded from the CI
 * `Vitest` job because it needs:
 *   - a running Next.js dev server (started via `webServer` below),
 *   - a real MySQL instance seeded with fixture data,
 *   - a Chromium download.
 *
 * The recommended pattern is a separate GitHub Actions job that runs
 * on branch-cut / release rather than every push — see
 * docs/production/DEPLOYMENT_GUIDE.md.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { defineConfig, devices } = (() => {
  try { return require('@playwright/test') }
  catch {
    // Provide a shim so this file typechecks without the dep installed.
    return { defineConfig: (c: any) => c, devices: { 'Desktop Chrome': {} as any } }
  }
})()

export default defineConfig({
  testDir:   'tests/e2e',
  timeout:   60_000,
  fullyParallel: false,      // engagement lifecycle tests share state
  retries:   process.env.CI ? 1 : 0,
  workers:   1,
  reporter:  [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL:           process.env.E2E_BASE_URL ?? 'http://localhost:9002',
    trace:             'retain-on-failure',
    screenshot:        'only-on-failure',
    video:             'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...(devices as any)['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command:            'npm run dev',
    port:               9002,
    reuseExistingServer: true,
    timeout:            120_000,
  },
})
