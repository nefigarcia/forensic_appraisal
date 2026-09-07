/**
 * Malware-scanner interface + stub implementation.
 *
 * Slice 5 lands the storage model (`scanStatus`, `scanReport`, `scannedAt`
 * on `DocumentVersion`) and the interface. It ships a `NullScanner` that
 * marks every version `CLEAN` immediately. A future ops slice replaces
 * that with a real transport (ClamAV socket, AWS Malware Protection,
 * Cloudmersive, etc.) without changing any caller.
 *
 * Scan flow:
 *   1. addDocument() finishes the upload with scanStatus = PENDING.
 *   2. addDocument() calls `scanner.scanAsync(versionId, buffer)`.
 *   3. When the scan resolves, it updates the row to CLEAN or INFECTED
 *      and sets `scannedAt`.
 *   4. Downloads refuse to sign a URL for a version whose scanStatus is
 *      not CLEAN.
 */

import { prisma } from '@/lib/prisma'

export type ScanStatus = 'PENDING' | 'SCANNING' | 'CLEAN' | 'INFECTED' | 'ERROR'

export interface ScanResult {
  status: 'CLEAN' | 'INFECTED' | 'ERROR'
  report?: string
}

export interface Scanner {
  /**
   * Kick off a scan for the given DocumentVersion. Implementations may
   * be synchronous (like the null scanner) or fire-and-forget with a
   * later DB update. The buffer is passed by-value; the caller loses
   * ownership as soon as `scanAsync` returns.
   */
  scanAsync(versionId: string, buffer: Uint8Array): Promise<ScanResult | void>
}

// ─────────────────────────────────────────────────
// NullScanner — dev/default
// ─────────────────────────────────────────────────

export class NullScanner implements Scanner {
  async scanAsync(versionId: string, _buffer: Uint8Array): Promise<ScanResult> {
    const result: ScanResult = { status: 'CLEAN', report: 'NullScanner: no scanning performed' }
    await prisma.documentVersion.update({
      where: { id: versionId },
      data: {
        scanStatus: result.status,
        scanReport: result.report,
        scannedAt:  new Date(),
      },
    }).catch((e) => {
      // A failing update must not crash the calling action.
      console.error('[NullScanner] failed to update scanStatus:', (e as Error).message)
    })
    return result
  }
}

// ─────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────

let cached: Scanner | null = null

/** Test hook — clear the memoized scanner. */
export function __resetScannerForTests(): void { cached = null }

export function scanner(): Scanner {
  if (cached) return cached
  // Future: read env / config to pick a real scanner. Today, one option.
  cached = new NullScanner()
  return cached
}
