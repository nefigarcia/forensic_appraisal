'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  AlertTriangle, CheckCircle2, HelpCircle, Play, Loader2, RefreshCw,
  RotateCcw, ExternalLink, FileText, Scale,
} from 'lucide-react'
import { formatMoney } from '@/lib/money'
import {
  getTieOutsForCase,
  runTieOutsForCase,
  resolveTieOut,
  reopenTieOut,
} from '@/app/actions/tie-outs'
import { getVersionDownloadUrl } from '@/app/actions/document-versions'
import { useToast } from '@/hooks/use-toast'

interface TieOutItemRow {
  id: string
  sourceLabel: string
  value: string
  documentVersionId: string | null
  financialValueId: string | null
  documentName: string | null
  versionNumber: number | null
}

interface TieOutRow {
  id: string
  concept: string
  conceptLabel: string
  year: string
  status: 'TIED' | 'WITHIN_TOLERANCE' | 'DISCREPANCY' | 'UNRESOLVED' | 'RESOLVED'
  maxDifference: string | null
  toleranceAbsolute: string | null
  tolerancePercent: string | null
  resolvedBy: string | null
  resolvedAt: string | Date | null
  resolutionNote: string | null
  updatedAt: string | Date
  items: TieOutItemRow[]
}

const STATUS_META: Record<TieOutRow['status'], { label: string; cls: string; icon: React.ReactNode }> = {
  DISCREPANCY:      { label: 'Discrepancy',      cls: 'bg-red-100 text-red-800',       icon: <AlertTriangle className="h-3 w-3 mr-1" /> },
  UNRESOLVED:       { label: 'Unresolved',       cls: 'bg-amber-100 text-amber-800',   icon: <HelpCircle className="h-3 w-3 mr-1" /> },
  RESOLVED:         { label: 'Resolved',         cls: 'bg-slate-100 text-slate-700',   icon: <CheckCircle2 className="h-3 w-3 mr-1" /> },
  WITHIN_TOLERANCE: { label: 'Within tolerance', cls: 'bg-emerald-100 text-emerald-800',icon: <Scale className="h-3 w-3 mr-1" /> },
  TIED:             { label: 'Tied',             cls: 'bg-green-100 text-green-800',   icon: <CheckCircle2 className="h-3 w-3 mr-1" /> },
}

/**
 * Tie-out dashboard for a case. Discrepancies are always at the top;
 * the sort order is enforced by the server action so nothing about the
 * client can accidentally hide a material issue.
 */
export function TieOutDashboard({ caseId }: { caseId: string }) {
  const [rows, setRows]           = React.useState<TieOutRow[] | null>(null)
  const [loading, setLoading]     = React.useState(false)
  const [building, setBuilding]   = React.useState(false)
  const { toast } = useToast()

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await getTieOutsForCase(caseId)
      setRows(data as any)
    } catch (e: any) {
      toast({ title: 'Could not load tie-outs', description: e?.message ?? 'unknown', variant: 'destructive' })
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [caseId, toast])

  React.useEffect(() => { load() }, [load])

  async function build() {
    setBuilding(true)
    try {
      const res = await runTieOutsForCase(caseId)
      toast({ title: `Built ${res.built} tie-out${res.built === 1 ? '' : 's'}` })
      await load()
    } catch (e: any) {
      toast({ title: 'Build failed', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally {
      setBuilding(false)
    }
  }

  const discrepancyCount = (rows ?? []).filter(r => r.status === 'DISCREPANCY').length
  const unresolvedCount  = (rows ?? []).filter(r => r.status === 'UNRESOLVED').length

  return (
    <Card className="border-none shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">
            Financial Tie-Outs
          </CardTitle>
          {rows && rows.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {discrepancyCount > 0 && (
                <span className="text-red-700 font-bold">
                  {discrepancyCount} discrepanc{discrepancyCount === 1 ? 'y' : 'ies'} · {' '}
                </span>
              )}
              {unresolvedCount > 0 && `${unresolvedCount} unresolved · `}
              {rows.length} total
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={load} title="Reload">
            {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button size="sm" onClick={build} disabled={building} className="uppercase tracking-widest text-xs font-bold">
            {building ? <Loader2 className="animate-spin h-3.5 w-3.5 mr-2" /> : <Play className="h-3.5 w-3.5 mr-2" />}
            {building ? 'Building…' : 'Run tie-out'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin h-5 w-5 text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            No tie-outs yet. Click <b>Run tie-out</b> to classify each extracted value and compare across sources.
          </div>
        ) : (
          <div className="divide-y">
            {rows.map(r => <TieOutRowCard key={r.id} row={r} onChanged={load} />)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TieOutRowCard({ row, onChanged }: { row: TieOutRow; onChanged: () => Promise<void> | void }) {
  const meta = STATUS_META[row.status]
  const [note, setNote]       = React.useState('')
  const [busy, setBusy]       = React.useState(false)
  const { toast } = useToast()

  async function submitResolve() {
    if (!note.trim()) return
    setBusy(true)
    try {
      await resolveTieOut(row.id, note.trim())
      toast({ title: 'Tie-out resolved' })
      setNote('')
      await onChanged()
    } catch (e: any) {
      toast({ title: 'Could not resolve', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function reopen() {
    setBusy(true)
    try {
      await reopenTieOut(row.id)
      toast({ title: 'Tie-out reopened' })
      await onChanged()
    } catch (e: any) {
      toast({ title: 'Could not reopen', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function drill(versionId: string | null) {
    if (!versionId) return
    try {
      const { url } = await getVersionDownloadUrl(versionId)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e: any) {
      toast({ title: 'Source unavailable', description: e?.message ?? 'unknown', variant: 'destructive' })
    }
  }

  return (
    <div className="py-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Badge className={`uppercase font-bold tracking-widest text-[9px] ${meta.cls} hover:${meta.cls}`}>
          {meta.icon}{meta.label}
        </Badge>
        <span className="font-bold text-primary">{row.conceptLabel}</span>
        <span className="text-xs text-muted-foreground">FY {row.year}</span>
        {row.maxDifference && (
          <span className="text-xs text-muted-foreground ml-auto">
            Max Δ {formatMoney(row.maxDifference)}
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
        {row.items.map((it) => (
          <div key={it.id} className="border rounded-md px-3 py-2 flex items-center justify-between bg-slate-50/60">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-widest font-bold text-muted-foreground">
                {it.sourceLabel}
              </div>
              <div className="font-mono font-bold text-primary">{formatMoney(it.value)}</div>
              {it.documentName && (
                <div className="text-[10px] text-muted-foreground truncate">
                  <FileText className="inline h-3 w-3 mr-1" />
                  {it.documentName}{it.versionNumber != null ? ` · v${it.versionNumber}` : ''}
                </div>
              )}
            </div>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              disabled={!it.documentVersionId}
              onClick={() => drill(it.documentVersionId)}
              title={it.documentVersionId ? 'Open source' : 'No linked source'}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {row.status === 'DISCREPANCY' && (
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="mt-3 uppercase tracking-widest text-xs font-bold">
              Resolve with explanation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Resolve tie-out</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              Resolving does <b>not</b> hide the discrepancy — the row stays visible with your note attached, and any future rebuild will
              re-evaluate the values automatically.
            </p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. $2 timing difference between GL and P&L close; immaterial for valuation."
              className="min-h-[100px]"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" onClick={submitResolve} disabled={busy || !note.trim()}>
                {busy && <Loader2 className="animate-spin h-3.5 w-3.5 mr-2" />}
                Save resolution
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {row.status === 'RESOLVED' && (
        <div className="mt-3 flex items-start justify-between gap-2 border-l-2 border-slate-300 pl-3">
          <div className="text-xs text-muted-foreground italic min-w-0">
            <div className="uppercase tracking-widest text-[10px] font-bold not-italic mb-0.5">Resolution note</div>
            <div className="whitespace-pre-wrap">{row.resolutionNote}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={reopen} disabled={busy} className="shrink-0">
            <RotateCcw className="h-3.5 w-3.5 mr-2" />
            Reopen
          </Button>
        </div>
      )}
    </div>
  )
}
