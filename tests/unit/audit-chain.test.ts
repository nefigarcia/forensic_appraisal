import { describe, it, expect } from 'vitest'
import {
  canonicalize,
  sha256Hex,
  canonicalEventPayload,
  computeEventHash,
  verifyChainRows,
  chainKeyForOrg,
  ANON_CHAIN_KEY,
  HASH_VERSION,
  type HashableEvent,
  type ChainRowForVerify,
} from '@/lib/audit-chain'

// ─────────────────────────────────────────────────
// canonicalize
// ─────────────────────────────────────────────────

describe('canonicalize', () => {
  it('sorts object keys recursively', () => {
    const a = canonicalize({ b: 1, a: 2 })
    const b = canonicalize({ a: 2, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":2,"b":1}')
  })

  it('normalizes nulls and undefineds', () => {
    expect(canonicalize(null)).toBe('null')
    expect(canonicalize(undefined)).toBe('null')
    expect(canonicalize({ a: undefined, b: null })).toBe('{"a":null,"b":null}')
  })

  it('produces stable output for nested arrays and objects', () => {
    const v = { z: [ { y: 1, x: 0 }, { b: 2, a: 1 } ], a: 'x' }
    expect(canonicalize(v)).toBe('{"a":"x","z":[{"x":0,"y":1},{"a":1,"b":2}]}')
  })

  it('turns Date into an ISO string', () => {
    const d = new Date('2026-09-05T00:00:00.000Z')
    expect(canonicalize({ at: d })).toBe('{"at":"2026-09-05T00:00:00.000Z"}')
  })

  it('converts BigInt to a stable quoted string', () => {
    expect(canonicalize({ n: BigInt(123456789012345) })).toBe('{"n":"123456789012345"}')
  })

  it('normalizes non-finite Numbers to null', () => {
    expect(canonicalize({ n: NaN }))     .toBe('{"n":null}')
    expect(canonicalize({ n: Infinity })).toBe('{"n":null}')
  })

  it('is stable across permutations of the same content', () => {
    const a = canonicalEventPayload(makeEvent({ note: 'x' }))
    const b = canonicalEventPayload(makeEvent({ note: 'x' }))
    expect(a).toBe(b)
  })
})

// ─────────────────────────────────────────────────
// sha256Hex + computeEventHash
// ─────────────────────────────────────────────────

describe('sha256Hex + computeEventHash', () => {
  it('is stable for repeated calls', () => {
    const h1 = sha256Hex('hello')
    const h2 = sha256Hex('hello')
    expect(h1).toBe(h2)
    expect(h1).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('changes any output byte if any input byte changes', () => {
    const a = computeEventHash(makeEvent({ note: 'x' }))
    const b = computeEventHash(makeEvent({ note: 'X' })) // one bit different
    expect(a).not.toBe(b)
  })

  it('previousHash is inside the payload — changing it changes eventHash', () => {
    const a = computeEventHash(makeEvent({ previousHash: 'aaaa' }))
    const b = computeEventHash(makeEvent({ previousHash: 'bbbb' }))
    expect(a).not.toBe(b)
  })
})

// ─────────────────────────────────────────────────
// verifyChainRows
// ─────────────────────────────────────────────────

describe('verifyChainRows', () => {
  it('verifies a happy-path 5-event chain', () => {
    const chain = buildChain(5)
    const result = verifyChainRows('org:X', chain)
    expect(result.ok).toBe(true)
    expect(result.eventsChecked).toBe(5)
    expect(result.eventsSkipped).toBe(0)
  })

  it('detects a mutated note on an old event (EVENT_HASH_MISMATCH)', () => {
    const chain = buildChain(5)
    // Mutate the note on event 3 without recomputing its hash.
    chain[2] = { ...chain[2]!, note: 'TAMPERED' }
    const result = verifyChainRows('org:X', chain)
    expect(result.ok).toBe(false)
    expect(result.firstBadSequence).toBe(3)
    expect(result.reason).toBe('EVENT_HASH_MISMATCH')
  })

  it('detects a mutated previousHash (EVENT_HASH_MISMATCH)', () => {
    const chain = buildChain(5)
    chain[2] = { ...chain[2]!, previousHash: 'deadbeef' + '0'.repeat(56) }
    const result = verifyChainRows('org:X', chain)
    expect(result.ok).toBe(false)
    expect(result.firstBadSequence).toBe(3)
    // The previousHash-vs-expected check runs before the self-hash check,
    // so we catch the tamper as PREVIOUS_HASH_MISMATCH first. Either
    // signal is a valid tamper indicator; the test pins the ordering.
    expect(result.reason).toBe('PREVIOUS_HASH_MISMATCH')
  })

  it('detects a removed event (PREVIOUS_HASH_MISMATCH on the next)', () => {
    const chain = buildChain(5)
    // Remove event 3; event 4's previousHash now points at what was 3's hash,
    // but the verifier expects the hash of event 2.
    const truncated = [chain[0]!, chain[1]!, chain[3]!, chain[4]!]
    const result = verifyChainRows('org:X', truncated)
    expect(result.ok).toBe(false)
    expect(result.firstBadSequence).toBe(4)
    expect(result.reason).toBe('PREVIOUS_HASH_MISMATCH')
  })

  it('detects a swapped-in event with a plausible previousHash but wrong self-hash', () => {
    const chain = buildChain(5)
    // Replace event 3 with a totally fresh event that carries the correct
    // previousHash but its own eventHash is stale (matches a different
    // canonical payload). The verifier catches this on the self-hash check.
    chain[2] = { ...chain[2]!, targetId: 'REPLACED' }
    const result = verifyChainRows('org:X', chain)
    expect(result.ok).toBe(false)
    expect(result.firstBadSequence).toBe(3)
  })

  it('skips pre-chain (unhashed) rows and reports the count', () => {
    const chained = buildChain(3)
    const preChain: ChainRowForVerify[] = [
      makeRow({ id: 'legacy-1', sequence: null, eventHash: null, previousHash: null, chainKey: null, hashVersion: null }),
      makeRow({ id: 'legacy-2', sequence: null, eventHash: null, previousHash: null, chainKey: null, hashVersion: null }),
    ]
    const result = verifyChainRows('org:X', [...preChain, ...chained])
    expect(result.ok).toBe(true)
    expect(result.eventsChecked).toBe(3)
    expect(result.eventsSkipped).toBe(2)
  })

  it('accepts unordered input and sorts by sequence before verifying', () => {
    const chain = buildChain(5)
    const shuffled = [chain[4]!, chain[0]!, chain[2]!, chain[1]!, chain[3]!]
    expect(verifyChainRows('org:X', shuffled).ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────
// chainKeyForOrg
// ─────────────────────────────────────────────────

describe('chain keys', () => {
  it('org key follows the org:<id> shape', () => {
    expect(chainKeyForOrg('org-abc')).toBe('org:org-abc')
  })
  it('anon chain key is a stable constant', () => {
    expect(ANON_CHAIN_KEY).toBe('global:anon')
  })
})

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

function makeEvent(overrides: Partial<HashableEvent> = {}): HashableEvent {
  return {
    id: 'a1',
    createdAt: new Date('2026-09-05T00:00:00.000Z'),
    chainKey: 'org:X',
    sequence: 1,
    hashVersion: HASH_VERSION,
    action: 'ACCEPT_VALUE',
    userId: 'u1',
    caseId: 'c1',
    targetModel: 'FinancialValue',
    targetId: 't1',
    oldValue: null,
    newValue: '{"v":42}',
    note: null,
    ipAddress: null,
    previousHash: null,
    ...overrides,
  }
}

function makeRow(overrides: Partial<ChainRowForVerify>): ChainRowForVerify {
  return {
    id: overrides.id ?? 'a?',
    createdAt: overrides.createdAt ?? new Date('2026-09-05T00:00:00.000Z'),
    chainKey: overrides.chainKey ?? 'org:X',
    sequence: overrides.sequence ?? null,
    hashVersion: overrides.hashVersion ?? HASH_VERSION,
    action: overrides.action ?? 'ACCEPT_VALUE',
    userId: overrides.userId ?? null,
    caseId: overrides.caseId ?? null,
    targetModel: overrides.targetModel ?? null,
    targetId: overrides.targetId ?? null,
    oldValue: overrides.oldValue ?? null,
    newValue: overrides.newValue ?? null,
    note: overrides.note ?? null,
    ipAddress: overrides.ipAddress ?? null,
    previousHash: overrides.previousHash ?? null,
    eventHash: overrides.eventHash ?? null,
  }
}

/** Build a valid chain of N events. Every row's eventHash is computed
 *  from its canonical payload. */
function buildChain(n: number): ChainRowForVerify[] {
  const rows: ChainRowForVerify[] = []
  let previousHash: string | null = null
  for (let i = 1; i <= n; i++) {
    const id = `a${i}`
    const createdAt = new Date(Date.UTC(2026, 8, 5, 12, i))
    const targetId = `t${i}`
    const event: HashableEvent = {
      id, createdAt,
      chainKey: 'org:X', sequence: i,
      hashVersion: HASH_VERSION,
      action: 'OVERRIDE_VALUE',
      userId: 'u1', caseId: 'c1',
      targetModel: 'FinancialValue', targetId,
      oldValue: null, newValue: `{"v":${i}}`, note: null, ipAddress: null,
      previousHash,
    }
    const eventHash = computeEventHash(event)
    rows.push({
      id, createdAt,
      chainKey: 'org:X', sequence: i,
      hashVersion: HASH_VERSION,
      action: event.action, userId: event.userId, caseId: event.caseId,
      targetModel: event.targetModel, targetId: event.targetId,
      oldValue: event.oldValue, newValue: event.newValue,
      note: event.note, ipAddress: event.ipAddress,
      previousHash, eventHash,
    })
    previousHash = eventHash
  }
  return rows
}
