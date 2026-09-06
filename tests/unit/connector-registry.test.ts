import { describe, it, expect, beforeAll } from 'vitest'
import {
  ACCOUNTING_PROVIDERS, ACCOUNTING_REPORT_KINDS,
  isAccountingProvider, isAccountingReportKind,
  AdapterNotImplementedError,
} from '@/lib/connectors/types'
import { getConnectorAdapter, registerAdapter } from '@/lib/connectors/registry'

describe('connector types', () => {
  it('lists all Slice-15 providers', () => {
    expect(ACCOUNTING_PROVIDERS).toEqual(['QUICKBOOKS', 'XERO', 'SAGE', 'NETSUITE'])
    for (const p of ACCOUNTING_PROVIDERS) expect(isAccountingProvider(p)).toBe(true)
    expect(isAccountingProvider('CUSTOM')).toBe(false)
  })

  it('lists all Slice-15 report kinds', () => {
    for (const k of ACCOUNTING_REPORT_KINDS) expect(isAccountingReportKind(k)).toBe(true)
    expect(isAccountingReportKind('OTHER_REPORT')).toBe(false)
  })
})

describe('adapter registry', () => {
  it('returns a distinct instance per provider', () => {
    const qbo   = getConnectorAdapter('QUICKBOOKS')
    const xero  = getConnectorAdapter('XERO')
    const sage  = getConnectorAdapter('SAGE')
    const nets  = getConnectorAdapter('NETSUITE')
    expect(qbo.provider).toBe('QUICKBOOKS')
    expect(xero.provider).toBe('XERO')
    expect(sage.provider).toBe('SAGE')
    expect(nets.provider).toBe('NETSUITE')
  })

  it('throws AdapterNotImplementedError for stub providers on every method', async () => {
    const xero = getConnectorAdapter('XERO')
    expect(() => xero.buildAuthorizeUrl({} as any)).toThrow(AdapterNotImplementedError)
    await expect(xero.exchangeCode({} as any)).rejects.toBeInstanceOf(AdapterNotImplementedError)
    await expect(xero.fetchReport({} as any)).rejects.toBeInstanceOf(AdapterNotImplementedError)
    const sage = getConnectorAdapter('SAGE')
    expect(() => sage.buildAuthorizeUrl({} as any)).toThrow(AdapterNotImplementedError)
    const nets = getConnectorAdapter('NETSUITE')
    expect(() => nets.buildAuthorizeUrl({} as any)).toThrow(AdapterNotImplementedError)
  })

  it('registerAdapter allows test-time override + restore', () => {
    const restore = registerAdapter('XERO', {
      provider: 'XERO',
      buildAuthorizeUrl: () => ({ authorizeUrl: 'https://mock.example/authorize' }),
      exchangeCode: async () => ({
        accessToken: 'a', refreshToken: 'r', expiresAt: null,
        providerAccountId: 'x-1', providerAccountLabel: null,
      }),
      fetchReport: async () => ({
        reportKind: 'P_AND_L', periodLabel: 'x', rows: [], fetchedAt: new Date(),
      }),
    })
    const xero = getConnectorAdapter('XERO')
    expect(xero.buildAuthorizeUrl({} as any).authorizeUrl).toBe('https://mock.example/authorize')
    restore()
    // After restore, the stub throws again.
    expect(() => getConnectorAdapter('XERO').buildAuthorizeUrl({} as any))
      .toThrow(AdapterNotImplementedError)
  })

  it('rejects unknown provider', () => {
    expect(() => getConnectorAdapter('MYSTERY')).toThrow(/Unknown/)
  })
})
