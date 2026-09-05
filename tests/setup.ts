/**
 * Global Vitest setup — stub the env variables that some modules
 * (`src/lib/s3-client`, `src/lib/stripe`, `src/lib/auth-utils`) read at
 * module-init time. Values are placeholders — the real network calls are
 * mocked in each test file.
 */

// NODE_ENV is readonly in @types/node — vitest already sets it to 'test'
// automatically, so we don't touch it here.
process.env.AWS_REGION            ??= 'us-east-1'
process.env.AWS_ACCESS_KEY_ID     ??= 'test-key'
process.env.AWS_SECRET_ACCESS_KEY ??= 'test-secret'
process.env.AWS_S3_BUCKET_NAME    ??= 'test-bucket'
process.env.STRIPE_SECRET_KEY     ??= 'sk_test_placeholder'
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_test'
// Slice 2 — JWT_SECRET must be at least 16 chars in dev/test.
process.env.JWT_SECRET            ??= 'test-jwt-secret-at-least-32-chars-long'
process.env.DATABASE_URL          ??= 'mysql://test:test@localhost:3306/test'
process.env.NEXT_PUBLIC_APP_URL   ??= 'http://localhost:9002'
