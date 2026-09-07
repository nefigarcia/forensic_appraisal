/**
 * Connector-secret encryption — maps between the envelope module and the
 * DB shape used by `ExternalConnector`.
 *
 * Storage shape (JSON in `ExternalConnector.encryptedSecrets`):
 *
 *   {
 *     "version": "v1",
 *     "secrets": {
 *       "accessToken":  { "ciphertext": "...", "dek": "..." },
 *       "refreshToken": { "ciphertext": "...", "dek": "..." }
 *     }
 *   }
 *
 * Adding a new credential type in a future slice does not require a schema
 * migration — just a new key inside `secrets`.
 *
 * Rules enforced by this module:
 *  - Plaintext values are never returned to callers except by explicit
 *    `decrypt*` calls.
 *  - Plaintext strings never appear in error messages or log lines.
 *  - The KEK version is captured in `encryptionKeyVersion` so rotation
 *    queries can find rows keyed to a specific KMS ARN.
 */

import { encryptString, decryptString, type EnvelopedSecret } from './envelope'

export type ConnectorSecretName = 'accessToken' | 'refreshToken'

export interface EncryptedSecretsBlobV1 {
  version: 'v1'
  secrets: Partial<Record<ConnectorSecretName, EnvelopedSecret>>
}

/** Shape used by the read path — matches what Prisma returns for the row. */
export interface ConnectorRowSecrets {
  accessToken?:          string | null           // LEGACY plaintext
  refreshToken?:         string | null           // LEGACY plaintext
  encryptedSecrets?:     unknown                 // JSON blob (see above)
  encryptionKeyVersion?: string | null
}

/**
 * Turn a fresh {access, refresh} pair into DB columns. Callers write these
 * into ExternalConnector directly. Legacy plaintext columns are ALWAYS
 * cleared on write so we don't accidentally retain a stale plaintext copy.
 */
export async function encryptConnectorSecrets(input: {
  accessToken?:  string | null
  refreshToken?: string | null
}): Promise<{
  accessToken:           null
  refreshToken:          null
  encryptedSecrets:      EncryptedSecretsBlobV1 | null
  encryptionKeyVersion:  string | null
}> {
  const secrets: EncryptedSecretsBlobV1['secrets'] = {}
  let keyVersion: string | null = null

  if (input.accessToken) {
    const enc = await encryptString(input.accessToken)
    secrets.accessToken = enc
    keyVersion = enc.keyVersion
  }
  if (input.refreshToken) {
    const enc = await encryptString(input.refreshToken)
    secrets.refreshToken = enc
    keyVersion = enc.keyVersion
  }

  const hasAny = Object.keys(secrets).length > 0
  return {
    accessToken:          null,
    refreshToken:         null,
    encryptedSecrets:     hasAny ? { version: 'v1', secrets } : null,
    encryptionKeyVersion: hasAny ? keyVersion : null,
  }
}

/** Decrypt a single named secret from a connector row. Prefers the new
 *  envelope blob; falls back to the legacy plaintext column when a row
 *  hasn't been migrated yet. */
export async function decryptConnectorSecret(
  row: ConnectorRowSecrets,
  name: ConnectorSecretName,
): Promise<string | null> {
  const blob = row.encryptedSecrets as EncryptedSecretsBlobV1 | null | undefined
  if (blob?.version === 'v1' && blob.secrets?.[name]) {
    return decryptString(blob.secrets[name]!)
  }
  // Pre-Slice-3 rows without the migration script having run yet.
  if (name === 'accessToken'  && row.accessToken)  return row.accessToken
  if (name === 'refreshToken' && row.refreshToken) return row.refreshToken
  return null
}

/**
 * Whitelist projection for reads. Never selects any secret column — callers
 * that only need connector metadata (list views, admin dashboards) get a
 * shape that cannot leak tokens to the UI.
 */
export const CONNECTOR_METADATA_SELECT = {
  id:             true,
  organizationId: true,
  provider:       true,
  status:         true,
  lastSync:       true,
  expiresAt:      true,
  createdAt:      true,
  updatedAt:      true,
} as const
