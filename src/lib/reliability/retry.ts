/**
 * Retry with exponential backoff.
 *
 * Used by:
 *   - Slice-6 chained audit writes (already implemented inline).
 *   - Slice-15 QBO adapter fetches.
 *   - Slice-16 index refresh after a schema-drift retry.
 *
 * Rules:
 *   - Only retries on `shouldRetry(err)` returning true. Callers pass
 *     a predicate; defaults to "any error".
 *   - Backoff is jittered exponential (base × 2^attempt × [0.5, 1.5]).
 *   - Never retries more than `attempts` times.
 *   - Preserves the original error's message on final throw so the
 *     Slice-8 sanitizer still produces useful buckets.
 */

export interface RetryOptions {
  attempts?:    number      // total attempts including the first, default 3
  baseMs?:      number      // starting delay, default 200 ms
  maxMs?:       number      // ceiling per-attempt delay, default 5,000 ms
  shouldRetry?: (err: unknown, attempt: number) => boolean
  onRetry?:     (err: unknown, attempt: number, delayMs: number) => void
}

const DEFAULT_ATTEMPTS = 3
const DEFAULT_BASE_MS  = 200
const DEFAULT_MAX_MS   = 5_000

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS
  const base     = opts.baseMs   ?? DEFAULT_BASE_MS
  const max      = opts.maxMs    ?? DEFAULT_MAX_MS
  const should   = opts.shouldRetry ?? (() => true)

  let lastErr: unknown = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const isLast = attempt >= attempts - 1
      if (isLast || !should(err, attempt)) throw err
      const raw = base * Math.pow(2, attempt)
      const jitter = 0.5 + Math.random()   // [0.5, 1.5]
      const delayMs = Math.min(Math.round(raw * jitter), max)
      opts.onRetry?.(err, attempt, delayMs)
      await sleep(delayMs)
    }
  }
  throw lastErr
}

/**
 * Convenience predicate — retry only on transient-looking errors
 * (5xx from an HTTP call, ECONNRESET, timeout). Skips 4xx and
 * validation errors.
 */
export function isTransient(err: unknown): boolean {
  const asAny = err as { status?: number; code?: string; name?: string; message?: string }
  if (asAny?.status && asAny.status >= 500)          return true
  if (asAny?.code === 'ECONNRESET')                  return true
  if (asAny?.code === 'ETIMEDOUT')                   return true
  if (asAny?.name === 'AbortError')                  return true
  if (/timeout|network|econnreset/i.test(asAny?.message ?? '')) return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
