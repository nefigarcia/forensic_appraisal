/**
 * Plain-text exporter — the always-available fallback.
 *
 * Renders the report as UTF-8 plain text suitable for pasting into
 * Word / Google Docs. The DOCX exporter (see docx.ts) produces a
 * richer output but relies on the `docx` npm package, which may not
 * be installed in every deployment.
 *
 * The output is deterministic given the same inputs — makes it easy
 * to snapshot in tests.
 */

import { DEFAULT_SECTION_ORDER, SECTION_CATALOG, type ReportSectionKey } from '../sections'
import { CHECKLIST_DISCLAIMER } from '../checklists'

export interface PlainTextExportInput {
  title:           string
  standardsFamily: string | null
  frozenAt:        Date
  factsHash:       string
  sections: Record<ReportSectionKey, {
    status:      string
    body:        string | null
    missingInformation?: string[] | null
    isConfident?: boolean
  } | undefined>
  citations: Array<{
    sectionKey: string
    targetType: string
    targetId:   string
    snippet?:   string | null
  }>
}

const DIVIDER = '\n' + '─'.repeat(72) + '\n'

export function renderPlainText(input: PlainTextExportInput): string {
  const out: string[] = []
  out.push(input.title)
  out.push('='.repeat(input.title.length))
  out.push('')
  out.push(`Frozen at: ${input.frozenAt.toISOString()}`)
  out.push(`Facts hash: ${input.factsHash.slice(0, 16)}…`)
  if (input.standardsFamily) out.push(`Standards family: ${input.standardsFamily}`)
  out.push('')
  out.push('NOTICE — ' + CHECKLIST_DISCLAIMER)
  out.push(DIVIDER)

  for (const key of DEFAULT_SECTION_ORDER) {
    const meta    = SECTION_CATALOG[key]
    const section = input.sections[key]
    out.push(`## ${meta.title}`)
    out.push('')
    if (!section || !section.body) {
      out.push('[Section not yet drafted]')
    } else {
      out.push(section.body.trim())
      if (section.isConfident === false) {
        out.push('')
        out.push('[NOTE: The draft was returned by the AI with low confidence and requires reviewer attention.]')
      }
      if (section.missingInformation && section.missingInformation.length > 0) {
        out.push('')
        out.push('Missing information flagged:')
        for (const item of section.missingInformation) out.push(`  - ${item}`)
      }
    }
    out.push('')
  }

  // Consolidated citations at the end.
  if (input.citations.length > 0) {
    out.push(DIVIDER)
    out.push('## Citations')
    out.push('')
    for (const c of input.citations) {
      out.push(`  - [${c.sectionKey}] ${c.targetType}:${c.targetId}${c.snippet ? ` — "${c.snippet}"` : ''}`)
    }
  }
  return out.join('\n')
}
