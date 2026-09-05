import { describe, it, expect, beforeEach } from 'vitest'
import {
  encryptConnectorSecrets,
  decryptConnectorSecret,
  CONNECTOR_METADATA_SELECT,
} from '@/lib/crypto/connector-secrets'
import { __resetKekProviderForTests } from '@/lib/crypto/kek'

beforeEach(() => { __resetKekProviderForTests() })

describe('encryptConnectorSecrets', () => {
  it('returns a v1 blob with only the requested secrets populated', async () => {
    const out = await encryptConnectorSecrets({
      accessToken:  'access-abc',
      refreshToken: 'refresh-def',
    })
    expect(out.accessToken).toBeNull()
    expect(out.refreshToken).toBeNull()
    expect(out.encryptionKeyVersion).toBe('local-v1')
    const blob = out.encryptedSecrets as any
    expect(blob.version).toBe('v1')
    expect(blob.secrets.accessToken).toBeDefined()
    expect(blob.secrets.refreshToken).toBeDefined()
  })

  it('always nulls the legacy plaintext columns on write (defense-in-depth)', async () => {
    const out = await encryptConnectorSecrets({ accessToken: 'a' })
    // Even when only one secret is present, the plaintext columns are
    // explicitly nulled — no stale copy can survive an upsert.
    expect(out.accessToken).toBeNull()
    expect(out.refreshToken).toBeNull()
  })

  it('returns null blob + null keyVersion when there are no inputs', async () => {
    const out = await encryptConnectorSecrets({})
    expect(out.encryptedSecrets).toBeNull()
    expect(out.encryptionKeyVersion).toBeNull()
  })

  it('never leaves the plaintext substring in the persisted blob', async () => {
    const secret = 'sk-secret-value-do-not-log'
    const out = await encryptConnectorSecrets({ accessToken: secret })
    expect(JSON.stringify(out.encryptedSecrets)).not.toContain(secret)
  })
})

describe('decryptConnectorSecret', () => {
  it('round-trips a freshly-encrypted token', async () => {
    const enc = await encryptConnectorSecrets({ accessToken: 'access-abc' })
    const back = await decryptConnectorSecret(
      {
        encryptedSecrets:     enc.encryptedSecrets as any,
        encryptionKeyVersion: enc.encryptionKeyVersion,
      },
      'accessToken',
    )
    expect(back).toBe('access-abc')
  })

  it('falls back to the legacy plaintext column when no encrypted blob exists', async () => {
    // Pre-Slice-3 row shape: plaintext accessToken populated, no encryptedSecrets.
    const back = await decryptConnectorSecret(
      { accessToken: 'legacy-plaintext', encryptedSecrets: null },
      'accessToken',
    )
    expect(back).toBe('legacy-plaintext')
  })

  it('prefers the encrypted blob when both fields are present', async () => {
    const enc = await encryptConnectorSecrets({ accessToken: 'from-envelope' })
    const back = await decryptConnectorSecret(
      {
        accessToken:          'stale-plaintext',
        encryptedSecrets:     enc.encryptedSecrets as any,
        encryptionKeyVersion: enc.encryptionKeyVersion,
      },
      'accessToken',
    )
    expect(back).toBe('from-envelope')
  })

  it('returns null when the requested secret is absent from both places', async () => {
    const back = await decryptConnectorSecret({}, 'refreshToken')
    expect(back).toBeNull()
  })
})

describe('CONNECTOR_METADATA_SELECT', () => {
  it('does not include any secret column in the projection', () => {
    const keys = Object.keys(CONNECTOR_METADATA_SELECT)
    for (const forbidden of ['accessToken', 'refreshToken', 'encryptedSecrets', 'encryptionKeyVersion']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('does include the expected metadata fields', () => {
    for (const wanted of ['id', 'organizationId', 'provider', 'status', 'lastSync', 'expiresAt']) {
      expect(CONNECTOR_METADATA_SELECT).toHaveProperty(wanted, true)
    }
  })
})
