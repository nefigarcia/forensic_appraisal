'use client'

import * as React from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Loader2, RefreshCw, Download, Upload, Plug, ShieldAlert, Cable,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  exportSpreadsheet, startExcelImport, applyExcelImport, rejectExcelImport,
} from '@/app/actions/accounting-imports'
import {
  listAccountingConnectors, listIngestionRuns, ingestConnectorReport,
  disconnectAccountingConnector, listSourceRows, promoteSourceRow,
  type ConnectorForClient, type SourceRowSummary,
} from '@/app/actions/accounting-connectors'

const TEMPLATE_LABELS: Record<string, string> = {
  FINANCIAL_LEDGER: 'Financial Ledger',
  NORMALIZATION:    'Normalization Schedule',
  VALUATION:        'Valuation Calculations',
  TIE_OUTS:         'Tie-Outs',
}

export function AccountingIntegrationsPanel({ caseId }: { caseId: string }) {
  const [connectors, setConnectors] = React.useState<ConnectorForClient[]>([])
  const [runs,       setRuns]       = React.useState<SourceRowSummary[]>([])
  const [sourceRows, setSourceRows] = React.useState<any[]>([])
  const [busy, setBusy]             = React.useState(false)
  const [importResult, setImportResult] = React.useState<any>(null)
  const { toast } = useToast()

  const reload = React.useCallback(async () => {
    setBusy(true)
    try {
      const [cs, rs, sr] = await Promise.all([
        listAccountingConnectors(caseId),
        listIngestionRuns(caseId),
        listSourceRows(caseId),
      ])
      setConnectors(cs); setRuns(rs); setSourceRows(sr)
    } catch (e: any) {
      toast({ title: 'Load failed', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally { setBusy(false) }
  }, [caseId, toast])

  React.useEffect(() => { void reload() }, [reload])

  const onExport = async (kind: string) => {
    try {
      const r = await exportSpreadsheet({ caseId, templateKind: kind })
      downloadBase64(r.filename, r.base64,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      toast({ title: `Exported ${r.rowCount} rows` })
    } catch (e: any) { toast({ title: 'Export failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
  }

  const onImport = async (kind: string, file: File) => {
    try {
      const arrayBuf = await file.arrayBuffer()
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)))
      const r = await startExcelImport({
        caseId, templateKind: kind, filename: file.name, base64,
      })
      setImportResult(r)
      if (!r.ok) {
        toast({ title: 'Validation failed', description: r.errors[0] ?? 'unknown', variant: 'destructive' })
      } else {
        toast({ title: 'Ready to review',
          description: `${r.diff!.inserts} inserts, ${r.diff!.updates} updates, ${r.diff!.protected} protected` })
      }
      reload()
    } catch (e: any) { toast({ title: 'Import failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
  }

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary flex items-center gap-2">
            <Download className="h-4 w-4" /> Spreadsheet Exports
          </CardTitle>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={reload}>
            {busy ? <Loader2 className="animate-spin h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-[11px] text-muted-foreground">
            Every export is a stable, versioned template with a hidden metadata sheet so it can be re-imported without shape-guessing.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(TEMPLATE_LABELS).map(([kind, label]) => (
              <Button key={kind} size="sm" variant="outline" onClick={() => onExport(kind)}>
                <Download className="h-3 w-3 mr-1" /> {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary flex items-center gap-2">
            <Upload className="h-4 w-4" /> Spreadsheet Import
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-[11px] text-muted-foreground">
            Upload a ValuVault-exported workbook to review the proposed diff before applying. Verified or locked rows are protected from silent overwrite.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(TEMPLATE_LABELS).map(([kind, label]) => (
              <label key={kind} className="border rounded-md p-3 flex flex-col items-center justify-center text-xs cursor-pointer hover:bg-slate-50">
                <Upload className="h-4 w-4 mb-1" />
                {label}
                <input
                  type="file" accept=".xlsx" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) onImport(kind, f) }}
                />
              </label>
            ))}
          </div>
          {importResult && importResult.ok && (
            <div className="border rounded-md p-3 bg-slate-50 space-y-2">
              <div className="text-xs">
                Ready to review:
                <span className="ml-2 font-mono">{importResult.diff.inserts} insert(s)</span>,
                <span className="ml-2 font-mono">{importResult.diff.updates} update(s)</span>,
                <span className="ml-2 font-mono">{importResult.diff.unchanged} unchanged</span>,
                <span className="ml-2 font-mono text-amber-800">{importResult.diff.protected} protected</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm"
                  onClick={async () => {
                    try {
                      const r = await applyExcelImport({ runId: importResult.runId })
                      toast({ title: `${r.applied} rows applied`, description: `${r.protectedSkipped} protected rows skipped` })
                      setImportResult(null); reload()
                    } catch (e: any) { toast({ title: 'Apply failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
                  }}>
                  Apply
                </Button>
                <Button size="sm" variant="outline"
                  onClick={async () => { await rejectExcelImport({ runId: importResult.runId }); setImportResult(null); reload() }}>
                  Reject
                </Button>
              </div>
              {importResult.diff.protected > 0 && (
                <div className="text-[11px] text-amber-800 flex items-center gap-2">
                  <ShieldAlert className="h-3 w-3" />
                  {importResult.diff.protected} row(s) are verified/locked in ValuVault and will be skipped unless explicitly overridden.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary flex items-center gap-2">
            <Cable className="h-4 w-4" /> Accounting Connectors
          </CardTitle>
          <Button size="sm" asChild>
            <Link href={`/api/connect/quickbooks?caseId=${caseId}`}>
              <Plug className="h-3 w-3 mr-1" /> Connect QuickBooks
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-[11px] text-muted-foreground">
            Every value promoted from a connector keeps its origin badge. QuickBooks / Xero / Sage / NetSuite values are never silently mixed with AI-extracted values.
          </div>
          {connectors.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">No connectors attached.</div>
          ) : (
            <div className="divide-y">
              {connectors.map(c => (
                <div key={c.id} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm">{c.provider} <span className="text-muted-foreground">— {c.providerAccountLabel ?? c.providerAccountId}</span></div>
                    <div className="text-[10px] text-muted-foreground">Connected {c.connectedAt.toISOString().slice(0, 10)} • {c.status}</div>
                  </div>
                  <div className="flex gap-2">
                    {c.status === 'CONNECTED' && ['P_AND_L', 'BALANCE_SHEET', 'TRIAL_BALANCE'].map(kind => (
                      <Button key={kind} size="sm" variant="outline"
                        onClick={async () => {
                          try {
                            const r = await ingestConnectorReport({ connectorId: c.id, reportKind: kind })
                            toast({ title: `Ingested ${r.rows} rows` })
                            reload()
                          } catch (e: any) { toast({ title: 'Ingest failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
                        }}>
                        {kind.replace(/_/g, ' ')}
                      </Button>
                    ))}
                    {c.status === 'CONNECTED' && (
                      <Button size="sm" variant="ghost"
                        onClick={async () => {
                          await disconnectAccountingConnector({ connectorId: c.id })
                          reload()
                        }}>
                        Disconnect
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">
            Source Rows (Pending Promotion)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sourceRows.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">No source rows.</div>
          ) : (
            <div className="divide-y max-h-96 overflow-y-auto">
              {sourceRows.filter((r: any) => r.status === 'PENDING_PROMOTION').slice(0, 100).map((r: any) => (
                <SourceRowPromoteRow key={r.id} row={r} caseId={caseId} onPromoted={reload} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {runs.length > 0 && (
        <Card className="border-none shadow-sm bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">
              Ingestion History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {runs.map(r => (
                <div key={r.runId} className="py-2 flex items-center justify-between text-xs">
                  <div>{r.provider} — {r.reportType} {r.periodLabel && <span className="text-muted-foreground">({r.periodLabel})</span>}</div>
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] text-muted-foreground">{r.rowsIngested} rows</span>
                    <Badge variant="outline">{r.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SourceRowPromoteRow({ row, caseId, onPromoted }: {
  row: any; caseId: string; onPromoted: () => void
}) {
  const [year,  setYear]  = React.useState('')
  const [stype, setStype] = React.useState('IS')
  const [line,  setLine]  = React.useState(row.accountName)
  const { toast } = useToast()
  return (
    <div className="py-2 flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{row.accountName}</div>
        <div className="text-[10px] text-muted-foreground">
          <Badge variant="outline" className="text-[9px] mr-1">{row.provider}</Badge>
          {row.reportType} • {row.period} • {row.amount}
        </div>
      </div>
      <Input value={year} onChange={e => setYear(e.target.value)} placeholder="Year" className="w-16 h-7 text-xs" />
      <Select value={stype} onValueChange={setStype}>
        <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="IS">IS</SelectItem>
          <SelectItem value="BS">BS</SelectItem>
          <SelectItem value="CF">CF</SelectItem>
          <SelectItem value="TB">TB</SelectItem>
        </SelectContent>
      </Select>
      <Input value={line} onChange={e => setLine(e.target.value)} placeholder="Line Item" className="w-40 h-7 text-xs" />
      <Button size="sm"
        onClick={async () => {
          try {
            await promoteSourceRow({ sourceRowId: row.id, year, statementType: stype, lineItem: line })
            toast({ title: 'Promoted' })
            onPromoted()
          } catch (e: any) { toast({ title: 'Promote failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
        }}>Promote</Button>
    </div>
  )
}

function downloadBase64(name: string, b64: string, mime: string) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
