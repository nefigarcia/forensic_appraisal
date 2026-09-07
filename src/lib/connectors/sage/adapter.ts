/**
 * Sage adapter — Slice-15 stub.
 * See `../xero/adapter.ts` for the pattern.
 */

import { type ConnectorAdapter, AdapterNotImplementedError } from '../types'

export function makeSageAdapter(): ConnectorAdapter {
  return {
    provider: 'SAGE',
    buildAuthorizeUrl(): never { throw new AdapterNotImplementedError('SAGE') },
    async exchangeCode(): Promise<never> { throw new AdapterNotImplementedError('SAGE') },
    async fetchReport(): Promise<never>  { throw new AdapterNotImplementedError('SAGE') },
  }
}
