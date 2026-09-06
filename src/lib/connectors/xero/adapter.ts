/**
 * Xero adapter — Slice-15 stub.
 *
 * The interface is implemented so any future call site + tests get a
 * type-checked skeleton. Every method throws `AdapterNotImplementedError`
 * so a mis-routed call cannot silently do nothing.
 */

import {
  type ConnectorAdapter,
  AdapterNotImplementedError,
} from '../types'

export function makeXeroAdapter(): ConnectorAdapter {
  return {
    provider: 'XERO',
    buildAuthorizeUrl(): never { throw new AdapterNotImplementedError('XERO') },
    async exchangeCode(): Promise<never> { throw new AdapterNotImplementedError('XERO') },
    async fetchReport(): Promise<never>  { throw new AdapterNotImplementedError('XERO') },
  }
}
