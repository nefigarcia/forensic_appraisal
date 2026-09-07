import { describe, it, expect, beforeEach } from 'vitest'
import {
  idempotencyKey, runIdempotent, _clearIdempotencyCache,
} from '@/lib/reliability/idempotency'

beforeEach(() => _clearIdempotencyCache())

describe('idempotencyKey', () => {
  it('is deterministic for the same input parts', () => {
    const a = idempotencyKey(['ingest', 'case-1', 'QUICKBOOKS', 'P_AND_L', 42])
    const b = idempotencyKey(['ingest', 'case-1', 'QUICKBOOKS', 'P_AND_L', 42])
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
  })

  it('is stable across object-key reorder', () => {
    const a = idempotencyKey([{ a: 1, b: 2 }])
    const b = idempotencyKey([{ b: 2, a: 1 }])
    expect(a).toBe(b)
  })

  it('changes when any part changes', () => {
    const a = idempotencyKey(['case-1'])
    const b = idempotencyKey(['case-2'])
    expect(a).not.toBe(b)
  })
})

describe('runIdempotent', () => {
  it('runs the fn only once per key', async () => {
    let calls = 0
    const k = 'K1'
    const r1 = await runIdempotent(k, async () => { calls++; return { x: 42 } })
    const r2 = await runIdempotent(k, async () => { calls++; return { x: 99 } })
    expect(calls).toBe(1)
    expect(r1).toEqual(r2)
    expect(r1).toEqual({ x: 42 })
  })

  it('different keys → distinct executions', async () => {
    let calls = 0
    await runIdempotent('K1', async () => { calls++; return 'a' })
    await runIdempotent('K2', async () => { calls++; return 'b' })
    expect(calls).toBe(2)
  })

  it('cache clears reset the memoization', async () => {
    let calls = 0
    await runIdempotent('K1', async () => { calls++; return 'ok' })
    expect(calls).toBe(1)
    _clearIdempotencyCache()
    await runIdempotent('K1', async () => { calls++; return 'ok' })
    expect(calls).toBe(2)
  })
})
