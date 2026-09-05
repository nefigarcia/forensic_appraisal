/**
 * Upload validation — size, extension, and magic-byte MIME sniff.
 *
 * All three checks happen BEFORE we touch S3, so a rejected upload leaves
 * no orphan object behind.
 *
 * The MIME sniff exists because a client-declared MIME (`file.type`) is not
 * trustworthy — a browser will happily send `application/pdf` for a
 * `.pdf`-renamed executable. We inspect the first bytes of the buffer and
 * only accept files whose signature matches one of the known forensic-doc
 * types.
 */

// ─── Config ────────────────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024   // 100 MB
export const MIN_UPLOAD_BYTES = 1                    // reject empty files

export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf',
  'png', 'jpg', 'jpeg', 'webp', 'gif',
  'xlsx', 'xls', 'csv',
  'docx', 'doc',
  'txt',
])

// ─── Errors ────────────────────────────────────────────────────────────

export type ValidationCode =
  | 'EMPTY_FILE'
  | 'TOO_LARGE'
  | 'BAD_EXTENSION'
  | 'MIME_MISMATCH'
  | 'DANGEROUS_ARCHIVE'
  | 'UNKNOWN_SIGNATURE'

export class UploadValidationError extends Error {
  code: ValidationCode
  constructor(code: ValidationCode, message: string) {
    super(message)
    this.name = 'UploadValidationError'
    this.code = code
  }
}

// ─── Magic-byte table ──────────────────────────────────────────────────
// Keyed off the file extension the analyst is claiming to upload. The
// verifier walks the associated signatures and returns the first match.
// A file whose extension is in ALLOWED_EXTENSIONS but does not match any
// declared signature is rejected as `MIME_MISMATCH`.

interface Signature {
  offset:  number
  bytes:   readonly number[]
  mime:    string
}

const SIGNATURES: Readonly<Record<string, readonly Signature[]>> = {
  pdf:  [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2D],                         mime: 'application/pdf' }],
  png:  [{ offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],       mime: 'image/png' }],
  jpg:  [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF],                                     mime: 'image/jpeg' }],
  jpeg: [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF],                                     mime: 'image/jpeg' }],
  gif:  [
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], mime: 'image/gif' },
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], mime: 'image/gif' },
  ],
  webp: [
    // RIFF....WEBP — bytes at offset 8 are the "WEBP" marker.
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' },
  ],
  // ZIP-based Office formats. We accept the ZIP local-header signature
  // and rely on the extension + the fact that docx/xlsx are legitimate
  // ZIP containers. The magic-byte check catches disguised ZIPs; the
  // extension check catches ZIPs pretending to be other things.
  docx: [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
  xlsx: [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04], mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
  // Old OLE compound (doc/xls) all share the same magic. The extension
  // determines the reported mime.
  doc:  [{ offset: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], mime: 'application/msword' }],
  xls:  [{ offset: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], mime: 'application/vnd.ms-excel' }],
  // Plain-text and CSV are not signed. We accept them without a magic-byte
  // check but still enforce the allowlist and size limit.
  csv:  [],
  txt:  [],
}

/** ZIP local-header signature — used to spot ZIPs disguised as other files. */
const ZIP_SIGNATURE = [0x50, 0x4B, 0x03, 0x04]

// ─── Public API ────────────────────────────────────────────────────────

export interface ValidationResult {
  extension:   string
  detectedMime: string
}

/**
 * Validate an upload. Throws `UploadValidationError` on any of:
 *   - empty or > 100 MB
 *   - extension not in the allowlist
 *   - first bytes do not match any signature registered for that extension
 *   - first bytes look like a ZIP but the extension is not a legitimate
 *     ZIP container (docx / xlsx) — defends against zip-bomb-as-pdf
 *
 * Returns the sanitized extension + the mime type inferred from the
 * signature (not the client-declared one).
 */
export function validateUpload(
  originalName: string,
  buffer: Uint8Array,
): ValidationResult {
  if (buffer.byteLength < MIN_UPLOAD_BYTES) {
    throw new UploadValidationError('EMPTY_FILE', 'Empty upload')
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      'TOO_LARGE',
      `File exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`,
    )
  }

  const ext = extensionOf(originalName)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new UploadValidationError('BAD_EXTENSION', `Extension .${ext} is not allowed`)
  }

  // ── Zip-bomb defense ────────────────────────────────────────────────
  // If the buffer looks like a ZIP but the caller-declared extension is
  // not a legitimate ZIP container, reject. This catches renamed zips
  // that a naive extension check would let through.
  const looksLikeZip = matchesAt(buffer, 0, ZIP_SIGNATURE)
  const legitimateZipExt = ext === 'docx' || ext === 'xlsx'
  if (looksLikeZip && !legitimateZipExt) {
    throw new UploadValidationError(
      'DANGEROUS_ARCHIVE',
      'File contents are a ZIP archive but the extension is not a ZIP-based format',
    )
  }

  // ── Signature match ─────────────────────────────────────────────────
  const registered = SIGNATURES[ext]
  if (!registered) {
    // Unknown extension made it past the allowlist — configuration bug.
    throw new UploadValidationError('UNKNOWN_SIGNATURE', `No signature table for .${ext}`)
  }
  if (registered.length === 0) {
    // Signature-free type (txt, csv). Accept.
    return { extension: ext, detectedMime: ext === 'csv' ? 'text/csv' : 'text/plain' }
  }
  const hit = registered.find(s => matchesAt(buffer, s.offset, s.bytes))
  if (!hit) {
    throw new UploadValidationError(
      'MIME_MISMATCH',
      `File contents do not match declared .${ext} format`,
    )
  }
  return { extension: ext, detectedMime: hit.mime }
}

// ─── Helpers ───────────────────────────────────────────────────────────

export function extensionOf(name: string): string {
  const parts = name.toLowerCase().split('.')
  if (parts.length < 2) return ''
  return parts[parts.length - 1]!.replace(/[^a-z0-9]/g, '')
}

/**
 * Replace anything that isn't `[A-Za-z0-9._-]` with `_`. The result is safe
 * to use as an S3 key segment.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_')
}

function matchesAt(buffer: Uint8Array, offset: number, bytes: readonly number[]): boolean {
  if (buffer.byteLength < offset + bytes.length) return false
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[offset + i] !== bytes[i]) return false
  }
  return true
}
