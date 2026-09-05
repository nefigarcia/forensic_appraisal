import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:            { findFirst: vi.fn(), findMany: vi.fn() },
    document:        { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    documentVersion: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    externalConnector: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: any) => {
      if (typeof fn === 'function') {
        const tx = {
          document:        { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({}) },
          documentVersion: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null) },
        }
        return fn(tx)
      }
      return Promise.all(fn)
    }),
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAction: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/s3-client', () => ({
  s3Client: { send: vi.fn().mockResolvedValue({}) },
  BUCKET_NAME: 'test-bucket',
}))
vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/signed-url'),
}))
vi.mock('@/lib/documents/scanner', () => ({
  scanner: () => ({ scanAsync: vi.fn().mockResolvedValue({ status: 'CLEAN' }) }),
}))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { s3Client } from '@/lib/s3-client'
import { addDocument, deleteDocument } from '@/app/actions/documents'
import {
  getDocumentVersions,
  getVersionDownloadUrl,
  archiveDocumentVersion,
} from '@/app/actions/document-versions'
import { NotFoundError } from '@/lib/authz'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const sessionOrgA = {
  userId: 'user-a', organizationId: 'org-a', role: 'ADMIN', email: 'a@b.com', jti: 'j',
}

// %PDF-1.7 signature
const pdfBytes = Buffer.concat([
  Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]),
  Buffer.from('rest of the document...'),
])

function makeFile(name: string, buf: Buffer, type = 'application/pdf'): File {
  return new File([buf], name, { type })
}

function uploadFormData(name = 'Statement.pdf'): FormData {
  const fd = new FormData()
  fd.set('file', makeFile(name, pdfBytes))
  fd.set('name', name)
  fd.set('type', 'application/pdf')
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(sessionOrgA as any)
  vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a' } as any)
})

describe('addDocument — first upload creates Document + v1', () => {
  it('creates Document, then DocumentVersion v1 with matching hash and self-describing s3Key', async () => {
    vi.mocked(prisma.document.findMany).mockResolvedValueOnce([] as any) // no existing doc with the same name
    vi.mocked(prisma.document.create).mockResolvedValueOnce({ id: 'doc-new' } as any)
    vi.mocked(prisma.documentVersion.findFirst).mockResolvedValueOnce(null) // versionNumber will be 1
    vi.mocked(prisma.documentVersion.create).mockResolvedValueOnce({ id: 'ver-1' } as any)
    vi.mocked(prisma.document.update).mockResolvedValueOnce({} as any)

    const res = await addDocument('case-a', uploadFormData('Statement.pdf'))

    expect(res.versionNumber).toBe(1)
    expect(res.docId).toBe('doc-new')
    expect(res.sha256Hash).toMatch(/^[0-9a-f]{64}$/)

    const s3PutArg = vi.mocked(s3Client.send).mock.calls[0]![0]! as any
    // PutObjectCommand was mocked as a plain function — its input lives on
    // .input? No — we mocked as `vi.fn()`, so the constructor was invoked
    // with an object. We can't easily peek into that here. Instead check
    // the version-row shape which encodes the S3 key.
    const versionArg = vi.mocked(prisma.documentVersion.create).mock.calls[0]![0]!.data as any
    expect(versionArg.s3Key).toBe('orgs/org-a/cases/case-a/documents/doc-new/versions/1/Statement.pdf')
    expect(versionArg.versionNumber).toBe(1)
    expect(versionArg.sha256Hash).toBe(res.sha256Hash)
    expect(versionArg.mimeType).toBe('application/pdf')
    expect(versionArg.uploadedBy).toBe('user-a')
    expect(versionArg.scanStatus).toBe('PENDING')

    // Document.currentVersionId now points at the new version.
    const updateArg = vi.mocked(prisma.document.update).mock.calls[0]![0]!.data as any
    expect(updateArg.currentVersionId).toBe('ver-1')
    expect(updateArg.s3Key).toBe(versionArg.s3Key)
    void s3PutArg
  })
})

describe('addDocument — re-upload creates a new version on the same Document', () => {
  it('does not create a new Document; increments versionNumber', async () => {
    // Existing document with same name.
    vi.mocked(prisma.document.findMany).mockResolvedValueOnce([
      { id: 'doc-existing', name: 'Statement.pdf', isArchived: false },
    ] as any)
    vi.mocked(prisma.documentVersion.findFirst).mockResolvedValueOnce({ versionNumber: 1 } as any) // next = 2
    vi.mocked(prisma.documentVersion.create).mockResolvedValueOnce({ id: 'ver-2' } as any)
    vi.mocked(prisma.document.update).mockResolvedValueOnce({} as any)

    const res = await addDocument('case-a', uploadFormData('Statement.pdf'))

    expect(res.docId).toBe('doc-existing')
    expect(res.versionNumber).toBe(2)
    expect(prisma.document.create).not.toHaveBeenCalled()

    const versionArg = vi.mocked(prisma.documentVersion.create).mock.calls[0]![0]!.data as any
    expect(versionArg.s3Key).toBe('orgs/org-a/cases/case-a/documents/doc-existing/versions/2/Statement.pdf')
  })
})

describe('addDocument — validation blocks BEFORE touching S3', () => {
  it('rejects a file with a mismatched signature and never PUTs to S3', async () => {
    vi.mocked(prisma.document.findMany).mockResolvedValueOnce([] as any)
    const fakePdf = new File([Buffer.from('not a pdf')], 'not.pdf', { type: 'application/pdf' })
    const fd = new FormData()
    fd.set('file', fakePdf)
    fd.set('name', 'not.pdf')
    fd.set('type', 'application/pdf')

    await expect(addDocument('case-a', fd)).rejects.toThrow(/Upload rejected/)
    expect(s3Client.send).not.toHaveBeenCalled()
    expect(prisma.document.create).not.toHaveBeenCalled()
    expect(prisma.documentVersion.create).not.toHaveBeenCalled()
  })

  it('rejects a disallowed extension', async () => {
    const exe = new File([pdfBytes], 'malware.exe', { type: 'application/octet-stream' })
    const fd = new FormData()
    fd.set('file', exe)
    fd.set('name', 'malware.exe')
    fd.set('type', 'application/octet-stream')

    await expect(addDocument('case-a', fd)).rejects.toThrow(/Upload rejected/)
    expect(s3Client.send).not.toHaveBeenCalled()
  })
})

describe('getDocumentVersions', () => {
  it('is tenant-scoped via requireDocumentAccess', async () => {
    // Cross-tenant: prisma.document.findFirst returns null (not in Org A).
    vi.mocked(prisma.document.findFirst).mockResolvedValueOnce(null)
    await expect(getDocumentVersions('doc-b')).rejects.toBeInstanceOf(NotFoundError)
    expect(prisma.documentVersion.findMany).not.toHaveBeenCalled()
  })

  it('returns rows newest-first, BigInt converted to Number for serialization', async () => {
    vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({ id: 'doc-a' } as any)
    vi.mocked(prisma.documentVersion.findMany).mockResolvedValueOnce([
      { id: 'v2', versionNumber: 2, sha256Hash: 'h2', sizeBytes: BigInt(2048), mimeType: 'application/pdf', originalName: 'x.pdf', uploadedBy: 'u1', uploadedAt: new Date(), scanStatus: 'CLEAN', isArchived: false, archivedAt: null, archiveReason: null },
      { id: 'v1', versionNumber: 1, sha256Hash: 'h1', sizeBytes: BigInt(1024), mimeType: 'application/pdf', originalName: 'x.pdf', uploadedBy: 'u1', uploadedAt: new Date(), scanStatus: 'CLEAN', isArchived: false, archivedAt: null, archiveReason: null },
    ] as any)
    const rows = await getDocumentVersions('doc-a')
    expect(rows[0]!.versionNumber).toBe(2)
    expect(rows[0]!.sizeBytes).toBe(2048)
    expect(typeof rows[0]!.sizeBytes).toBe('number')
  })
})

describe('getVersionDownloadUrl', () => {
  it('refuses cross-tenant version', async () => {
    vi.mocked(prisma.documentVersion.findFirst).mockResolvedValueOnce(null)
    await expect(getVersionDownloadUrl('ver-b')).rejects.toBeInstanceOf(NotFoundError)
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it('refuses to sign for an archived version', async () => {
    vi.mocked(prisma.documentVersion.findFirst).mockResolvedValueOnce({
      id: 'ver-a', s3Key: 'k', isArchived: true, scanStatus: 'CLEAN',
      document: { id: 'doc-a', caseId: 'case-a', isArchived: false },
    } as any)
    await expect(getVersionDownloadUrl('ver-a')).rejects.toBeInstanceOf(NotFoundError)
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it('refuses to sign for a non-CLEAN scan status', async () => {
    vi.mocked(prisma.documentVersion.findFirst).mockResolvedValueOnce({
      id: 'ver-a', s3Key: 'k', isArchived: false, scanStatus: 'INFECTED',
      document: { id: 'doc-a', caseId: 'case-a', isArchived: false },
    } as any)
    await expect(getVersionDownloadUrl('ver-a')).rejects.toThrow(/scan status/)
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it('signs a URL for a CLEAN, non-archived version and audits the download', async () => {
    vi.mocked(prisma.documentVersion.findFirst).mockResolvedValueOnce({
      id: 'ver-a', s3Key: 'orgs/org-a/cases/case-a/documents/doc-a/versions/1/x.pdf',
      versionNumber: 1, sha256Hash: 'h1',
      isArchived: false, scanStatus: 'CLEAN',
      document: { id: 'doc-a', caseId: 'case-a', isArchived: false },
    } as any)
    const res = await getVersionDownloadUrl('ver-a')
    expect(res.url).toBe('https://s3.example.com/signed-url')
    expect(res.expiresInSeconds).toBe(300)
    expect(getSignedUrl).toHaveBeenCalledOnce()
  })
})

describe('deleteDocument — archive-by-default (soft delete)', () => {
  it('sets isArchived, does NOT touch S3, does NOT delete the row', async () => {
    vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({
      id: 'doc-a', caseId: 'case-a', name: 'x.pdf',
      case: { id: 'case-a', organizationId: 'org-a' },
    } as any)
    vi.mocked(prisma.document.update).mockResolvedValueOnce({} as any)

    await deleteDocument('doc-a', 'client request')

    const arg = vi.mocked(prisma.document.update).mock.calls[0]![0]!
    expect((arg.data as any).isArchived).toBe(true)
    expect((arg.data as any).archiveReason).toBe('client request')
    expect((arg.data as any).archivedBy).toBe('user-a')
    // Never sends S3 DeleteObjectCommand.
    for (const call of vi.mocked(s3Client.send).mock.calls) {
      expect(call[0]).toBeDefined()
    }
    expect(s3Client.send).not.toHaveBeenCalled()
  })
})
