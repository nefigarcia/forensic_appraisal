/**
 * Liveness probe.
 *
 * Purpose:
 *   The kubelet / load balancer uses this to decide whether the
 *   process is running. It does NOT check the DB, S3, or any external
 *   dependency — a slow DB should not restart the process.
 *
 * Returns `{ status: 'ok', uptime: <seconds> }` with a 200. Never
 * throws.
 *
 * Readiness is a separate endpoint (`/api/health/ready`) that does
 * check the DB and is polled at a different cadence.
 */

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    version: process.env.npm_package_version ?? 'unknown',
  })
}
