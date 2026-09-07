/**
 * Readiness probe.
 *
 * Confirms the process can serve traffic by exercising the load-
 * bearing dependencies:
 *
 *   - Database        (Prisma `SELECT 1`)
 *   - S3 bucket name  (env presence only; no network call)
 *
 * Returns 200 with per-check status; returns 503 when any check
 * fails, so a load balancer can drain traffic during a degraded
 * window without restarting the process.
 *
 * The endpoint never divulges internal error messages — a hostile
 * caller learns only the boolean pass/fail per check.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const started = Date.now()
  const checks: Record<string, 'ok' | 'fail'> = {}
  let overall: 'ok' | 'fail' = 'ok'

  // ── Database ─────────────────────────────────────
  try {
    // Prisma exposes `$queryRaw` — parameter-free by construction.
    await prisma.$queryRawUnsafe('SELECT 1')
    checks.db = 'ok'
  } catch (err) {
    checks.db = 'fail'
    overall   = 'fail'
    logger.error('readiness: db check failed', {}, err)
  }

  // ── S3 configuration ─────────────────────────────
  // We do NOT call S3 — bucket policies (list/head) can be denied
  // even when the app can write. Presence of the env var is the
  // signal.
  if (process.env.AWS_S3_BUCKET_NAME && process.env.AWS_REGION) {
    checks.s3 = 'ok'
  } else if (process.env.NODE_ENV === 'production') {
    checks.s3 = 'fail'
    overall   = 'fail'
  } else {
    checks.s3 = 'ok'
  }

  const status = overall === 'ok' ? 200 : 503
  return NextResponse.json({
    status: overall,
    checks,
    durationMs: Date.now() - started,
  }, { status })
}
