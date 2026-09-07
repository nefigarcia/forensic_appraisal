/**
 * withAIExecution — the single wrapper every AI-flow call goes through.
 *
 * What it records (persisted to AiExecution):
 *   - who ran what: organizationId, caseId, userId
 *   - flow identity: name + human version + prompt-template key
 *   - model identity: provider + name (+ optional model version)
 *   - data provenance: sha256(scrubbed input), sha256(output), and a
 *     JSON array of DocumentVersion ids the input references
 *   - timing: startedAt, completedAt, durationMs
 *   - result: status, errorCategory, errorMessage
 *
 * What it does NOT persist (Rules 2 and 3):
 *   - the raw prompt template  (bytes stay in code; only the template
 *     key + human version label are stored)
 *   - the raw model output      (only its hash)
 *   - the document data URI    (replaced with `[data-uri:<byteLen>]`
 *     before hashing; the immutable DocumentVersion.sha256Hash and the
 *     documentVersionIds column are the persisted provenance signal)
 *   - any known secret key     (accessToken, refreshToken, password,
 *     apiKey, etc.)
 *   - error stack traces       (only the sanitized message +
 *     categorization)
 */

import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { metadataFor } from './flow-metadata'
import type { SessionPayload } from '@/lib/auth-utils'

// ─────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────

export interface WithAIExecutionContext {
  session: SessionPayload
  /** Optional case scope. Some flows (industry code, binder query with no
   *  case context) leave this null. */
  caseId?: string
  /** Which flow this call runs. Must be a key of FLOW_METADATA. */
  flowName: string
  /** DocumentVersion ids that fed this run. Empty when no docs are input. */
  documentVersionIds?: string[]
  /** Optional model-version override, if the API surfaced one. */
  modelVersion?: string
}

export interface AIExecutionResult<T> {
  output: T
  executionId: string
}

/**
 * Wrap a Genkit-flow call (or any async function) with observability. On
 * success, the AiExecution row is updated with the output hash and
 * timing. On failure, the row records the error category + sanitized
 * message and the exception is re-thrown so the caller's UX layer can
 * surface it.
 */
export async function withAIExecution<TIn, TOut>(
  ctx: WithAIExecutionContext,
  input: TIn,
  fn: (input: TIn) => Promise<TOut>,
): Promise<AIExecutionResult<TOut>> {
  const meta = metadataFor(ctx.flowName)

  const inputHash = hashScrubbed(input)
  const startedAt = new Date()

  const execution = await prisma.aiExecution.create({
    data: {
      organizationId:     ctx.session.organizationId,
      caseId:             ctx.caseId,
      userId:             ctx.session.userId,
      flowName:           meta.flowName,
      flowVersion:        meta.flowVersion,
      promptTemplateKey:  meta.promptTemplateKey,
      // promptTemplateHash left null in Slice 8 — see flow-metadata.ts
      // for the rationale (Genkit hides the interpolated template).
      modelProvider:      meta.modelProvider,
      modelName:          meta.modelName,
      modelVersion:       ctx.modelVersion ?? meta.modelVersion,
      inputHash,
      documentVersionIds: ctx.documentVersionIds && ctx.documentVersionIds.length > 0
        ? ctx.documentVersionIds
        : undefined,
      startedAt,
      status: 'RUNNING',
    },
  })

  try {
    const output = await fn(input)
    const completedAt = new Date()
    await prisma.aiExecution.update({
      where: { id: execution.id },
      data: {
        status:      'SUCCESS',
        completedAt,
        durationMs:  completedAt.getTime() - startedAt.getTime(),
        outputHash:  hashScrubbed(output),
      },
    })
    return { output, executionId: execution.id }
  } catch (err) {
    const completedAt = new Date()
    await prisma.aiExecution.update({
      where: { id: execution.id },
      data: {
        status:        'FAILURE',
        completedAt,
        durationMs:    completedAt.getTime() - startedAt.getTime(),
        errorCategory: categorizeError(err),
        errorMessage:  sanitizeErrorMessage(err),
      },
    }).catch(() => { /* audit-style: never crash on a follow-up write */ })
    throw err
  }
}

// ─────────────────────────────────────────────────
// Input/output hashing with scrubbing
// ─────────────────────────────────────────────────

/** Known-secret keys we NEVER include in a hash payload. */
const SECRET_KEYS = new Set([
  'accessToken', 'refreshToken', 'apiKey', 'password',
  'authorization', 'authorizationHeader', 'clientSecret',
  'jwt', 'sessionToken', 'stripeKey',
])

/**
 * Canonical, secret-scrubbed serialization. Data URIs are replaced with
 * a length tag so two different documents produce different hashes
 * without leaking bytes. Known secret keys are dropped entirely.
 */
export function scrubbedCanonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return JSON.stringify(`[data-uri:${value.length}]`)
    return JSON.stringify(value)
  }
  if (typeof value === 'number')  return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'bigint')  return `"${value.toString()}"`
  if (value instanceof Date)      return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) {
    return '[' + value.map(scrubbedCanonicalize).join(',') + ']'
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
      .filter(k => !SECRET_KEYS.has(k))
      .sort()
    return '{' + keys
      .map(k => JSON.stringify(k) + ':' + scrubbedCanonicalize((value as Record<string, unknown>)[k]))
      .join(',') + '}'
  }
  return 'null'
}

export function hashScrubbed(value: unknown): string {
  return createHash('sha256').update(scrubbedCanonicalize(value), 'utf8').digest('hex')
}

// ─────────────────────────────────────────────────
// Error categorization + sanitization
// ─────────────────────────────────────────────────

export type ErrorCategory =
  | 'MODEL_TIMEOUT'
  | 'SCHEMA_VALIDATION'
  | 'RATE_LIMIT'
  | 'REFUSED'
  | 'INFRA'
  | 'UNKNOWN'

/**
 * Best-effort classification. We inspect the error name + message
 * without ever pulling in a stack trace. If nothing fits, UNKNOWN.
 */
export function categorizeError(err: unknown): ErrorCategory {
  const msg  = (err as { message?: string })?.message ?? ''
  const name = (err as { name?: string })?.name ?? ''
  const code = (err as { code?: string | number })?.code
  const status = (err as { status?: number })?.status

  if (name === 'ZodError' || /schema/i.test(msg) && /invalid/i.test(msg)) return 'SCHEMA_VALIDATION'
  if (status === 408 || /timed out/i.test(msg) || /timeout/i.test(msg))   return 'MODEL_TIMEOUT'
  if (status === 429 || /rate limit/i.test(msg) || /quota/i.test(msg))    return 'RATE_LIMIT'
  if (/safety|blocked|refused|policy/i.test(msg))                         return 'REFUSED'
  if (code === 'ECONNRESET' || code === 'ENOTFOUND' || /network/i.test(msg)) return 'INFRA'
  if (status && status >= 500)                                            return 'INFRA'
  return 'UNKNOWN'
}

/**
 * Redact a single-line, capped message. We never persist stack traces —
 * they can carry file paths or embedded config.
 */
export function sanitizeErrorMessage(err: unknown): string {
  const raw = (err as { message?: string })?.message ?? String(err)
  // Strip common secret-shaped substrings just in case a downstream lib
  // leaked one into the message.
  const scrubbed = raw
    // Stripe-style: sk_live_..., sk_test_... — the tail carries underscores.
    .replace(/sk_[a-zA-Z0-9_]{16,}/g, '[stripe-key]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '[jwt]')
  // One line, capped at 500 chars — plenty for a category-level signal.
  return scrubbed.replace(/\s+/g, ' ').trim().slice(0, 500)
}
