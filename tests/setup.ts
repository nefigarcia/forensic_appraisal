/**
 * Global Vitest setup — stub the env variables that some modules
 * (`src/lib/s3-client`, `src/lib/stripe`, `src/lib/auth-utils`) read at
 * module-init time. Values are placeholders — the real network calls are
 * mocked in each test file.
 */

process.env.AWS_REGION            ??= 'us-east-1'
process.env.AWS_ACCESS_KEY_ID     ??= 'test-key'
process.env.AWS_SECRET_ACCESS_KEY ??= 'test-secret'
process.env.AWS_S3_BUCKET_NAME    ??= 'test-bucket'
process.env.STRIPE_SECRET_KEY     ??= 'sk_test_placeholder'
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_test'
process.env.JWT_SECRET            ??= 'test-jwt-secret'
process.env.NEXT_PUBLIC_APP_URL   ??= 'http://localhost:9002'
