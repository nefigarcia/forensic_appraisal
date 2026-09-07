/**
 * NetSuite adapter — Slice-15 stub.
 * See `../xero/adapter.ts` for the pattern.
 */

import { type ConnectorAdapter, AdapterNotImplementedError } from '../types'

export function makeNetsuiteAdapter(): ConnectorAdapter {
  return {
    provider: 'NETSUITE',
    buildAuthorizeUrl(): never { throw new AdapterNotImplementedError('NETSUITE') },
    async exchangeCode(): Promise<never> { throw new AdapterNotImplementedError('NETSUITE') },
    async fetchReport(): Promise<never>  { throw new AdapterNotImplementedError('NETSUITE') },
  }
}
