import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger, log, registerErrorHook } from '@/lib/observability/logger'

let outLines: string[] = []
let errLines: string[] = []
let realStdout: any, realStderr: any

beforeEach(() => {
  outLines = []; errLines = []
  realStdout = process.stdout.write
  realStderr = process.stderr.write
  process.stdout.write = ((chunk: any) => { outLines.push(String(chunk)); return true }) as any
  process.stderr.write = ((chunk: any) => { errLines.push(String(chunk)); return true }) as any
  vi.stubEnv('LOG_LEVEL', 'debug')
})

afterEach(() => {
  process.stdout.write = realStdout
  process.stderr.write = realStderr
  vi.unstubAllEnvs()
  registerErrorHook(null)
})

describe('structured logger', () => {
  it('every emitted line is valid JSON', () => {
    logger.info('hello', { caseId: 'case-1' })
    expect(outLines.length).toBe(1)
    const evt = JSON.parse(outLines[0]!.trim())
    expect(evt.msg).toBe('hello')
    expect(evt.level).toBe('info')
    expect(evt.context.caseId).toBe('case-1')
    expect(evt.ts).toMatch(/T.*Z$/)
  })

  it('warn and error land on stderr; info and debug land on stdout', () => {
    logger.info('i');  logger.debug('d')
    logger.warn('w');  logger.error('e')
    expect(outLines.length).toBe(2)
    expect(errLines.length).toBe(2)
  })

  it('never emits below the configured LOG_LEVEL', () => {
    vi.stubEnv('LOG_LEVEL', 'warn')
    logger.debug('nope'); logger.info('nope')
    logger.warn('yes');   logger.error('yes')
    expect(outLines.length).toBe(0)
    expect(errLines.length).toBe(2)
  })

  it('scrubs known-secret keys before emission', () => {
    logger.info('login', { userId: 'u1', accessToken: 'sk-abc', password: 'p' })
    const evt = JSON.parse(outLines[0]!.trim())
    expect(evt.context.userId).toBe('u1')
    expect(evt.context.accessToken).toBeUndefined()
    expect(evt.context.password).toBeUndefined()
  })

  it('truncates over-long context strings to 500 chars + ellipsis', () => {
    const long = 'a'.repeat(1000)
    logger.info('long', { note: long })
    const evt = JSON.parse(outLines[0]!.trim())
    expect(evt.context.note.length).toBeLessThanOrEqual(501)
    expect(evt.context.note.endsWith('…')).toBe(true)
  })

  it('sanitizes the error message via Slice-8 scrubber', () => {
    log('error', 'call failed', { userId: 'u1' }, new Error('Bearer abc123def456ghi789 exposed'))
    const evt = JSON.parse(errLines[0]!.trim())
    expect(evt.err.message).toContain('[redacted]')
  })

  it('captureErrorHook fires on error and only on error', () => {
    const seen: any[] = []
    registerErrorHook(evt => { seen.push(evt) })
    logger.info('safe')
    logger.warn('bad')
    logger.error('boom')
    expect(seen.length).toBe(1)
    expect(seen[0]!.msg).toBe('boom')
  })

  it('never throws when the error hook throws', () => {
    registerErrorHook(() => { throw new Error('hook bug') })
    expect(() => logger.error('should not propagate')).not.toThrow()
  })
})
