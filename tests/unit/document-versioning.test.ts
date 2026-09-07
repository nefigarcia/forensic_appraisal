import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    documentVersion: { findFirst: vi.fn() },
    document:        { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  buildS3Key,
  sha256HexOf,
  nextVersionNumberFor,
  findDocumentByFilenameInCase,
} from '@/lib/documents/versioning'

beforeEach(() => { vi.clearAllMocks() })

describe('buildS3Key', () => {
  it('emits a self-describing key including org, case, doc, version', () => {
    const key = buildS3Key({
      organizationId: 'org-a', caseId: 'case-a',
      documentId: 'doc-a', versionNumber: 3,
      originalName: 'Q1 statement.pdf',
    })
    expect(key).toBe('orgs/org-a/cases/case-a/documents/doc-a/versions/3/Q1_statement.pdf')
  })

  it('sanitizes weird characters in the filename', () => {
    const key = buildS3Key({
      organizationId: 'o', caseId: 'c', documentId: 'd', versionNumber: 1,
      originalName: 'name with spaces & symbols(!).pdf',
    })
    // Every non-safe char becomes `_`
    expect(key.endsWith('/name_with_spaces___symbols___.pdf')).toBe(true)
  })
})

describe('sha256HexOf', () => {
  it('produces a stable hex hash', () => {
    const buf = Buffer.from('hello world')
    const h = sha256HexOf(buf)
    expect(h).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
  })

  it('is length-64 hex', () => {
    const h = sha256HexOf(Buffer.from('anything'))
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true)
  })
})

describe('nextVersionNumberFor', () => {
  it('returns 1 when there are no versions', async () => {
    vi.mocked(prisma.documentVersion.findFirst).mockResolvedValueOnce(null)
    expect(await nextVersionNumberFor('doc-a')).toBe(1)
  })

  it('increments off the last versionNumber', async () => {
    vi.mocked(prisma.documentVersion.findFirst).mockResolvedValueOnce({ versionNumber: 7 } as any)
    expect(await nextVersionNumberFor('doc-a')).toBe(8)
  })

  it('scopes the query to the given documentId', async () => {
    vi.mocked(prisma.documentVersion.findFirst).mockResolvedValueOnce(null)
    await nextVersionNumberFor('doc-a')
    const arg = vi.mocked(prisma.documentVersion.findFirst).mock.calls[0]![0]!
    expect(arg.where).toEqual({ documentId: 'doc-a' })
    expect(arg.orderBy).toEqual({ versionNumber: 'desc' })
  })
})

describe('findDocumentByFilenameInCase', () => {
  it('matches case-insensitively on the trimmed name', async () => {
    vi.mocked(prisma.document.findMany).mockResolvedValueOnce([
      { id: 'd1', name: 'Report Q1.PDF' },
      { id: 'd2', name: 'other.pdf' },
    ] as any)
    const hit = await findDocumentByFilenameInCase('case-a', '  report q1.pdf  ')
    expect(hit).toEqual({ id: 'd1' })
  })

  it('returns null when no name matches', async () => {
    vi.mocked(prisma.document.findMany).mockResolvedValueOnce([
      { id: 'd1', name: 'Report Q1.pdf' },
    ] as any)
    expect(await findDocumentByFilenameInCase('case-a', 'other.pdf')).toBeNull()
  })

  it('scopes the query to non-archived docs in the case', async () => {
    vi.mocked(prisma.document.findMany).mockResolvedValueOnce([] as any)
    await findDocumentByFilenameInCase('case-a', 'x.pdf')
    const arg = vi.mocked(prisma.document.findMany).mock.calls[0]![0]!
    expect(arg.where).toEqual({ caseId: 'case-a', isArchived: false })
  })
})
