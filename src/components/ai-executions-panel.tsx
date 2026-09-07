'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { RefreshCw, Loader2, ChevronRight, ShieldCheck, ShieldAlert } from 'lucide-react'
import { getRecentAiExecutions, getAiExecutionDetail } from '@/app/actions/ai-executions'

interface ListRow {
  id: string
  flowName: string
  flowVersion: string | null
  modelName: string
  status: string
  startedAt: string | Date
  completedAt: string | Date | null
  durationMs: number | null
  errorCategory: string | null
  reviewStatus: string
  userEmail: string | null
  caseName: string | null
  documentVersionCount: number
}

interface DetailRow extends ListRow {
  promptTemplateKey: string | null
  modelProvider: string
  modelVersion: string | null
  inputHash: string
  outputHash: string | null
  documentVersionIds: string[]
  errorMessage: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  estimatedCostUsd: string | null
  financialValueSummary: {
    total: number; pending: number; accepted: number; overridden: number; rejected: number
  }
}

/**
 * ADMIN-only diagnostics panel. Lists recent AI executions for the
 * caller's org, with a detail dialog per row. All access is verified
 * server-side; if the caller lacks team:manage the actions throw and
 * we surface the message.
 */
export function AiExecutionsPanel() {
  const [rows, setRows]         = React.useState<ListRow[] | null>(null)
  const [error, setError]       = React.useState<string | null>(null)
  const [loading, setLoading]   = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const data = await getRecentAiExecutions({ limit: 100 })
      setRows(data as any)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load executions')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  return (
    <Card className="border-none shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">
          AI Execution Registry
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load} title="Reload">
          {loading ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-3">
            {error}
          </div>
        )}
        {rows === null || rows.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">
            {loading ? 'Loading…' : (rows?.length === 0 && !error ? 'No AI executions recorded yet.' : null)}
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((r) => <ExecutionRow key={r.id} row={r} />)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ExecutionRow({ row }: { row: ListRow }) {
  const [open, setOpen]     = React.useState(false)
  const [detail, setDetail] = React.useState<DetailRow | null>(null)
  const [detailErr, setErr] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const d = await getAiExecutionDetail(row.id)
        setDetail(d as any)
      } catch (e: any) {
        setErr(e?.message ?? 'Could not load detail')
      }
    })()
  }, [open, row.id])

  const statusBadge =
    row.status === 'SUCCESS' ? { cls: 'bg-green-100 text-green-800',   icon: <ShieldCheck className="h-3 w-3 mr-1" /> } :
    row.status === 'FAILURE' ? { cls: 'bg-red-100 text-red-800',       icon: <ShieldAlert className="h-3 w-3 mr-1" /> } :
                               { cls: 'bg-yellow-100 text-yellow-800', icon: <Loader2 className="animate-spin h-3 w-3 mr-1" /> }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <div className="flex items-center justify-between gap-3 py-2 cursor-pointer hover:bg-muted/40 -mx-4 px-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge className={`uppercase font-bold tracking-widest text-[9px] ${statusBadge.cls} hover:${statusBadge.cls}`}>
                {statusBadge.icon}{row.status}
              </Badge>
              <span className="font-mono text-xs font-bold">{row.flowName}</span>
              {row.flowVersion && (
                <Badge variant="outline" className="uppercase font-bold tracking-widest text-[9px]">
                  {row.flowVersion}
                </Badge>
              )}
              {row.errorCategory && (
                <Badge className="uppercase font-bold tracking-widest text-[9px] bg-red-100 text-red-800 hover:bg-red-100">
                  {row.errorCategory}
                </Badge>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {row.caseName ? `Case ${row.caseName} · ` : ''}
              by {row.userEmail ?? 'unknown'} · {new Date(row.startedAt).toLocaleString()}
              {row.durationMs != null ? ` · ${row.durationMs} ms` : ''}
              {row.documentVersionCount > 0 ? ` · ${row.documentVersionCount} source version${row.documentVersionCount === 1 ? '' : 's'}` : ''}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-headline">AI Execution</DialogTitle>
        </DialogHeader>
        {detailErr && <div className="text-sm text-red-700 py-2">{detailErr}</div>}
        {!detail ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin h-5 w-5 text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3 text-xs font-mono">
            <Field k="id"                v={detail.id} />
            <Field k="flow"              v={`${detail.flowName} · ${detail.flowVersion ?? '?'} · promptKey=${detail.promptTemplateKey ?? '?'}`} />
            <Field k="model"             v={`${detail.modelProvider} · ${detail.modelName}${detail.modelVersion ? ' · ' + detail.modelVersion : ''}`} />
            <Field k="status"            v={`${detail.status}${detail.errorCategory ? ' · ' + detail.errorCategory : ''}`} />
            {detail.errorMessage && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">error</div>
                <div className="whitespace-pre-wrap break-words">{detail.errorMessage}</div>
              </div>
            )}
            <Field k="inputHash"         v={detail.inputHash} mono />
            <Field k="outputHash"        v={detail.outputHash ?? '—'} mono />
            <Field k="documentVersions"  v={detail.documentVersionIds.join(', ') || '(none)'} />
            <Field k="user"              v={detail.userEmail ?? 'unknown'} />
            <Field k="caseId"            v={detail.caseName ?? '(no case scope)'} />
            <Field k="startedAt"         v={new Date(detail.startedAt).toISOString()} />
            <Field k="completedAt"       v={detail.completedAt ? new Date(detail.completedAt).toISOString() : '—'} />
            <Field k="durationMs"        v={detail.durationMs?.toString() ?? '—'} />
            <Field k="reviewStatus"      v={detail.reviewStatus} />
            <div className="pt-2 border-t">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">FinancialValues produced</div>
              <div className="grid grid-cols-5 gap-2 text-center">
                <SummaryTile label="Total"      n={detail.financialValueSummary.total} />
                <SummaryTile label="Pending"    n={detail.financialValueSummary.pending} />
                <SummaryTile label="Accepted"   n={detail.financialValueSummary.accepted} />
                <SummaryTile label="Overridden" n={detail.financialValueSummary.overridden} />
                <SummaryTile label="Rejected"   n={detail.financialValueSummary.rejected} />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className={mono ? 'break-all' : ''}>{v}</div>
    </div>
  )
}

function SummaryTile({ label, n }: { label: string; n: number }) {
  return (
    <div className="border rounded-md p-2">
      <div className="text-base font-bold">{n}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  )
}
