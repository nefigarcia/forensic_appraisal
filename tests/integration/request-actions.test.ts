/**
 * Firm-side request-workflow actions.
 *
 * Covers:
 *   - status-machine enforcement on the server (mirrors the unit-level
 *     invariant but exercised through the real action code path)
 *   - dashboard aggregation shape (the "received / clarification /
 *     outstanding" trio the slice prompt calls out)
 *   - list SEND propagates NOT_REQUESTED → REQUESTED
 *   - AI completeness action never auto-transitions the status and
 *     downgrades unconfident verdicts to NEEDS_HUMAN
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    case:         { findFirst: vi.fn() },
    caseMember:   { findUnique: vi.fn() },
    requestList:  { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    requestItem:  {
      findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(),
      createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
      groupBy: vi.fn(), delete: vi.fn(),
    },
    reminderEvent: { create: vi.fn() },
    requestTemplate: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    requestTemplateItem: { count: vi.fn(), create: vi.fn(), createMany: vi.fn() },
    aiExecution: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn: any) => {
      // If a transaction argument is a fn, invoke it with a small mock tx.
      if (typeof fn === 'function') {
        return fn({
          requestList:  { create: vi.fn().mockResolvedValue({ id: 'list-new' }), update: vi.fn() },
          requestItem:  { createMany: vi.fn().mockResolvedValue({ count: 0 }), updateMany: vi.fn() },
          reminderEvent:{ create: vi.fn() },
        })
      }
      return Promise.all(fn)
    }),
  },
}))
vi.mock('@/lib/auth-utils', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',      () => ({ logAction: vi.fn() }))
vi.mock('next/cache',       () => ({ revalidatePath: vi.fn() }))
vi.mock('@/ai/flows/request-completeness-flow', () => ({
  assessCompleteness: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-utils'
import {
  addRequestItem,
  changeRequestItemStatus,
  getRequestDashboard,
  markRequestListSent,
} from '@/app/actions/requests'
import { runRequestCompletenessCheck } from '@/app/actions/request-completeness'
import { assessCompleteness } from '@/ai/flows/request-completeness-flow'

const editorInOrgA = { userId: 'user-e', organizationId: 'org-a', role: 'EDITOR', email: 'e@a', jti: 'j' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(editorInOrgA as any)
  vi.mocked(prisma.case.findFirst).mockResolvedValue({ id: 'case-a', organizationId: 'org-a', hasEngagementTeam: false } as any)
})

// ─────────────────────────────────────────────────
// Status machine (server-enforced)
// ─────────────────────────────────────────────────

describe('changeRequestItemStatus', () => {
  function primeItem(status: string, requestListId = 'list-1') {
    vi.mocked(prisma.requestItem.findUnique).mockResolvedValue({
      id: 'i-1', caseId: 'case-a', requestListId, status, title: 't',
    } as any)
    vi.mocked(prisma.requestItem.update).mockResolvedValue({} as any)
  }

  it('rejects an invalid transition even though the caller passed a valid enum', async () => {
    primeItem('NOT_REQUESTED')
    // NOT_REQUESTED → RECEIVED is refused by the state machine.
    await expect(changeRequestItemStatus({ id: 'i-1', next: 'RECEIVED' }))
      .rejects.toThrow(/Invalid transition/)
  })

  it('rejects unknown next status', async () => {
    primeItem('REQUESTED')
    await expect(changeRequestItemStatus({ id: 'i-1', next: 'DONE' }))
      .rejects.toThrow(/Unknown status/)
  })

  it('NEEDS_CLARIFICATION requires a note AND writes a ReminderEvent', async () => {
    primeItem('RECEIVED')
    await expect(changeRequestItemStatus({ id: 'i-1', next: 'NEEDS_CLARIFICATION' }))
      .rejects.toThrow(/requires a note/)

    await changeRequestItemStatus({ id: 'i-1', next: 'NEEDS_CLARIFICATION', note: 'The Q3 statement is missing.' })
    const data = vi.mocked(prisma.requestItem.update).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('NEEDS_CLARIFICATION')
    expect(data.clarificationNote).toBe('The Q3 statement is missing.')
    // A ReminderEvent should have been written so the timeline records
    // the reviewer's ask.
    expect(prisma.reminderEvent.create).toHaveBeenCalled()
    const evt = vi.mocked(prisma.reminderEvent.create).mock.calls[0]![0]!.data as any
    expect(evt.kind).toBe('CLARIFICATION')
  })

  it('REQUESTED → ACCEPTED is allowed (analyst signs off without a re-upload)', async () => {
    primeItem('REQUESTED')
    await changeRequestItemStatus({ id: 'i-1', next: 'ACCEPTED' })
    const data = vi.mocked(prisma.requestItem.update).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('ACCEPTED')
  })

  it('no-op transition is silent (from === to)', async () => {
    primeItem('RECEIVED')
    await changeRequestItemStatus({ id: 'i-1', next: 'RECEIVED' })
    expect(prisma.requestItem.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────
// Dashboard aggregation
// ─────────────────────────────────────────────────

describe('getRequestDashboard', () => {
  it('returns the received / clarification / outstanding trio', async () => {
    vi.mocked(prisma.requestItem.groupBy).mockResolvedValue([
      { status: 'REQUESTED',           _count: { _all: 7 } } as any,
      { status: 'RECEIVED',            _count: { _all: 15 } } as any,
      { status: 'ACCEPTED',            _count: { _all: 2 } } as any,
      { status: 'NEEDS_CLARIFICATION', _count: { _all: 3 } } as any,
      { status: 'NOT_APPLICABLE',      _count: { _all: 5 } } as any,
      { status: 'NOT_REQUESTED',       _count: { _all: 1 } } as any,
    ])
    const d = await getRequestDashboard('case-a')
    expect(d.received).toBe(17)       // RECEIVED + ACCEPTED — matches "17 / 24 received"
    expect(d.clarification).toBe(3)
    expect(d.outstanding).toBe(7)
    expect(d.totalTracked).toBe(27)   // 17 + 3 + 7
    expect(d.notApplicable).toBe(5)
    expect(d.notRequested).toBe(1)
  })
})

// ─────────────────────────────────────────────────
// markRequestListSent — NOT_REQUESTED items become REQUESTED
// ─────────────────────────────────────────────────

describe('markRequestListSent', () => {
  it('flips DRAFT → SENT and NOT_REQUESTED items → REQUESTED atomically', async () => {
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({ id: 'list-1', caseId: 'case-a', status: 'DRAFT' } as any)
    const capturedTxCalls: string[] = []
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      await fn({
        requestList: { update: (args: any) => { capturedTxCalls.push('list-update ' + args.data.status) } },
        requestItem: { updateMany: (args: any) => {
          capturedTxCalls.push('items → ' + args.data.status + ' where ' + args.where.status)
        } },
      })
      return {}
    })
    await markRequestListSent({ requestListId: 'list-1' })
    expect(capturedTxCalls).toEqual([
      'list-update SENT',
      'items → REQUESTED where NOT_REQUESTED',
    ])
  })
})

// ─────────────────────────────────────────────────
// AI completeness — NEVER auto-transitions, downgrades unconfident
// ─────────────────────────────────────────────────

describe('runRequestCompletenessCheck', () => {
  const NOOP_EXEC = { id: 'exec-1' }

  function primeItemWithDoc() {
    vi.mocked(prisma.requestItem.findUnique).mockResolvedValue({
      id: 'i-1', caseId: 'case-a', title: 'Tax returns',
      description: null, category: 'TAX', status: 'RECEIVED',
      documents: [{
        document: {
          name: 'return_2024.pdf', type: 'application/pdf', size: '2 MB',
          currentVersion: { id: 'dv-1', sizeBytes: BigInt(1024 * 50), mimeType: 'application/pdf' },
        },
      }],
    } as any)
    vi.mocked(prisma.requestItem.update).mockResolvedValue({} as any)
    vi.mocked(prisma.aiExecution.create).mockResolvedValue(NOOP_EXEC as any)
    vi.mocked(prisma.aiExecution.update).mockResolvedValue({} as any)
  }

  it('never auto-transitions the RequestItem status — only writes advisory fields', async () => {
    primeItemWithDoc()
    vi.mocked(assessCompleteness).mockResolvedValue({
      verdict: 'AUTO_COMPLETE', isConfident: true, reason: 'clear filename match',
    })
    await runRequestCompletenessCheck({ requestItemId: 'i-1' })
    const data = vi.mocked(prisma.requestItem.update).mock.calls.at(-1)![0]!.data as any
    expect(data.aiCompleteness).toBe('AUTO_COMPLETE')
    // status is NOT part of the write — the reviewer decides.
    expect(data.status).toBeUndefined()
  })

  it('downgrades an unconfident AUTO_COMPLETE to NEEDS_HUMAN (anti-hallucination)', async () => {
    primeItemWithDoc()
    vi.mocked(assessCompleteness).mockResolvedValue({
      verdict: 'AUTO_COMPLETE', isConfident: false, reason: 'generic filename',
    })
    const r = await runRequestCompletenessCheck({ requestItemId: 'i-1' })
    expect(r.verdict).toBe('NEEDS_HUMAN')
    expect(r.isConfident).toBe(false)
    const data = vi.mocked(prisma.requestItem.update).mock.calls.at(-1)![0]!.data as any
    expect(data.aiCompleteness).toBe('NEEDS_HUMAN')
    expect(data.aiCompletenessConfident).toBe(false)
  })

  it('refuses to run when no documents are attached', async () => {
    vi.mocked(prisma.requestItem.findUnique).mockResolvedValue({
      id: 'i-1', caseId: 'case-a', title: 't', description: null, category: null, status: 'REQUESTED', documents: [],
    } as any)
    await expect(runRequestCompletenessCheck({ requestItemId: 'i-1' })).rejects.toThrow(/No documents/)
  })
})

// ─────────────────────────────────────────────────
// addRequestItem — respects the parent list status
// ─────────────────────────────────────────────────

describe('addRequestItem', () => {
  it('a DRAFT list creates NOT_REQUESTED items', async () => {
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({ id: 'list-1', caseId: 'case-a', status: 'DRAFT' } as any)
    vi.mocked(prisma.requestItem.create).mockResolvedValue({ id: 'i-1' } as any)
    await addRequestItem({ requestListId: 'list-1', title: 'Tax returns (5 yr)' })
    const data = vi.mocked(prisma.requestItem.create).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('NOT_REQUESTED')
  })

  it('a SENT list creates REQUESTED items (client sees them immediately)', async () => {
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({ id: 'list-1', caseId: 'case-a', status: 'SENT' } as any)
    vi.mocked(prisma.requestItem.create).mockResolvedValue({ id: 'i-1' } as any)
    await addRequestItem({ requestListId: 'list-1', title: 'W-2 forms' })
    const data = vi.mocked(prisma.requestItem.create).mock.calls[0]![0]!.data as any
    expect(data.status).toBe('REQUESTED')
    expect(data.statusChangedAt).toBeInstanceOf(Date)
  })

  it('validates category + priority — unknown enum values rejected', async () => {
    vi.mocked(prisma.requestList.findUnique).mockResolvedValue({ id: 'list-1', caseId: 'case-a', status: 'DRAFT' } as any)
    await expect(addRequestItem({ requestListId: 'list-1', title: 't', category: 'SPACE' })).rejects.toThrow(/Unknown category/)
    await expect(addRequestItem({ requestListId: 'list-1', title: 't', priority: 'URGENT' })).rejects.toThrow(/Unknown priority/)
  })
})
