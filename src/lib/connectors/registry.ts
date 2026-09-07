/**
 * Provider → adapter registry.
 *
 * `getConnectorAdapter(provider)` is the sole way server code obtains
 * an adapter. Tests can inject an override via `registerAdapter` to
 * exercise a specific provider's flow without touching the network.
 */

import { isAccountingProvider, type AccountingProvider, type ConnectorAdapter } from './types'
import { makeQuickbooksAdapter } from './quickbooks/adapter'
import { makeXeroAdapter }       from './xero/adapter'
import { makeSageAdapter }       from './sage/adapter'
import { makeNetsuiteAdapter }   from './netsuite/adapter'

const registry = new Map<AccountingProvider, () => ConnectorAdapter>([
  ['QUICKBOOKS', () => makeQuickbooksAdapter()],
  ['XERO',       () => makeXeroAdapter()],
  ['SAGE',       () => makeSageAdapter()],
  ['NETSUITE',   () => makeNetsuiteAdapter()],
])

export function getConnectorAdapter(provider: string): ConnectorAdapter {
  if (!isAccountingProvider(provider)) {
    throw new Error(`Unknown accounting provider: ${provider}`)
  }
  const factory = registry.get(provider)
  if (!factory) throw new Error(`No adapter registered for ${provider}`)
  return factory()
}

/**
 * Override an adapter for tests. Callers restore the previous factory
 * via the returned function.
 */
export function registerAdapter(
  provider: AccountingProvider,
  adapter: ConnectorAdapter | (() => ConnectorAdapter),
): () => void {
  const prev = registry.get(provider)
  const factory = typeof adapter === 'function' ? adapter : () => adapter
  registry.set(provider, factory)
  return () => {
    if (prev) registry.set(provider, prev)
    else      registry.delete(provider)
  }
}
