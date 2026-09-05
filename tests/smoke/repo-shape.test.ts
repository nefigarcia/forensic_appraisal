import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(__dirname, '..', '..')
const p = (rel: string) => resolve(root, rel)

/** Recursively list .ts / .tsx files under a repo-relative path. */
function tsFilesUnder(rel: string): string[] {
  const out: string[] = []
  function walk(abs: string) {
    for (const entry of readdirSync(abs)) {
      const full = join(abs, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry)) {
        // Return the repo-relative path, using forward slashes.
        out.push(full.slice(root.length + 1).split(/[\\/]/).join('/'))
      }
    }
  }
  walk(p(rel))
  return out
}

/**
 * Contract-shape smoke test. Guards against silent moves/renames of
 * security-sensitive modules that future slices depend on. Pins the
 * baseline recorded in docs/architecture/*.md at Slice 0.
 */
describe('repository shape (Slice 0 baseline)', () => {
  it.each([
    'prisma/schema.prisma',
    'src/middleware.ts',
    'src/lib/auth-utils.ts',
    'src/lib/rbac.ts',
    'src/lib/audit.ts',
    'src/lib/prisma.ts',
    'src/lib/plans.ts',
    'src/lib/stripe.ts',
    'src/lib/s3-client.ts',
    'src/app/actions/auth.ts',
    'src/app/actions/cases.ts',
    'src/app/actions/documents.ts',
    'src/app/actions/addback-actions.ts',
    'src/app/actions/ai-actions.ts',
    'src/app/actions/billing-actions.ts',
    'src/app/actions/connectors.ts',
    'src/app/api/auth/logout/route.ts',
    'src/app/api/connect/microsoft/route.ts',
    'src/app/api/connect/microsoft/callback/route.ts',
    'src/app/api/webhooks/stripe/route.ts',
    'src/ai/genkit.ts',
    'src/ai/flows/ai-financial-statement-extraction-flow.ts',
    'src/ai/flows/ai-industry-code-suggestion-flow.ts',
    'src/ai/flows/anomaly-detection-flow.ts',
    'src/ai/flows/binder-query-flow.ts',
    'src/ai/flows/insights-flow.ts',
    'src/ai/flows/normalize-ttm-flow.ts',
    'src/ai/flows/report-narrative-flow.ts',
    // Slice 2 — auth hardening
    'src/lib/env.ts',
    'src/lib/session.ts',
    'src/lib/mailer.ts',
    'src/lib/auth/passwords.ts',
    'src/lib/auth/tokens.ts',
    'src/lib/auth/rate-limit.ts',
    'src/lib/auth/mfa.ts',
    'src/lib/auth/redirect.ts',
    'src/app/actions/password-reset.ts',
    'src/app/actions/email-verification.ts',
    'src/app/api/verify-email/[token]/route.ts',
    'docs/migrations/slice-2-auth-hardening.sql',
    // Slice 3 — connector credential protection
    'src/lib/crypto/kek.ts',
    'src/lib/crypto/envelope.ts',
    'src/lib/crypto/connector-secrets.ts',
    'src/lib/oauth-state.ts',
    'scripts/migrate-connector-secrets.ts',
    'docs/migrations/slice-3-connector-encryption.sql',
    'docs/architecture/CONNECTOR_ENCRYPTION.md',
    'docs/architecture/MICROSOFT_OAUTH_SCOPES.md',
    // Slice 4 — decimal-safe financial domain
    'src/lib/money.ts',
    'src/lib/valuation.ts',
    'scripts/migrate-money-to-decimal.ts',
    'docs/migrations/slice-4-decimal-money.sql',
    // Slice 5 — immutable evidence
    'src/lib/documents/validation.ts',
    'src/lib/documents/versioning.ts',
    'src/lib/documents/scanner.ts',
    'src/app/actions/document-versions.ts',
    'src/components/document-version-history.tsx',
    'scripts/migrate-documents-to-versions.ts',
    'docs/migrations/slice-5-document-versioning.sql',
    'docs/architecture/DOCUMENT_VERSIONING.md',
    // Slice 6 — tamper-evident audit chain
    'src/lib/audit-chain.ts',
    'src/app/actions/audit-integrity.ts',
    'src/components/audit-integrity-badge.tsx',
    'docs/migrations/slice-6-audit-chain.sql',
    'docs/architecture/AUDIT_CHAIN.md',
    // Slice 7 — evidence-level citations
    'src/lib/citations/parent.ts',
    'src/lib/citations/from-ai.ts',
    'src/app/actions/citations.ts',
    'src/components/citation-indicator.tsx',
    'scripts/migrate-source-refs-to-citations.ts',
    'docs/migrations/slice-7-evidence-citations.sql',
    'docs/architecture/EVIDENCE_CITATIONS.md',
    // Slice 8 — AI execution registry
    'src/lib/ai/flow-metadata.ts',
    'src/lib/ai/execution.ts',
    'src/app/actions/ai-executions.ts',
    'src/components/ai-executions-panel.tsx',
    'src/app/settings/ai-executions/page.tsx',
    'docs/migrations/slice-8-ai-executions.sql',
    'docs/architecture/AI_EXECUTIONS.md',
    // Slice 9 — financial tie-out engine
    'src/lib/tie-out/concepts.ts',
    'src/lib/tie-out/status.ts',
    'src/app/actions/tie-outs.ts',
    'src/components/tie-out-dashboard.tsx',
    'docs/migrations/slice-9-tie-outs.sql',
    'docs/architecture/TIE_OUT_ENGINE.md',
  ])('exists: %s', (rel) => {
    expect(existsSync(p(rel))).toBe(true)
  })

  // ─────────────────────────────────────────────────
  // Slice 6 — the audit ledger is append-only through app logic.
  // No server-side code path may call auditLog.update or auditLog.delete.
  // (Manual DB edits are outside the app layer; the hash chain detects them.)
  // ─────────────────────────────────────────────────
  it('no application code calls auditLog.update or auditLog.delete', () => {
    const forbidden = /prisma\.auditLog\.(update|delete)/
    const violations: string[] = []
    for (const rel of tsFilesUnder('src')) {
      const source = readFileSync(p(rel), 'utf8')
      if (forbidden.test(source)) violations.push(rel)
    }
    expect(violations).toEqual([])
  })

  it('every action file starts with the "use server" directive', () => {
    const actionFiles = [
      'src/app/actions/auth.ts',
      'src/app/actions/cases.ts',
      'src/app/actions/documents.ts',
      'src/app/actions/addback-actions.ts',
      'src/app/actions/ai-actions.ts',
      'src/app/actions/billing-actions.ts',
      'src/app/actions/connectors.ts',
      'src/app/actions/password-reset.ts',
      'src/app/actions/email-verification.ts',
      'src/app/actions/document-versions.ts',
      'src/app/actions/citations.ts',
      'src/app/actions/audit-integrity.ts',
      'src/app/actions/ai-executions.ts',
      'src/app/actions/tie-outs.ts',
    ]
    for (const rel of actionFiles) {
      const head = readFileSync(p(rel), 'utf8').slice(0, 40)
      expect(head).toMatch(/['"]use server['"]/)
    }
  })

  it('the Prisma schema still declares the eleven baseline models', () => {
    // (used above by the append-only test as well)
    const schema = readFileSync(p('prisma/schema.prisma'), 'utf8')
    for (const model of [
      'Organization', 'User', 'Case', 'Document', 'FinancialValue',
      'AddBack', 'IndustryClassification', 'ValuationModel',
      'AnomalyFlag', 'CaseInsight', 'AuditLog', 'ExternalConnector',
      // Slice 2
      'SessionRevocation', 'PasswordResetToken', 'EmailVerificationToken',
      'LoginAttempt', 'MfaSecret', 'MfaBackupCode',
    ]) {
      expect(schema).toMatch(new RegExp(`\\bmodel\\s+${model}\\s*\\{`))
    }
  })
})
