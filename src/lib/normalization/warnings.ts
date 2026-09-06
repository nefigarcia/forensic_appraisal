/**
 * Evidence-completeness warnings.
 *
 * Warnings are non-blocking. A DRAFT / PROPOSED adjustment with a
 * missing rationale still saves, still submits — but the workbench flags
 * it so an analyst can spot the gap before the reviewer does. Report
 * generation (Slice 8 draftReportSection) can gate on these separately.
 *
 * Rule: warnings are surfaced, never silently hidden. If the caller
 * chooses to filter or ignore them, that's a UX decision — the server
 * always returns the complete list.
 */

export type WarningCode =
  | 'MISSING_RATIONALE'
  | 'NO_CITATIONS'
  | 'NO_AMOUNTS'
  | 'MISSING_TAX_TREATMENT'
  | 'MISSING_RECURRING_LABEL'

export interface AdjustmentWarning {
  code:     WarningCode
  message:  string
  severity: 'INFO' | 'WARN' | 'ERROR'
}

export interface AdjustmentForWarnings {
  rationale?:      string | null
  citationCount?:  number
  amounts:         { year2?: unknown; year1?: unknown; ttm?: unknown }
  taxTreatment?:   string | null
  recurring?:      string | null
  status?:         string
}

/**
 * Returns the list of warnings that apply to the adjustment. Callers
 * choose whether to display / group / block on them.
 */
export function warningsFor(input: AdjustmentForWarnings): AdjustmentWarning[] {
  const out: AdjustmentWarning[] = []

  if (!input.rationale || !input.rationale.trim()) {
    out.push({
      code: 'MISSING_RATIONALE',
      message: 'No professional rationale recorded. Required before report generation.',
      severity: 'ERROR',
    })
  }

  if ((input.citationCount ?? 0) === 0) {
    out.push({
      code: 'NO_CITATIONS',
      message: 'No supporting evidence citations attached.',
      severity: 'WARN',
    })
  }

  const noAmount =
    (input.amounts.year2 == null) &&
    (input.amounts.year1 == null) &&
    (input.amounts.ttm   == null)
  if (noAmount) {
    out.push({
      code: 'NO_AMOUNTS',
      message: 'Amount not specified for any period.',
      severity: 'ERROR',
    })
  }

  if (!input.recurring) {
    out.push({
      code: 'MISSING_RECURRING_LABEL',
      message: 'Recurring / nonrecurring not indicated.',
      severity: 'INFO',
    })
  }

  if (!input.taxTreatment) {
    out.push({
      code: 'MISSING_TAX_TREATMENT',
      message: 'Tax treatment not specified. Optional for pre-tax analyses.',
      severity: 'INFO',
    })
  }

  return out
}

export function severityRank(w: AdjustmentWarning): number {
  return w.severity === 'ERROR' ? 0 : w.severity === 'WARN' ? 1 : 2
}
