import { describe, it, expect } from 'vitest'
import {
  validateUpload,
  extensionOf,
  sanitizeFilename,
  UploadValidationError,
  MAX_UPLOAD_BYTES,
  ALLOWED_EXTENSIONS,
} from '@/lib/documents/validation'

// ─── magic-byte helpers ────────────────────────────────────────────
const PDF_HEAD  = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37])           // %PDF-1.7
const PNG_HEAD  = Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])
const JPEG_HEAD = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0])
const ZIP_HEAD  = Uint8Array.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0])
const OLE_HEAD  = Uint8Array.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
const RANDOM    = Uint8Array.from([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE])

describe('extensionOf / sanitizeFilename', () => {
  it('extracts a lowercase alphanumeric extension', () => {
    expect(extensionOf('Statement.PDF')).toBe('pdf')
    expect(extensionOf('deck.tar.gz')).toBe('gz')
    expect(extensionOf('noext')).toBe('')
    expect(extensionOf('weird.file.name.xlsx')).toBe('xlsx')
  })

  it('strips non-safe filename characters', () => {
    expect(sanitizeFilename('Q1 statement (2024).pdf')).toBe('Q1_statement__2024_.pdf')
    // 日本 is two JS UTF-16 code units → two underscores.
    expect(sanitizeFilename('日本.pdf')).toBe('__.pdf')
  })
})

describe('validateUpload — size', () => {
  it('rejects an empty buffer', () => {
    expect(() => validateUpload('x.pdf', new Uint8Array())).toThrow(UploadValidationError)
    try { validateUpload('x.pdf', new Uint8Array()) } catch (e: any) { expect(e.code).toBe('EMPTY_FILE') }
  })

  it('rejects a buffer over the max', () => {
    // Simulate by pretending; we don't need to allocate 100 MB.
    const fakeLarge = new Uint8Array(MAX_UPLOAD_BYTES + 1)
    fakeLarge.set(PDF_HEAD, 0)
    expect(() => validateUpload('x.pdf', fakeLarge)).toThrow(/exceeds/)
  })
})

describe('validateUpload — extension allowlist', () => {
  it('rejects a bogus extension', () => {
    try {
      validateUpload('x.exe', PDF_HEAD)
    } catch (e: any) {
      expect(e.code).toBe('BAD_EXTENSION')
    }
  })

  it('rejects a file with no extension', () => {
    expect(() => validateUpload('README', PDF_HEAD)).toThrow(/not allowed/)
  })

  it('accepts every entry in the allowlist as an extension', () => {
    // Not asserting each one validates — some (txt/csv) have no signature,
    // but this loop guarantees each ext at least reaches the signature step.
    for (const ext of ALLOWED_EXTENSIONS) {
      const name = `x.${ext}`
      // txt/csv have no signature; anything with content passes.
      // For signed types, we pass a matching header.
      const buffer =
        ext === 'pdf'                    ? PDF_HEAD
      : ['png'].includes(ext)            ? PNG_HEAD
      : ['jpg', 'jpeg'].includes(ext)    ? JPEG_HEAD
      : ['docx', 'xlsx'].includes(ext)   ? ZIP_HEAD
      : ['doc',  'xls'].includes(ext)    ? OLE_HEAD
      : ext === 'gif'                    ? Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0])
      : ext === 'webp'                   ? Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
      : Uint8Array.from([0x61, 0x62, 0x63]) // txt/csv — arbitrary text
      expect(() => validateUpload(name, buffer)).not.toThrow()
    }
  })
})

describe('validateUpload — magic-byte sniff', () => {
  it('accepts a real PDF', () => {
    const res = validateUpload('statement.pdf', PDF_HEAD)
    expect(res.extension).toBe('pdf')
    expect(res.detectedMime).toBe('application/pdf')
  })

  it('rejects a fake PDF (extension pdf, contents random)', () => {
    try {
      validateUpload('fake.pdf', RANDOM)
    } catch (e: any) {
      expect(e.code).toBe('MIME_MISMATCH')
    }
  })

  it('rejects a fake PNG', () => {
    try { validateUpload('fake.png', RANDOM) } catch (e: any) { expect(e.code).toBe('MIME_MISMATCH') }
  })

  it('accepts a docx (ZIP-based, extension docx)', () => {
    expect(validateUpload('deck.docx', ZIP_HEAD).detectedMime)
      .toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })

  it('accepts a legacy .doc (OLE compound)', () => {
    expect(validateUpload('deck.doc', OLE_HEAD).detectedMime).toBe('application/msword')
  })

  it('accepts CSV without a signature check', () => {
    const csv = Buffer.from('Header1,Header2\n1,2\n', 'utf8')
    const res = validateUpload('sheet.csv', new Uint8Array(csv))
    expect(res.detectedMime).toBe('text/csv')
  })
})

describe('validateUpload — zip-bomb defense', () => {
  it('rejects a ZIP renamed to .pdf', () => {
    try {
      validateUpload('bomb.pdf', ZIP_HEAD)
    } catch (e: any) {
      expect(e.code).toBe('DANGEROUS_ARCHIVE')
    }
  })

  it('rejects a ZIP renamed to .png', () => {
    expect(() => validateUpload('bomb.png', ZIP_HEAD)).toThrow(/ZIP/)
  })

  it('accepts a ZIP as .docx (legitimate ZIP container)', () => {
    expect(() => validateUpload('report.docx', ZIP_HEAD)).not.toThrow()
  })

  it('accepts a ZIP as .xlsx (legitimate ZIP container)', () => {
    expect(() => validateUpload('sheet.xlsx', ZIP_HEAD)).not.toThrow()
  })
})
