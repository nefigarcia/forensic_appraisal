/**
 * Portal invite issuance.
 *
 * Load-bearing invariants:
 *   1. Only the SHA-256 hash of the raw token is written to the DB.
 *   2. The raw token is returned to the caller EXACTLY ONCE — the DB
 *      row on its own does not let anyone re-derive it.
 *   3. Deactivating a ClientContact revokes all their outstanding
 *      portal links.
 *   4. Reminders are rate-limited to one per 24h; suppressed reminders
 *      still log a ReminderEvent with status=SUPPRESSED.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:          { findFirst: vi.fn() },
    caseMember:    { findUnique: vi.fn() },
    requestList:   { findUnique: vi.fn(), update: vi.fn() },
    requestItem:   { updateMany: vi.fn() },
    clientContact: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    portalAccess:  { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    reminderEvent: { create: vi.fn(), findFirst: vi.fn() },
    $transaction:  vi.fn(async (fn: any) => fn({
      portalAccess:  { create: vi.fn().mockResolvedValue({}) },
      requestList:   { update: vi.fn() },
      requestItem:   { updateMany: vi.fn() },
      reminderEvent: { create: vi.fn() },
      clientContact: { update: vi.fn() },
    })),
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('@/lib/mailer',     () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import {
  invitePortalAccess,
  deactivateClientContact,
  sendPortalReminder,
} from '@/app/actions/portal-invites'
import { hashPortalToken } from '@/lib/portal/tokens'
import { sendMail } from '@/lib/mailer'

const session = { userId: 'user-firm', organizationId: 'org-a', role: 'EDITOR', email: 'e@a', jti: 'j' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(session as any)
  vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
})

describe('invitePortalAccess — token lifecycle', () => {
  it('returns a raw token; DB write only ever gets the hash', async () => {
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({
      id: 'list-1', caseId: 'case-a', status: 'DRAFT', title: 'PBC',
    } as any)
    vi.mocked(prisma.clientContact.findUnique).mockResolvedValue({
      id: 'c-1', caseId: 'case-a', isActive: true, name: 'Ms. Client', email: 'client@ex.com',
    } as any)

    let capturedCreateArg: any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      await fn({
        portalAccess: {
          create: (args: any) => { capturedCreateArg = args; return Promise.resolve({}) },
        },
        requestList: { update: vi.fn() },
        requestItem: { updateMany: vi.fn() },
        reminderEvent: { create: vi.fn() },
      })
      return {}
    })

    const r = await invitePortalAccess({ requestListId: 'list-1', clientContactId: 'c-1' })
    expect(r.rawToken.length).toBeGreaterThanOrEqual(40)
    expect(r.url).toContain('/portal/' + r.rawToken)
    // The stored value MUST be the hash of the raw token, not the token itself.
    expect(capturedCreateArg.data.tokenHash).toBe(hashPortalToken(r.rawToken))
    expect(capturedCreateArg.data.tokenHash).not.toBe(r.rawToken)
  })

  it('a DRAFT list on the first invite auto-transitions to SENT', async () => {
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({
      id: 'list-1', caseId: 'case-a', status: 'DRAFT', title: 'PBC',
    } as any)
    vi.mocked(prisma.clientContact.findUnique).mockResolvedValue({
      id: 'c-1', caseId: 'case-a', isActive: true, name: 'Cli', email: 'c@ex.com',
    } as any)

    const capturedTxCalls: string[] = []
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      await fn({
        portalAccess:  { create: vi.fn().mockResolvedValue({}) },
        requestList:   { update: (args: any) => { capturedTxCalls.push('list ' + args.data.status) } },
        requestItem:   { updateMany: (args: any) => { capturedTxCalls.push('items ' + args.data.status + ' where ' + args.where.status) } },
        reminderEvent: { create: vi.fn() },
      })
      return {}
    })
    await invitePortalAccess({ requestListId: 'list-1', clientContactId: 'c-1' })
    expect(capturedTxCalls).toContain('list SENT')
    expect(capturedTxCalls).toContain('items REQUESTED where NOT_REQUESTED')
  })

  it('a CLOSED list refuses to issue new invites', async () => {
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({
      id: 'list-1', caseId: 'case-a', status: 'CLOSED', title: 'PBC',
    } as any)
    await expect(invitePortalAccess({ requestListId: 'list-1', clientContactId: 'c-1' }))
      .rejects.toThrow(/closed/)
  })

  it('a contact from a different case is refused', async () => {
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({
      id: 'list-1', caseId: 'case-a', status: 'SENT', title: 'PBC',
    } as any)
    vi.mocked(prisma.clientContact.findUnique).mockResolvedValue({
      id: 'c-2', caseId: 'DIFFERENT-CASE', isActive: true, name: 'X', email: 'x@x',
    } as any)
    await expect(invitePortalAccess({ requestListId: 'list-1', clientContactId: 'c-2' }))
      .rejects.toThrow()
  })

  it('fires a portal-invite mail (best-effort)', async () => {
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({
      id: 'list-1', caseId: 'case-a', status: 'SENT', title: 'PBC list',
    } as any)
    vi.mocked(prisma.clientContact.findUnique).mockResolvedValue({
      id: 'c-1', caseId: 'case-a', isActive: true, name: 'C', email: 'c@ex.com',
    } as any)
    await invitePortalAccess({ requestListId: 'list-1', clientContactId: 'c-1' })
    // sendMail runs after the transaction; give the microtask queue a
    // moment to flush.
    await Promise.resolve()
    await Promise.resolve()
    expect(sendMail).toHaveBeenCalled()
    const mailArg = vi.mocked(sendMail).mock.calls[0]![0]
    expect(mailArg.category).toBe('portal-invite')
    expect(mailArg.to).toBe('c@ex.com')
  })
})

// ─────────────────────────────────────────────────
// Deactivating a contact revokes their portal access
// ─────────────────────────────────────────────────

describe('deactivateClientContact', () => {
  it('revokes every non-revoked PortalAccess for the contact', async () => {
    vi.mocked(prisma.clientContact.findUnique).mockResolvedValue({
      id: 'c-1', caseId: 'case-a', isActive: true, name: 'X', email: 'x@x',
    } as any)

    let updateManyArg: any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      await fn({
        clientContact: { update: vi.fn() },
        portalAccess:  { updateMany: (args: any) => { updateManyArg = args } },
      })
    })
    await deactivateClientContact({ id: 'c-1' })
    expect(updateManyArg.where.clientContactId).toBe('c-1')
    expect(updateManyArg.where.revokedAt).toBe(null)
    expect(updateManyArg.data.revokedAt).toBeInstanceOf(Date)
  })
})

// ─────────────────────────────────────────────────
// Reminder rate-limit
// ─────────────────────────────────────────────────

describe('sendPortalReminder', () => {
  function primeList() {
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({
      id: 'list-1', caseId: 'case-a', status: 'SENT', title: 'PBC',
    } as any)
    vi.mocked(prisma.clientContact.findUnique).mockResolvedValue({
      id: 'c-1', caseId: 'case-a', isActive: true, name: 'C', email: 'c@ex.com',
    } as any)
  }

  it('suppresses a second reminder within 24h and logs it as SUPPRESSED', async () => {
    primeList()
    vi.mocked(prisma.reminderEvent.findFirst).mockResolvedValue({ sentAt: new Date(Date.now() - 60_000) } as any)
    const r = await sendPortalReminder({ requestListId: 'list-1', clientContactId: 'c-1' })
    expect(r.sent).toBe(false)
    const evt = vi.mocked(prisma.reminderEvent.create).mock.calls[0]![0]!.data as any
    expect(evt.status).toBe('SUPPRESSED')
  })

  it('sends when > 24h has elapsed since the last touch', async () => {
    primeList()
    vi.mocked(prisma.reminderEvent.findFirst).mockResolvedValue({
      sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    } as any)
    const r = await sendPortalReminder({ requestListId: 'list-1', clientContactId: 'c-1' })
    expect(r.sent).toBe(true)
    const evt = vi.mocked(prisma.reminderEvent.create).mock.calls[0]![0]!.data as any
    expect(evt.status).toBe('SENT')
  })

  it('refuses to remind on a CLOSED list', async () => {
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({
      id: 'list-1', caseId: 'case-a', status: 'CLOSED', title: 'PBC',
    } as any)
    await expect(sendPortalReminder({ requestListId: 'list-1', clientContactId: 'c-1' })).rejects.toThrow(/closed/)
  })
})
