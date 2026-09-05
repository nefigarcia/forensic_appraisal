/**
 * EvidenceCitation parent invariant.
 *
 * The schema has three optional FKs (`financialValueId`, `addBackId`,
 * `valuationModelId`). Exactly one must be set per row — enforced at the
 * application layer by `assertSingleParent` and by the shape helpers in
 * this module.
 */

export type CitationParent =
  | { kind: 'financialValue'; id: string }
  | { kind: 'addBack';        id: string }
  | { kind: 'valuationModel'; id: string }

export function parentColumns(parent: CitationParent): {
  financialValueId?: string
  addBackId?:        string
  valuationModelId?: string
} {
  switch (parent.kind) {
    case 'financialValue': return { financialValueId: parent.id }
    case 'addBack':        return { addBackId:        parent.id }
    case 'valuationModel': return { valuationModelId: parent.id }
  }
}

/**
 * Throws if the given row has zero or multiple parents. Use on read-back
 * shapes when in doubt; on write we control the shape so this is only a
 * defensive check.
 */
export function assertSingleParent(row: {
  financialValueId?: string | null
  addBackId?:        string | null
  valuationModelId?: string | null
}): CitationParent {
  const set = [
    row.financialValueId  ? { kind: 'financialValue' as const, id: row.financialValueId }  : null,
    row.addBackId         ? { kind: 'addBack'        as const, id: row.addBackId }         : null,
    row.valuationModelId  ? { kind: 'valuationModel' as const, id: row.valuationModelId }  : null,
  ].filter(Boolean) as CitationParent[]
  if (set.length !== 1) {
    throw new Error(
      `[citations] EvidenceCitation must have exactly one parent; got ${set.length}`,
    )
  }
  return set[0]!
}
