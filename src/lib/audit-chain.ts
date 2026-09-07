/**
 * Tamper-evident audit hash chain.
 *
 * Slice 6 introduces a per-organization append-only chain over AuditLog
 * rows. Every new event carries a `sequence`, a `previousHash` (pointing
 * at the prior event's hash), and its own `eventHash` — SHA-256 over a
 * canonical, sorted-keys serialization that *includes* `previousHash`.
 *
 * What this gives us:
 *   - **Tamper evidence.** Any change to a chained row — a note, a
 *     targetId, previousHash, even createdAt — changes the eventHash and
 *     breaks the chain from that point forward. `verifyChain` reports the
 *     first invalid link.
 *   - **Deletion evidence.** Removing an event changes the next event's
 *     effective previous, so the next `previousHash` mismatches. Same
 *     signal.
 *
 * What this does NOT give us:
 *   - **Tamper prevention.** A DB admin with UPDATE privilege can rewrite
 *     everything. Preventing that is a DB-role / audit-user problem, not
 *     an application-layer one.
 *   - **Non-repudiation.** No external notarization is performed; a
 *     future slice can anchor periodic tips to a public timestamping
 *     service.
 *   - **"Blockchain" anything.** This is a linked list of hashes. It is
 *     good forensic evidence — it is not a distributed ledger and it is
 *     not legal certification.
 *
 * Chain keys:
 *   - `org:<organizationId>` — every event we can tie to an org, whether
 *     directly (organizationId param), via `caseId → Case → org`, or via
 *     `userId → User → org`.
 *   - `global:anon` — events with no discoverable org (LOGIN_FAIL for an
 *     unknown email, LOGIN_RATE_LIMITED). Verifiable by any admin.
 */

import { createHash } from 'crypto'

// ─────────────────────────────────────────────────
// Canonical serialization
// ─────────────────────────────────────────────────

/**
 * Deterministic JSON. Sorted keys, Date → ISO string, non-finite Numbers
 * → null, no distinction between `undefined` and `null` (both → null).
 *
 * Nested objects and arrays are handled recursively so a payload like
 *   { b: 2, a: [ { y: 1, x: 0 } ] }
 * always serializes as
 *   {"a":[{"x":0,"y":1}],"b":2}
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string')  return JSON.stringify(value)
  if (typeof value === 'number')  return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'bigint')  return `"${value.toString()}"` // stable string form
  if (value instanceof Date)      return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']'
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return '{' + keys
      .map(k => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k]))
      .join(',') + '}'
  }
  return 'null'
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

// ─────────────────────────────────────────────────
// Event payload shape
// ─────────────────────────────────────────────────

/**
 * The fields we hash. `id`, `createdAt`, `chainKey`, `sequence`,
 * `previousHash`, and `hashVersion` are known BEFORE hashing (id and
 * createdAt come from cuid()/`now()` — we compute them client-side inside
 * the transaction and pass them explicitly to Prisma).
 */
export interface HashableEvent {
  id:            string
  createdAt:     Date | string
  chainKey:      string
  sequence:      number
  hashVersion:   string
  action:        string
  userId:        string | null
  caseId:        string | null
  targetModel:   string | null
  targetId:      string | null
  oldValue:      string | null
  newValue:      string | null
  note:          string | null
  ipAddress:     string | null
  previousHash:  string | null
}

/**
 * Serialize an event into its canonical form. `previousHash` is included
 * in the payload so tampering with it — or removing a row and shifting
 * the chain — breaks the current row's `eventHash`.
 */
export function canonicalEventPayload(event: HashableEvent): string {
  const at = event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt
  return canonicalize({
    id:            event.id,
    createdAt:     at,
    chainKey:      event.chainKey,
    sequence:      event.sequence,
    hashVersion:   event.hashVersion,
    action:        event.action,
    userId:        event.userId ?? null,
    caseId:        event.caseId ?? null,
    targetModel:   event.targetModel ?? null,
    targetId:      event.targetId ?? null,
    oldValue:      event.oldValue ?? null,
    newValue:      event.newValue ?? null,
    note:          event.note ?? null,
    ipAddress:     event.ipAddress ?? null,
    previousHash:  event.previousHash ?? null,
  })
}

export function computeEventHash(event: HashableEvent): string {
  return sha256Hex(canonicalEventPayload(event))
}

// ─────────────────────────────────────────────────
// Chain-key helpers
// ─────────────────────────────────────────────────

export function chainKeyForOrg(organizationId: string): string {
  return `org:${organizationId}`
}
export const ANON_CHAIN_KEY = 'global:anon'
export const HASH_VERSION   = 'v1'

// ─────────────────────────────────────────────────
// Verifier
// ─────────────────────────────────────────────────

export interface ChainRowForVerify {
  id:            string
  createdAt:     Date
  chainKey:      string | null
  sequence:      number | null
  hashVersion:   string | null
  action:        string
  userId:        string | null
  caseId:        string | null
  targetModel:   string | null
  targetId:      string | null
  oldValue:      string | null
  newValue:      string | null
  note:          string | null
  ipAddress:     string | null
  previousHash:  string | null
  eventHash:     string | null
}

export interface VerifyResult {
  ok:             boolean
  chainKey:       string
  eventsChecked:  number
  eventsSkipped:  number
  firstBadSequence?: number
  firstBadEventId?:  string
  reason?:        'PREVIOUS_HASH_MISMATCH' | 'EVENT_HASH_MISMATCH' | 'MISSING_HASH_FIELDS'
  message?:       string
}

/**
 * Verify a chain in order. Rows without `sequence` / `eventHash` are
 * treated as pre-Slice-6 legacy and skipped (their count is reported).
 *
 * Returns the first invalid link — the caller can highlight it in the UI.
 */
export function verifyChainRows(chainKey: string, rows: ChainRowForVerify[]): VerifyResult {
  let expectedPrevious: string | null = null
  let checked = 0
  let skipped = 0
  const chained = rows.filter(r => r.sequence !== null && r.eventHash !== null)
  // Sort in-place by sequence so a caller who forgot to order is safe.
  chained.sort((a, b) => (a.sequence! - b.sequence!))
  skipped = rows.length - chained.length

  for (const row of chained) {
    if (row.hashVersion == null) {
      return {
        ok: false, chainKey, eventsChecked: checked, eventsSkipped: skipped,
        firstBadSequence: row.sequence!, firstBadEventId: row.id,
        reason: 'MISSING_HASH_FIELDS',
        message: `Row #${row.sequence} lacks hashVersion`,
      }
    }
    if ((row.previousHash ?? null) !== expectedPrevious) {
      return {
        ok: false, chainKey, eventsChecked: checked, eventsSkipped: skipped,
        firstBadSequence: row.sequence!, firstBadEventId: row.id,
        reason: 'PREVIOUS_HASH_MISMATCH',
        message: `Row #${row.sequence} previousHash does not match prior eventHash`,
      }
    }
    const recomputed = computeEventHash({
      id:            row.id,
      createdAt:     row.createdAt,
      chainKey,
      sequence:      row.sequence!,
      hashVersion:   row.hashVersion,
      action:        row.action,
      userId:        row.userId,
      caseId:        row.caseId,
      targetModel:   row.targetModel,
      targetId:      row.targetId,
      oldValue:      row.oldValue,
      newValue:      row.newValue,
      note:          row.note,
      ipAddress:     row.ipAddress,
      previousHash:  row.previousHash,
    })
    if (recomputed !== row.eventHash) {
      return {
        ok: false, chainKey, eventsChecked: checked, eventsSkipped: skipped,
        firstBadSequence: row.sequence!, firstBadEventId: row.id,
        reason: 'EVENT_HASH_MISMATCH',
        message: `Row #${row.sequence} eventHash does not match canonical payload`,
      }
    }
    expectedPrevious = row.eventHash
    checked++
  }

  return { ok: true, chainKey, eventsChecked: checked, eventsSkipped: skipped }
}
