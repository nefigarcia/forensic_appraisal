'use server'

/**
 * Firm-side actions for managing ClientContacts and issuing PortalAccess
 * invites.
 *
 * A portal invite is a one-time capability: the firm calls
 * `invitePortalAccess`, we generate a fresh 256-bit token, store only its
 * SHA-256 hash, and return the RAW token to the caller ONE TIME so the
 * UI can present a copy-link + trigger the email. The raw token is
 * never re-derivable from the DB.
 *
 * Portal-side code lives in `src/app/actions/portal.ts` and takes the
 * raw token as its first argument.
 */

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requireCaseAccess, NotFoundError } from '@/lib/authz'
import { logAction } from '@/lib/audit'
import { sendMail } from '@/lib/mailer'
import { env } from '@/lib/env'
import {
  generatePortalToken,
  PORTAL_TOKEN_DEFAULT_TTL_MS,
} from '@/lib/portal/tokens'

// ─────────────────────────────────────────────────
// ClientContact CRUD
// ─────────────────────────────────────────────────

export interface ClientContactForClient {
  id:        string
  name:      string
  email:     string
  role:      string | null
  isActive:  boolean
  createdAt: Date
}

export async function getClientContacts(caseId: string): Promise<ClientContactForClient[]> {
  await requireCaseAccess(caseId, 'case:read')
  const rows = await prisma.clientContact.findMany({
    where:   { caseId },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(r => ({
    id: r.id, name: r.name, email: r.email, role: r.role,
    isActive: r.isActive, createdAt: r.createdAt,
  }))
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function addClientContact(input: {
  caseId: string
  name:   string
  email:  string
  role?:  string
}): Promise<{ id: string }> {
  const name  = input.name?.trim()
  const email = input.email?.trim().toLowerCase()
  if (!name)                   throw new Error('Name required')
  if (!email || !EMAIL_RE.test(email)) throw new Error('Valid email required')
  const { session } = await requireCaseAccess(input.caseId, 'value:accept')

  const created = await prisma.clientContact.create({
    data: {
      caseId:    input.caseId,
      name,
      email,
      role:      input.role?.trim() ?? null,
      createdBy: session.userId,
      isActive:  true,
    },
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: input.caseId, targetModel: 'ClientContact', targetId: created.id,
    note: `added client contact ${email}`,
  })
  revalidatePath(`/projects/${input.caseId}`)
  return { id: created.id }
}

export async function deactivateClientContact(input: { id: string }): Promise<void> {
  const row = await prisma.clientContact.findUnique({ where: { id: input.id } })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.caseId, 'value:accept')
  await prisma.$transaction(async (tx) => {
    await tx.clientContact.update({
      where: { id: row.id }, data: { isActive: false },
    })
    // Deactivating a contact revokes every one of their outstanding
    // portal links. Silent, cascading intent.
    await tx.portalAccess.updateMany({
      where: { clientContactId: row.id, revokedAt: null },
      data:  { revokedAt: new Date(), revokedBy: session.userId },
    })
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: row.caseId, targetModel: 'ClientContact', targetId: row.id,
    note: 'contact deactivated (portal access revoked)',
  })
  revalidatePath(`/projects/${row.caseId}`)
}

// ─────────────────────────────────────────────────
// Portal invitations
// ─────────────────────────────────────────────────

export interface PortalInviteResult {
  id:         string      // tokenHash — the DB primary key, safe to expose
  rawToken:   string      // shown ONCE — the URL contains this
  url:        string
  expiresAt:  Date
}

export async function invitePortalAccess(input: {
  requestListId:   string
  clientContactId: string
  ttlMs?:          number
}): Promise<PortalInviteResult> {
  const list = await prisma.requestList.findUnique({
    where: { id: input.requestListId },
    select: { id: true, caseId: true, status: true, title: true },
  })
  if (!list) throw new NotFoundError()
  if (list.status === 'CLOSED') throw new Error('Cannot invite to a closed list')

  const { session } = await requireCaseAccess(list.caseId, 'value:accept')

  const contact = await prisma.clientContact.findUnique({
    where: { id: input.clientContactId },
  })
  if (!contact || contact.caseId !== list.caseId) throw new NotFoundError()
  if (!contact.isActive) throw new Error('Contact is deactivated')

  const { token, tokenHash } = generatePortalToken()
  const ttl = input.ttlMs ?? PORTAL_TOKEN_DEFAULT_TTL_MS
  const expiresAt = new Date(Date.now() + ttl)

  await prisma.$transaction(async (tx) => {
    await tx.portalAccess.create({
      data: {
        tokenHash,
        clientContactId: contact.id,
        requestListId:   list.id,
        caseId:          list.caseId,
        invitedBy:       session.userId,
        expiresAt,
      },
    })
    // First invite on a DRAFT list flips it to SENT and REQUESTs every
    // item still in NOT_REQUESTED. Same rule as markRequestListSent, so
    // the analyst doesn't have to hit two buttons.
    if (list.status === 'DRAFT') {
      const now = new Date()
      await tx.requestList.update({
        where: { id: list.id }, data: { status: 'SENT', sentAt: now },
      })
      await tx.requestItem.updateMany({
        where: { requestListId: list.id, status: 'NOT_REQUESTED' },
        data:  { status: 'REQUESTED', statusChangedAt: now },
      })
    }
    await tx.reminderEvent.create({
      data: {
        caseId:        list.caseId,
        requestListId: list.id,
        clientContactId: contact.id,
        kind:          'INVITE',
        channel:       'EMAIL',
        toEmail:       contact.email,
        sentBy:        session.userId,
      },
    })
  })

  const url = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/portal/${token}`

  // Fire-and-forget: mailer is a stub in dev. The raw token is only
  // written into a transactional message (not persisted anywhere).
  void sendMail({
    to:       contact.email,
    subject:  `Requested items for ${list.title}`,
    text:     `Hello ${contact.name},\n\nPlease upload the requested documents at:\n${url}\n\nThe link expires on ${expiresAt.toISOString()}.\n`,
    category: 'portal-invite',
  }).catch(err => console.error('[portal-invite] mail send failed:', (err as Error).message))

  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: list.caseId,
    targetModel: 'PortalAccess', targetId: tokenHash,
    note: `portal invite to ${contact.email} (expires ${expiresAt.toISOString()})`,
  })
  revalidatePath(`/projects/${list.caseId}`)

  return { id: tokenHash, rawToken: token, url, expiresAt }
}

export async function revokePortalAccess(input: { tokenHash: string }): Promise<void> {
  const row = await prisma.portalAccess.findUnique({ where: { tokenHash: input.tokenHash } })
  if (!row) throw new NotFoundError()
  const { session } = await requireCaseAccess(row.caseId, 'value:accept')
  if (row.revokedAt) return
  await prisma.portalAccess.update({
    where: { tokenHash: row.tokenHash },
    data:  { revokedAt: new Date(), revokedBy: session.userId },
  })
  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: row.caseId, targetModel: 'PortalAccess', targetId: row.tokenHash,
    note: 'portal access revoked',
  })
  revalidatePath(`/projects/${row.caseId}`)
}

export interface PortalInviteSummary {
  tokenHash:  string
  contactId:  string
  contactName:  string
  contactEmail: string
  invitedAt:  Date
  expiresAt:  Date
  revokedAt:  Date | null
  lastUsedAt: Date | null
  usageCount: number
}

export async function listPortalInvites(input: { requestListId: string }): Promise<PortalInviteSummary[]> {
  const list = await prisma.requestList.findUnique({
    where: { id: input.requestListId }, select: { caseId: true },
  })
  if (!list) throw new NotFoundError()
  await requireCaseAccess(list.caseId, 'case:read')
  const rows = await prisma.portalAccess.findMany({
    where: { requestListId: input.requestListId },
    orderBy: { invitedAt: 'desc' },
    include: { clientContact: { select: { id: true, name: true, email: true } } },
  })
  return rows.map(r => ({
    tokenHash:  r.tokenHash,
    contactId:  r.clientContactId,
    contactName:  r.clientContact.name,
    contactEmail: r.clientContact.email,
    invitedAt:  r.invitedAt,
    expiresAt:  r.expiresAt,
    revokedAt:  r.revokedAt,
    lastUsedAt: r.lastUsedAt,
    usageCount: r.usageCount,
  }))
}

// ─────────────────────────────────────────────────
// Reminders
// ─────────────────────────────────────────────────

const REMINDER_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000  // 24 hours

export async function sendPortalReminder(input: {
  requestListId:   string
  clientContactId: string
}): Promise<{ sent: boolean; reason?: string }> {
  const list = await prisma.requestList.findUnique({
    where: { id: input.requestListId }, select: { id: true, caseId: true, status: true, title: true },
  })
  if (!list) throw new NotFoundError()
  if (list.status === 'CLOSED') throw new Error('List is closed')

  const { session } = await requireCaseAccess(list.caseId, 'value:accept')
  const contact = await prisma.clientContact.findUnique({ where: { id: input.clientContactId } })
  if (!contact || contact.caseId !== list.caseId) throw new NotFoundError()
  if (!contact.isActive) throw new Error('Contact is deactivated')

  const lastReminder = await prisma.reminderEvent.findFirst({
    where: {
      requestListId:   list.id,
      clientContactId: contact.id,
      kind:            { in: ['REMINDER', 'INVITE'] },
      status:          'SENT',
    },
    orderBy: { sentAt: 'desc' },
    select:  { sentAt: true },
  })
  if (lastReminder) {
    const elapsed = Date.now() - lastReminder.sentAt.getTime()
    if (elapsed < REMINDER_MIN_INTERVAL_MS) {
      await prisma.reminderEvent.create({
        data: {
          caseId:        list.caseId,
          requestListId: list.id,
          clientContactId: contact.id,
          kind:          'REMINDER',
          channel:       'EMAIL',
          toEmail:       contact.email,
          sentBy:        session.userId,
          status:        'SUPPRESSED',
          errorMessage:  `Suppressed — last touch was ${Math.round(elapsed / 60000)} min ago`,
        },
      })
      return { sent: false, reason: 'Rate limited — last reminder was under 24h ago' }
    }
  }

  await prisma.reminderEvent.create({
    data: {
      caseId:        list.caseId,
      requestListId: list.id,
      clientContactId: contact.id,
      kind:          'REMINDER',
      channel:       'EMAIL',
      toEmail:       contact.email,
      sentBy:        session.userId,
      status:        'SENT',
    },
  })
  void sendMail({
    to:       contact.email,
    subject:  `Reminder — ${list.title}`,
    text:     `Hello ${contact.name},\n\nThis is a friendly reminder that outstanding items remain on your request list.\n\nUse your existing invite link, or contact the engagement team for a new one.\n`,
    category: 'portal-reminder',
  }).catch(err => console.error('[portal-reminder] mail send failed:', (err as Error).message))

  await logAction({
    userId: session.userId, action: 'UPDATE_CASE',
    caseId: list.caseId, targetModel: 'ClientContact', targetId: contact.id,
    note: 'portal reminder sent',
  })
  return { sent: true }
}
