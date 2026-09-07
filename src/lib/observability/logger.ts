/**
 * Structured JSON logger.
 *
 * Every log line is a single JSON object with a stable field shape:
 *   { ts, level, msg, context?, err?, org?, user?, case? }
 *
 * Rationale:
 *   - Machine-parseable — a downstream log-aggregation service can
 *     query by level, org, user, case without regex parsing.
 *   - Fixed field names — never change, so log queries survive schema
 *     evolution.
 *   - Secret-scrubbing on write — the input is passed through the
 *     same scrubber used by Slice-8's AI execution wrapper so a
 *     token in a stack trace does not leak to disk.
 *
 * NOT a replacement for the Slice-6 audit chain. `logAction` remains
 * the authoritative chain-of-custody surface. This module is for
 * operational logging (job start/stop, network errors, degraded-mode
 * fallbacks) that would otherwise land on `console.error`.
 */

import { sanitizeErrorMessage } from '@/lib/ai/execution'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  organizationId?: string
  userId?:         string
  caseId?:         string
  runId?:          string
  requestId?:      string
  [k: string]:     unknown
}

export interface StructuredLogEvent {
  ts:      string
  level:   LogLevel
  msg:     string
  context?: LogContext
  err?:     { name: string; message: string; category?: string }
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** Read the minimum log level from LOG_LEVEL, defaulting to 'info' in
 *  production, 'debug' otherwise. */
function envMinLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[envMinLevel()]
}

/**
 * Emit a single structured event. The current implementation writes
 * to stdout (level `info`/`debug`) or stderr (level `warn`/`error`).
 * A future slice can plug in a transport (Datadog, Vercel logs,
 * OpenTelemetry) without touching call sites.
 */
export function log(level: LogLevel, msg: string, context?: LogContext, err?: unknown): void {
  if (!shouldLog(level)) return
  const event: StructuredLogEvent = {
    ts:      new Date().toISOString(),
    level,
    msg,
  }
  if (context && Object.keys(context).length > 0) event.context = scrubContext(context)
  if (err != null) {
    const asAny = err as { name?: string; message?: string; category?: string }
    event.err = {
      name:    asAny?.name ?? 'Error',
      message: sanitizeErrorMessage(err),
      ...(asAny?.category ? { category: asAny.category } : {}),
    }
  }
  const line = JSON.stringify(event)
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else                                       process.stdout.write(line + '\n')
  // Ship to any configured error tracker.
  if (level === 'error') captureErrorHook(event)
}

/** Convenience wrappers. */
export const logger = {
  debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
  info:  (msg: string, ctx?: LogContext) => log('info',  msg, ctx),
  warn:  (msg: string, ctx?: LogContext, err?: unknown) => log('warn',  msg, ctx, err),
  error: (msg: string, ctx?: LogContext, err?: unknown) => log('error', msg, ctx, err),
}

// ─────────────────────────────────────────────────
// Secret scrubbing
// ─────────────────────────────────────────────────

const SECRET_KEYS = new Set([
  'password', 'accessToken', 'refreshToken', 'apiKey',
  'authorization', 'authorizationHeader', 'clientSecret',
  'jwt', 'sessionToken', 'stripeKey', 'secret',
])

function scrubContext(ctx: LogContext): LogContext {
  const out: LogContext = {}
  for (const [k, v] of Object.entries(ctx)) {
    if (SECRET_KEYS.has(k)) continue
    if (typeof v === 'string' && v.length > 500) { out[k] = v.slice(0, 500) + '…'; continue }
    out[k] = v
  }
  return out
}

// ─────────────────────────────────────────────────
// Error-tracker hook
// ─────────────────────────────────────────────────

export type ErrorHook = (event: StructuredLogEvent) => void

let hook: ErrorHook | null = null

/**
 * Register an error-tracker hook (e.g. Sentry, Bugsnag, Datadog).
 *
 * Call once at startup. The default is null — logs still land on
 * stderr, but no external service is contacted. This keeps the
 * dependency graph clean and the hook optional.
 */
export function registerErrorHook(fn: ErrorHook | null): void {
  hook = fn
}

function captureErrorHook(event: StructuredLogEvent): void {
  if (!hook) return
  try { hook(event) } catch { /* never crash the app on a hook failure */ }
}
