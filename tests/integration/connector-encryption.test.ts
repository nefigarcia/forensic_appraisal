import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalConnector: {
      findMany:  vi.fn(),
      findUnique: vi.fn(),
      upsert:    vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import {
  getExternalConnections,
  saveOAuthToken,
  getDecryptedAccessTokenForProvider,
} from '@/app/actions/connectors'
import { __resetKekProviderForTests } from '@/lib/crypto/kek'
import { CONNECTOR_METADATA_SELECT } from '@/lib/crypto/connector-secrets'

const sessionOrgA = {
  userId: 'user-a', organizationId: 'org-a', role: 'ADMIN', email: 'a@b.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetKekProviderForTests()
  vi.mocked(getSession).mockResolvedValue(sessionOrgA as any)
})

describe('getExternalConnections — safe projection only', () => {
  it('calls Prisma with the metadata-only select and never selects token fields', async () => {
    vi.mocked(prisma.externalConnector.findMany).mockResolvedValueOnce([] as any)
    await getExternalConnections()
    const arg = vi.mocked(prisma.externalConnector.findMany).mock.calls[0]![0]!
    expect(arg.select).toEqual(CONNECTOR_METADATA_SELECT)
    // Explicit assertion — any of these appearing in the select would leak
    // a plaintext or ciphertext value to a client component.
    for (const banned of ['accessToken', 'refreshToken', 'encryptedSecrets', 'encryptionKeyVersion']) {
      expect((arg.select as any)?.[banned]).toBeUndefined()
    }
  })

  it('returns [] for an unauthenticated caller and never touches Prisma', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const rows = await getExternalConnections()
    expect(rows).toEqual([])
    expect(prisma.externalConnector.findMany).not.toHaveBeenCalled()
  })
})

describe('saveOAuthToken — envelope-encrypted write', () => {
  it('encrypts both tokens, sets encryptedSecrets + encryptionKeyVersion, nulls plaintext columns', async () => {
    vi.mocked(prisma.externalConnector.upsert).mockResolvedValueOnce({} as any)
    await saveOAuthToken('microsoft', {
      access_token:  'access-abc-secret',
      refresh_token: 'refresh-def-secret',
      expires_in:    3600,
    })
    const upsertArg = vi.mocked(prisma.externalConnector.upsert).mock.calls[0]![0]!

    // create shape
    const createData = upsertArg.create as any
    expect(createData.accessToken).toBeNull()
    expect(createData.refreshToken).toBeNull()
    expect(createData.encryptedSecrets).toBeDefined()
    expect(createData.encryptedSecrets.version).toBe('v1')
    expect(createData.encryptionKeyVersion).toBe('local-v1')
    // No plaintext substring in the persisted payload.
    const serialized = JSON.stringify(createData.encryptedSecrets)
    expect(serialized).not.toContain('access-abc-secret')
    expect(serialized).not.toContain('refresh-def-secret')

    // update shape mirrors create
    const updateData = upsertArg.update as any
    expect(updateData.accessToken).toBeNull()
    expect(updateData.refreshToken).toBeNull()
  })
})

describe('getDecryptedAccessTokenForProvider — decrypts only server-side', () => {
  it('returns the plaintext when the row is envelope-encrypted', async () => {
    // Encrypt in a helper call to produce a realistic row shape.
    const { encryptConnectorSecrets } = await import('@/lib/crypto/connector-secrets')
    const enc = await encryptConnectorSecrets({ accessToken: 'plaintext-goes-here' })
    vi.mocked(prisma.externalConnector.findUnique).mockResolvedValueOnce({
      accessToken:          enc.accessToken,
      refreshToken:         null,
      encryptedSecrets:     enc.encryptedSecrets as any,
      encryptionKeyVersion: enc.encryptionKeyVersion,
    } as any)

    const token = await getDecryptedAccessTokenForProvider('microsoft')
    expect(token).toBe('plaintext-goes-here')
  })

  it('falls back to the legacy plaintext column for un-migrated rows', async () => {
    vi.mocked(prisma.externalConnector.findUnique).mockResolvedValueOnce({
      accessToken:          'legacy-still-plaintext',
      refreshToken:         null,
      encryptedSecrets:     null,
      encryptionKeyVersion: null,
    } as any)

    const token = await getDecryptedAccessTokenForProvider('microsoft')
    expect(token).toBe('legacy-still-plaintext')
  })

  it('returns null when the connector does not exist', async () => {
    vi.mocked(prisma.externalConnector.findUnique).mockResolvedValueOnce(null)
    const token = await getDecryptedAccessTokenForProvider('microsoft')
    expect(token).toBeNull()
  })

  it('returns null for an unauthenticated caller', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const token = await getDecryptedAccessTokenForProvider('microsoft')
    expect(token).toBeNull()
    expect(prisma.externalConnector.findUnique).not.toHaveBeenCalled()
  })
})
