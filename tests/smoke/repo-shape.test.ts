import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..', '..')
const p = (rel: string) => resolve(root, rel)

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
  ])('exists: %s', (rel) => {
    expect(existsSync(p(rel))).toBe(true)
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
    ]
    for (const rel of actionFiles) {
      const head = readFileSync(p(rel), 'utf8').slice(0, 40)
      expect(head).toMatch(/['"]use server['"]/)
    }
  })

  it('the Prisma schema still declares the eleven baseline models', () => {
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
