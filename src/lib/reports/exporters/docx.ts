/**
 * Professional DOCX exporter.
 *
 * Uses the `docx` npm package to compose a real Word file — not
 * markdown-in-a-.docx-envelope. Produces a Buffer the caller streams
 * back to the browser (see `src/app/actions/report-export.ts`).
 *
 * The disclaimer text is prepended to every generated document so a
 * downstream reader who opens the file cannot miss that the checklists
 * are an aid, not a compliance certification.
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType,
} from 'docx'
import { DEFAULT_SECTION_ORDER, SECTION_CATALOG, type ReportSectionKey } from '../sections'
import { CHECKLIST_DISCLAIMER } from '../checklists'

export interface DocxExportInput {
  title:           string
  standardsFamily: string | null
  frozenAt:        Date
  factsHash:       string
  sections: Record<ReportSectionKey, {
    status:               string
    body:                 string | null
    missingInformation?:  string[] | null
    isConfident?:         boolean
  } | undefined>
  citations: Array<{
    sectionKey: string
    targetType: string
    targetId:   string
    snippet?:   string | null
  }>
}

export async function renderDocx(input: DocxExportInput): Promise<Buffer> {
  const paragraphs: Paragraph[] = []

  paragraphs.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: input.title })],
  }))
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: `Frozen ${input.frozenAt.toISOString()} • Facts hash ${input.factsHash.slice(0, 16)}…`
        + (input.standardsFamily ? ` • Standards family: ${input.standardsFamily}` : ''),
      italics: true,
      size: 18,
    })],
  }))
  paragraphs.push(new Paragraph({ children: [new TextRun({ text: '' })] }))

  paragraphs.push(new Paragraph({
    children: [new TextRun({
      text: 'NOTICE — ' + CHECKLIST_DISCLAIMER,
      bold: true,
      size: 18,
    })],
  }))
  paragraphs.push(new Paragraph({ children: [new TextRun({ text: '' })] }))

  for (const key of DEFAULT_SECTION_ORDER) {
    const meta    = SECTION_CATALOG[key]
    const section = input.sections[key]

    paragraphs.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: meta.title })],
    }))

    if (!section || !section.body) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({
          text: '[Section not yet drafted]',
          italics: true, color: '888888',
        })],
      }))
    } else {
      for (const line of section.body.trim().split(/\r?\n/)) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: line })] }))
      }
      if (section.isConfident === false) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({
            text: 'NOTE: The draft was returned by the AI with low confidence and requires reviewer attention.',
            italics: true, color: 'CC7700',
          })],
        }))
      }
      if (section.missingInformation && section.missingInformation.length > 0) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: 'Missing information flagged:', bold: true })],
        }))
        for (const m of section.missingInformation) {
          paragraphs.push(new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: m })],
          }))
        }
      }
    }
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: '' })] }))
  }

  if (input.citations.length > 0) {
    paragraphs.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Citations' })],
    }))
    for (const c of input.citations) {
      paragraphs.push(new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({
          text: `[${c.sectionKey}] ${c.targetType}:${c.targetId}` + (c.snippet ? ` — “${c.snippet}”` : ''),
        })],
      }))
    }
  }

  const doc = new Document({ sections: [{ children: paragraphs }] })
  return Packer.toBuffer(doc)
}
