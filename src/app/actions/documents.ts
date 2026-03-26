'use server'

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import { guardAction } from '@/lib/rbac'
import { logAction } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { s3Client, BUCKET_NAME } from '@/lib/s3-client'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createHash } from 'crypto'

export async function addDocument(caseId: string, formData: FormData) {
  const session = await getSession()
  guardAction(session, 'document:upload')

  const file            = formData.get('file') as File
  const displayName     = formData.get('name') as string
  const type            = formData.get('type') as string
  const storageProvider = (formData.get('storageProvider') as string) || 's3'

  if (!file) throw new Error('No file provided')

  const arrayBuffer = await file.arrayBuffer()
  const buffer      = Buffer.from(arrayBuffer)

  // SHA-256 for tamper-evident chain of custody
  const sha256Hash = createHash('sha256').update(buffer).digest('hex')

  const fileKey = `cases/${caseId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME, Key: fileKey, Body: buffer, ContentType: file.type,
    }))

    if (storageProvider !== 's3') {
      const connector = await prisma.externalConnector.findUnique({
        where: { organizationId_provider: { organizationId: session!.organizationId, provider: storageProvider } },
      })
      if (connector?.accessToken && storageProvider === 'microsoft') {
        try {
          await fetch(
            `https://graph.microsoft.com/v1.0/me/drive/root:/ValuVault_Archive/${caseId}/${file.name}:/content`,
            { method: 'PUT', headers: { Authorization: `Bearer ${connector.accessToken}`, 'Content-Type': file.type }, body: buffer },
          )
        } catch (e) { console.error('Mirror failed:', e) }
      }
    }

    const fileSize = (file.size / (1024 * 1024)).toFixed(2) + ' MB'
    const doc = await prisma.document.create({
      data: { caseId, name: displayName || file.name, type: type || file.type, size: fileSize, s3Key: fileKey, sha256Hash, status: 'VERIFIED' },
    })

    await logAction({
      userId: session!.userId, action: 'UPLOAD_DOCUMENT', caseId,
      targetModel: 'Document', targetId: doc.id,
      newValue: { name: doc.name, size: fileSize, sha256Hash },
    })

    revalidatePath(`/projects/${caseId}`)
    return { success: true, docId: doc.id }
  } catch (err) {
    console.error('Upload Error:', err)
    throw new Error('Failed to upload document to secure custody binder.')
  }
}

export async function deleteDocument(documentId: string) {
  const session = await getSession()
  guardAction(session, 'document:delete')

  const doc = await prisma.document.findUnique({ where: { id: documentId } })
  if (!doc) throw new Error('Document not found')

  if (doc.s3Key) {
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: doc.s3Key }))
    } catch (e) { console.error('S3 delete failed:', e) }
  }

  await prisma.document.delete({ where: { id: documentId } })

  await logAction({
    userId: session!.userId, action: 'DELETE_DOCUMENT', caseId: doc.caseId,
    targetModel: 'Document', targetId: documentId, oldValue: { name: doc.name },
  })

  revalidatePath(`/projects/${doc.caseId}`)
}
