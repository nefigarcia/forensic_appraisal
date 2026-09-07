import { describe, it, expect } from 'vitest'
import { withRetry, isTransient } from '@/lib/reliability/retry'

describe('withRetry', () => {
  it('returns the first successful result without retrying', async () => {
    let calls = 0
    const r = await withRetry(async () => { calls++; return 'ok' })
    expect(r).toBe('ok'); expect(calls).toBe(1)
  })

  it('retries on failure up to the attempt limit', async () => {
    let calls = 0
    const r = await withRetry(async () => {
      calls++
      if (calls < 3) throw new Error('transient')
      return 'ok'
    }, { attempts: 3, baseMs: 1, maxMs: 5 })
    expect(r).toBe('ok'); expect(calls).toBe(3)
  })

  it('throws the LAST error when all attempts exhausted', async () => {
    let calls = 0
    await expect(withRetry(async () => {
      calls++
      throw new Error(`attempt ${calls} failed`)
    }, { attempts: 2, baseMs: 1, maxMs: 5 })).rejects.toThrow(/attempt 2 failed/)
    expect(calls).toBe(2)
  })

  it('shouldRetry=false bails immediately', async () => {
    let calls = 0
    await expect(withRetry(async () => {
      calls++; throw new Error('fatal')
    }, { attempts: 5, baseMs: 1, shouldRetry: () => false })).rejects.toThrow(/fatal/)
    expect(calls).toBe(1)
  })

  it('onRetry is invoked with attempt + delay per retry', async () => {
    const invocations: Array<{ attempt: number; delay: number }> = []
    await expect(withRetry(async () => { throw new Error('x') }, {
      attempts: 3, baseMs: 1, maxMs: 5,
      onRetry: (_e, attempt, delayMs) => { invocations.push({ attempt, delay: delayMs }) },
    })).rejects.toThrow()
    // 3 attempts → 2 retries
    expect(invocations.length).toBe(2)
    expect(invocations[0]!.attempt).toBe(0)
    expect(invocations[1]!.attempt).toBe(1)
  })
})

describe('isTransient', () => {
  it('true for 5xx status codes', () => {
    expect(isTransient({ status: 502 })).toBe(true)
    expect(isTransient({ status: 503 })).toBe(true)
  })
  it('false for 4xx status codes', () => {
    expect(isTransient({ status: 400 })).toBe(false)
    expect(isTransient({ status: 401 })).toBe(false)
    expect(isTransient({ status: 404 })).toBe(false)
  })
  it('true for network-shaped errors', () => {
    expect(isTransient({ code: 'ECONNRESET' })).toBe(true)
    expect(isTransient({ code: 'ETIMEDOUT' })).toBe(true)
    expect(isTransient({ name: 'AbortError' })).toBe(true)
    expect(isTransient({ message: 'network unreachable' })).toBe(true)
    expect(isTransient({ message: 'request timeout' })).toBe(true)
  })
  it('false for validation-shaped errors', () => {
    expect(isTransient(new Error('validation failed'))).toBe(false)
  })
})
