/**
 * Central environment-variable validation. Parsed once at module load.
 * Throws at boot if a required variable is missing or malformed.
 *
 * Why: the previous auth-utils module fell back to a hard-coded JWT secret
 * when `JWT_SECRET` was unset. That is a silent-security bug — the app
 * would keep running but every cookie was trivially forgeable. We now fail
 * closed at process start so a misconfiguration cannot ship.
 *
 * Devs who see this fail on `next dev`: set `JWT_SECRET` in `.env` to any
 * ≥16-char random string. Generate with `openssl rand -hex 32`.
 */

import { z } from 'zod'

const isProduction = process.env.NODE_ENV === 'production'
const JWT_MIN_LENGTH = isProduction ? 32 : 16

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Auth — required in every environment
  JWT_SECRET: z
    .string()
    .min(JWT_MIN_LENGTH, {
      message:
        `JWT_SECRET must be at least ${JWT_MIN_LENGTH} characters. ` +
        `Generate one with: openssl rand -hex 32`,
    }),

  // Database — required in every environment
  DATABASE_URL: z.string().min(1),

  // Public app URL — used for OAuth callbacks, redirects, and Stripe URLs
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:9002'),

  // Stripe — optional in dev, required in production if billing is enabled
  STRIPE_SECRET_KEY:       z.string().optional(),
  STRIPE_WEBHOOK_SECRET:   z.string().optional(),
  STRIPE_PRICE_SOLO:       z.string().optional(),
  STRIPE_PRICE_FIRM:       z.string().optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().optional(),

  // AWS S3 — optional in dev, required in production if document upload is enabled
  AWS_REGION:            z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID:     z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET_NAME:    z.string().optional(),

  // Microsoft OAuth — optional; required only if using the Microsoft connector
  MICROSOFT_CLIENT_ID:     z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_REDIRECT_URI:  z.string().url().optional(),

  // AI (Genkit / Google GenAI)
  GOOGLE_GENAI_API_KEY: z.string().optional(),

  // Slice 3 — connector credential envelope encryption
  // Production requires AWS_KMS_KEY_ID (KMS-backed KEK).
  // Dev/test can use CONNECTOR_KEK_B64 (32 bytes base64) — a local AES-256 KEK.
  AWS_KMS_KEY_ID:      z.string().optional(),
  CONNECTOR_KEK_B64:   z.string().optional(),
})

export type Env = z.infer<typeof schema>

function parse(): Env {
  // `next build` runs server code to collect page data. Real secrets live
  // in the runtime deploy environment, not in the build environment, so we
  // inject long-enough placeholders during that phase only. At runtime,
  // env.ts is re-parsed from process.env — a missing JWT_SECRET there still
  // crashes the server as intended.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    process.env.JWT_SECRET   ??=
      'build-time-placeholder-not-used-in-production-abcdef0123456789'
    process.env.DATABASE_URL ??= 'mysql://build:placeholder@localhost:3306/build'
  }

  const result = schema.safeParse(process.env)
  if (!result.success) {
    const errors = Object.entries(result.error.flatten().fieldErrors)
      .map(([k, v]) => `  ${k}: ${(v ?? []).join(', ')}`)
      .join('\n')
    // Fail closed. Better to crash at boot than run with bad config.
    throw new Error(`[env] Environment validation failed:\n${errors}`)
  }
  return result.data
}

export const env: Env = parse()

/**
 * Assert that a nominally-optional env var IS present. Use at the callsite
 * that actually needs it (e.g. Stripe webhook route asserts
 * STRIPE_WEBHOOK_SECRET), so a missing var fails at the moment of use with a
 * clear message rather than silently downstream.
 */
export function requireEnv<K extends keyof Env>(name: K): NonNullable<Env[K]> {
  const value = env[name]
  if (value === undefined || value === null || value === '') {
    throw new Error(`[env] ${String(name)} is required but not set`)
  }
  return value as NonNullable<Env[K]>
}
