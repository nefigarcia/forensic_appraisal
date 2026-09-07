/**
 * Assumption-event helpers.
 *
 * `AssumptionEvent` is append-only at the app layer — this module
 * only writes rows, never updates them. Every write also updates the
 * parent `ValuationAssumption` metadata (status timestamps, reviewer),
 * so callers should invoke these inside the same transaction as the
 * parent update to keep the two in sync.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import type { AssumptionStatus } from './statuses'

export type AssumptionEventAction =
  | 'CREATE'
  | 'UPDATE_VALUE'
  | 'PROPOSE'
  | 'APPROVE'
  | 'REJECT'
  | 'SUPERSEDE'
  | 'REOPEN'

export interface WriteAssumptionEventInput {
  assumptionId: string
  action:       AssumptionEventAction
  userId?:      string | null
  oldValue?:    unknown
  newValue?:    unknown
  note?:        string
}

/**
 * Append an audit event. Accepts either the top-level Prisma client or
 * a transaction handle — both expose `.assumptionEvent.create`.
 */
export async function writeAssumptionEvent(
  client: PrismaClient | Prisma.TransactionClient,
  input: WriteAssumptionEventInput,
): Promise<void> {
  await client.assumptionEvent.create({
    data: {
      assumptionId: input.assumptionId,
      action:       input.action,
      userId:       input.userId ?? null,
      oldValue:     input.oldValue != null ? JSON.stringify(input.oldValue) : null,
      newValue:     input.newValue != null ? JSON.stringify(input.newValue) : null,
      note:         input.note ?? null,
    },
  })
}

/**
 * Given the (from → to) status transition, return the AssumptionEvent
 * action that should be logged. Distinct from the transition table
 * itself because REJECT and REOPEN are the same DB status change
 * (→ DRAFT) with different intent.
 */
export function eventForTransition(
  from: AssumptionStatus, to: AssumptionStatus,
): AssumptionEventAction {
  if (to === 'PROPOSED')   return 'PROPOSE'
  if (to === 'APPROVED')   return 'APPROVE'
  if (to === 'REJECTED')   return 'REJECT'
  if (to === 'SUPERSEDED') return 'SUPERSEDE'
  if (to === 'DRAFT' && from === 'REJECTED') return 'REOPEN'
  if (to === 'DRAFT' && from === 'PROPOSED') return 'REOPEN'
  return 'UPDATE_VALUE'
}
