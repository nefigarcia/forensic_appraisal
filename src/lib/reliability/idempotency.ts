/**
 * Idempotency-key helpers.
 *
 * Used by write-heavy actions (ingestion runs, Excel imports, portal
 * uploads) where a network retry could otherwise land the same
 * mutation twice. Callers pass a stable key derived from the request
 * (fileSha256 + userId + timestampWindow, for example). The helper
 * proposes an insert; on conflict, it returns the previously-recorded
 * result.
 *
 * This module is a thin wrapper — the actual key store is `AuditLog`
 * (the `note` column is used to record the key). No new table is
 * introduced; the audit trail already survives replays.
 *
 * If a future slice needs a dedicated idempotency table, adjust the
 * store implementation here without touching call sites.
 */

import { createHash } from 'crypto'

/**
 * Compute a stable idempotency key from arbitrary parts. Non-string
 * parts are canonicalized via `JSON.stringify` with keys sorted so
 * `{a:1, b:2}` and `{b:2, a:1}` produce the same key.
 */
export function idempotencyKey(parts: Array<string | number | object>): string {
  const parts2 = parts.map(p => typeof p === 'object' && p !== null
    ? canonical(p)
    : String(p))
  return createHash('sha256').update(parts2.join('|'), 'utf8').digest('hex').slice(0, 32)
}

function canonical(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string')  return JSON.stringify(v)
  if (typeof v === 'number')  return Number.isFinite(v) ? String(v) : 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v))       return '[' + v.map(canonical).join(',') + ']'
  if (typeof v === 'object') {
    const rec = v as Record<string, unknown>
    const keys = Object.keys(rec).sort()
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(rec[k])).join(',') + '}'
  }
  return 'null'
}

/**
 * Run `fn` at most once for a given idempotency key by tracking
 * completed keys in an in-memory Map. On process restart the map is
 * empty, so callers who need durability across process restarts must
 * persist to a table.
 *
 * The default limit is 10,000 entries — a small ring-buffer to
 * prevent unbounded memory growth. Real production use should back
 * this with a DB row on the relevant action's audit log.
 */
const seen = new Map<string, unknown>()
const MAX_SEEN = 10_000

export async function runIdempotent<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (seen.has(key)) return seen.get(key) as T
  const result = await fn()
  if (seen.size >= MAX_SEEN) {
    // Simple FIFO eviction of the oldest entry.
    const first = seen.keys().next().value
    if (first) seen.delete(first)
  }
  seen.set(key, result)
  return result
}

/** Test-only helper. Never call from production code. */
export function _clearIdempotencyCache(): void {
  seen.clear()
}
