'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Plus, Loader2, RefreshCw, Pencil, Trash2, Send, CheckCircle2,
  XCircle, MessageSquareWarning, RotateCcw, AlertCircle, Info, TriangleAlert,
} from 'lucide-react'
import {
  getWorkbenchForCase,
  createAdjustment,
  updateAdjustment,
  changeAdjustmentStatus,
  deleteAdjustment,
} from '@/app/actions/normalization'
import { SUGGESTED_CATEGORIES, categoryLabel } from '@/lib/normalization/categories'
import {
  ADJUSTMENT_STATUSES,
  STATUS_LABEL,
  ALLOWED_TRANSITIONS,
  type AdjustmentStatus,
} from '@/lib/normalization/statuses'
import { formatMoney } from '@/lib/money'
import { useToast } from '@/hooks/use-toast'

// Shapes duplicated locally rather than importing across the client/server
// boundary — matches how CitationIndicator, TieOutDashboard etc. do it.
interface Adjustment {
  id: string
  category: string
  description: string
  status: AdjustmentStatus
  direction: 'ADD' | 'SUBTRACT'
  recurring: string
  taxTreatment: string | null
  rationale: string | null
  amounts: { year2: string | null; year1: string | null; ttm: string | null }
  proposedBy: string | null
  reviewedBy: string | null
  reviewedAt: string | Date | null
  statusChangedAt: string | Date | null
  rejectionReason: string | null
  citationCount: number
  warnings: { code: string; message: string; severity: 'INFO' | 'WARN' | 'ERROR' }[]
  createdAt: string | Date
  updatedAt: string | Date
}

interface Workbench {
  adjustments: Adjustment[]
  reportedByPeriod: { year2: string; year1: string; ttm: string }
  bridge: {
    perPeriod: Record<'year2' | 'year1' | 'ttm', {
      reported: string; netAdjustment: string; normalized: string; appliedAdjustments: number
    }>
    totalReported: string
    totalNormalized: string
    approvedCount: number
    ignoredCount: number
  }
  reviewerQueueCount: number
}

const STATUS_CLS: Record<AdjustmentStatus, string> = {
  DRAFT:         'bg-slate-100 text-slate-700',
  PROPOSED:      'bg-blue-100 text-blue-800',
  NEEDS_SUPPORT: 'bg-amber-100 text-amber-800',
  APPROVED:      'bg-emerald-100 text-emerald-800',
  REJECTED:      'bg-red-100 text-red-800',
}

export function NormalizationWorkbench({ caseId }: { caseId: string }) {
  const [wb, setWb]           = React.useState<Workbench | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [err, setErr]         = React.useState<string | null>(null)
  const { toast } = useToast()

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const data = await getWorkbenchForCase(caseId)
      setWb(data as any)
    } catch (e: any) {
      setErr(e?.message ?? 'Unknown error')
      setWb(null)
    } finally {
      setLoading(false)
    }
  }, [caseId])

  React.useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <BridgeCard wb={wb} loading={loading} err={err} onReload={load} caseId={caseId} onCreated={load} />
      <AdjustmentsList wb={wb} loading={loading} onChanged={load} />
    </div>
  )
}

// ─────────────────────────────────────────────────
// Bridge card (top): Reported → Normalized per period
// ─────────────────────────────────────────────────

function BridgeCard({
  wb, loading, err, onReload, caseId, onCreated,
}: {
  wb: Workbench | null
  loading: boolean
  err: string | null
  onReload: () => Promise<void> | void
  caseId: string
  onCreated: () => Promise<void> | void
}) {
  return (
    <Card className="border-none shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">
            Reported → Normalized EBITDA
          </CardTitle>
          {wb && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {wb.bridge.approvedCount} approved · {wb.bridge.ignoredCount} pending or draft ·
              {' '}{wb.reviewerQueueCount > 0 ? `${wb.reviewerQueueCount} awaiting review` : 'nothing awaiting review'}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onReload}>
            {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <NewAdjustmentDialog caseId={caseId} onCreated={onCreated} />
        </div>
      </CardHeader>
      <CardContent>
        {err && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-3">
            {err}
          </div>
        )}
        {!wb ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin h-5 w-5 text-muted-foreground" /></div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {(['year2', 'year1', 'ttm'] as const).map((p) => (
              <div key={p} className="border rounded-md p-3 bg-slate-50/60">
                <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                  {p === 'ttm' ? 'TTM' : p === 'year1' ? 'Last Full Year' : '2 Years Ago'}
                </div>
                <div className="mt-2 space-y-1">
                  <BridgeRow label="Reported"       value={wb.bridge.perPeriod[p].reported} />
                  <BridgeRow label="Adjustments"    value={wb.bridge.perPeriod[p].netAdjustment} accent />
                  <BridgeRow label="Normalized"     value={wb.bridge.perPeriod[p].normalized} bold />
                </div>
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground mt-2">
                  {wb.bridge.perPeriod[p].appliedAdjustments} adjustment{wb.bridge.perPeriod[p].appliedAdjustments === 1 ? '' : 's'} applied
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BridgeRow({ label, value, accent, bold }: { label: string; value: string; accent?: boolean; bold?: boolean }) {
  const negativeCls =
    value.startsWith('-') ? 'text-red-700' :
    accent               ? 'text-blue-700' : ''
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${negativeCls} ${bold ? 'font-bold text-primary' : ''}`}>{formatMoney(value)}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────
// Adjustments list (below): each adjustment row
// ─────────────────────────────────────────────────

function AdjustmentsList({
  wb, loading, onChanged,
}: {
  wb: Workbench | null
  loading: boolean
  onChanged: () => Promise<void> | void
}) {
  return (
    <Card className="border-none shadow-sm bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">
          Adjustments
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!wb ? (
          loading ? (
            <div className="flex justify-center py-6"><Loader2 className="animate-spin h-5 w-5 text-muted-foreground" /></div>
          ) : null
        ) : wb.adjustments.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            No adjustments yet. Click <b>New adjustment</b> to draft one.
          </div>
        ) : (
          <div className="divide-y">
            {wb.adjustments.map(a => <AdjustmentRow key={a.id} adjustment={a} onChanged={onChanged} />)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AdjustmentRow({ adjustment: a, onChanged }: { adjustment: Adjustment; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = React.useState<null | string>(null)
  const { toast } = useToast()

  async function transition(next: AdjustmentStatus, reason?: string) {
    setBusy(next)
    try {
      await changeAdjustmentStatus(a.id, next, reason)
      toast({ title: `Marked ${STATUS_LABEL[next]}` })
      await onChanged()
    } catch (e: any) {
      toast({ title: 'Transition failed', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function remove() {
    if (!confirm('Delete this DRAFT adjustment? This cannot be undone.')) return
    setBusy('delete')
    try {
      await deleteAdjustment(a.id)
      toast({ title: 'Adjustment deleted' })
      await onChanged()
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally { setBusy(null) }
  }

  const allowed = ALLOWED_TRANSITIONS[a.status]
  const errorWarnings = a.warnings.filter(w => w.severity === 'ERROR')
  const warnWarnings  = a.warnings.filter(w => w.severity === 'WARN')

  return (
    <div className="py-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={`uppercase font-bold tracking-widest text-[9px] ${STATUS_CLS[a.status]} hover:${STATUS_CLS[a.status]}`}>
          {STATUS_LABEL[a.status]}
        </Badge>
        <Badge variant="outline" className="uppercase font-bold tracking-widest text-[9px]">
          {a.direction === 'SUBTRACT' ? 'Subtract' : 'Add-back'}
        </Badge>
        <Badge variant="outline" className="uppercase font-bold tracking-widest text-[9px]">
          {a.recurring}
        </Badge>
        <span className="text-xs font-bold text-primary">{categoryLabel(a.category)}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {a.citationCount} citation{a.citationCount === 1 ? '' : 's'}
        </span>
      </div>
      <div className="text-sm mt-1">{a.description}</div>

      <div className="grid grid-cols-3 gap-3 mt-2">
        <AmountCell label="2 yrs ago" value={a.amounts.year2} />
        <AmountCell label="Last FY"   value={a.amounts.year1} />
        <AmountCell label="TTM"       value={a.amounts.ttm} />
      </div>

      {a.rationale && (
        <div className="text-[11px] text-muted-foreground italic mt-2 line-clamp-2">
          “{a.rationale}”
        </div>
      )}

      {(errorWarnings.length + warnWarnings.length > 0) && (
        <div className="mt-2 space-y-1">
          {errorWarnings.map(w => (
            <div key={w.code} className="flex items-center gap-1 text-[11px] text-red-700">
              <AlertCircle className="h-3 w-3" /> {w.message}
            </div>
          ))}
          {warnWarnings.map(w => (
            <div key={w.code} className="flex items-center gap-1 text-[11px] text-amber-700">
              <TriangleAlert className="h-3 w-3" /> {w.message}
            </div>
          ))}
        </div>
      )}

      {a.status === 'REJECTED' && a.rejectionReason && (
        <div className="mt-2 text-[11px] text-red-700">
          <span className="font-bold uppercase tracking-widest">Rejected:</span> {a.rejectionReason}
        </div>
      )}
      {a.status === 'NEEDS_SUPPORT' && a.rejectionReason && (
        <div className="mt-2 text-[11px] text-amber-800">
          <span className="font-bold uppercase tracking-widest">Reviewer note:</span> {a.rejectionReason}
        </div>
      )}

      <div className="mt-3 flex gap-1 flex-wrap">
        {allowed.includes('PROPOSED') && (
          <Button size="sm" variant="secondary" onClick={() => transition('PROPOSED')} disabled={!!busy}>
            <Send className="h-3 w-3 mr-1" /> Submit for review
          </Button>
        )}
        {allowed.includes('APPROVED') && (
          <Button size="sm" onClick={() => transition('APPROVED')} disabled={!!busy}>
            <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
          </Button>
        )}
        {allowed.includes('REJECTED') && (
          <RejectButton onSubmit={(r) => transition('REJECTED', r)} disabled={!!busy} />
        )}
        {allowed.includes('NEEDS_SUPPORT') && (
          <NeedsSupportButton onSubmit={(r) => transition('NEEDS_SUPPORT', r)} disabled={!!busy} />
        )}
        {allowed.includes('DRAFT') && (
          <Button size="sm" variant="outline" onClick={() => transition('DRAFT')} disabled={!!busy}>
            <RotateCcw className="h-3 w-3 mr-1" /> Reopen as DRAFT
          </Button>
        )}
        {(a.status === 'DRAFT' || a.status === 'REJECTED') && (
          <>
            <EditDialog adjustment={a} onSaved={onChanged} />
            <Button size="sm" variant="outline" onClick={remove} disabled={!!busy}>
              <Trash2 className="h-3 w-3 mr-1" /> Delete
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function AmountCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border rounded-md px-3 py-2 bg-slate-50/40">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-mono font-bold text-primary">{value != null ? formatMoney(value) : '—'}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────
// Dialogs
// ─────────────────────────────────────────────────

function NewAdjustmentDialog({ caseId, onCreated }: { caseId: string; onCreated: () => Promise<void> | void }) {
  const [open, setOpen]     = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-3.5 w-3.5 mr-1" /> New adjustment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New adjustment</DialogTitle>
        </DialogHeader>
        <AdjustmentForm
          mode="create"
          caseId={caseId}
          onDone={async () => {
            setOpen(false)
            await onCreated()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({ adjustment, onSaved }: { adjustment: Adjustment; onSaved: () => Promise<void> | void }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil className="h-3 w-3 mr-1" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit adjustment</DialogTitle>
        </DialogHeader>
        <AdjustmentForm
          mode="edit"
          adjustment={adjustment}
          onDone={async () => {
            setOpen(false)
            await onSaved()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function AdjustmentForm({
  mode, caseId, adjustment, onDone,
}: {
  mode: 'create' | 'edit'
  caseId?: string
  adjustment?: Adjustment
  onDone: () => Promise<void> | void
}) {
  const [category,    setCategory]    = React.useState(adjustment?.category    ?? 'OWNER_COMPENSATION')
  const [description, setDescription] = React.useState(adjustment?.description ?? '')
  const [direction,   setDirection]   = React.useState<'ADD' | 'SUBTRACT'>((adjustment?.direction as any) ?? 'ADD')
  const [recurring,   setRecurring]   = React.useState<string>(adjustment?.recurring ?? 'NONRECURRING')
  const [taxTreatment, setTax]        = React.useState<string>(adjustment?.taxTreatment ?? 'PRE_TAX')
  const [rationale,   setRationale]   = React.useState(adjustment?.rationale ?? '')
  const [year2,       setYear2]       = React.useState(adjustment?.amounts.year2 ?? '')
  const [year1,       setYear1]       = React.useState(adjustment?.amounts.year1 ?? '')
  const [ttm,         setTtm]         = React.useState(adjustment?.amounts.ttm   ?? '')
  const [busy,        setBusy]        = React.useState(false)
  const { toast } = useToast()

  async function submit() {
    setBusy(true)
    try {
      const amounts = {
        year2: year2 === '' ? null : year2,
        year1: year1 === '' ? null : year1,
        ttm:   ttm   === '' ? null : ttm,
      }
      const payload = {
        category, description, direction,
        recurring: recurring as any,
        taxTreatment: (taxTreatment || null) as any,
        rationale,
        amounts,
      }
      if (mode === 'create' && caseId) {
        await createAdjustment(caseId, payload as any)
        toast({ title: 'Adjustment created' })
      } else if (mode === 'edit' && adjustment) {
        await updateAdjustment(adjustment.id, payload as any)
        toast({ title: 'Adjustment updated' })
      }
      await onDone()
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        <Label className="text-[10px] uppercase tracking-widest font-bold">Category</Label>
        <Input
          list="norm-cat-suggestions"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="OWNER_COMPENSATION"
        />
        <datalist id="norm-cat-suggestions">
          {SUGGESTED_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
        </datalist>
        <p className="text-[10px] text-muted-foreground mt-1">Pick a suggestion or type a custom label.</p>
      </div>
      <div>
        <Label className="text-[10px] uppercase tracking-widest font-bold">Description</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Owner personal auto lease" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-[10px] uppercase tracking-widest font-bold">Direction</Label>
          <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ADD">Add-back (+)</SelectItem>
              <SelectItem value="SUBTRACT">Subtract (-)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-widest font-bold">Recurring</Label>
          <Select value={recurring} onValueChange={setRecurring}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="NONRECURRING">Nonrecurring</SelectItem>
              <SelectItem value="ONE_TIME">One-time</SelectItem>
              <SelectItem value="RECURRING">Recurring</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-[10px] uppercase tracking-widest font-bold">Tax treatment</Label>
        <Select value={taxTreatment} onValueChange={setTax}>
          <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="PRE_TAX">Pre-tax</SelectItem>
            <SelectItem value="AFTER_TAX">After-tax</SelectItem>
            <SelectItem value="NOT_APPLICABLE">Not applicable</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-[10px] uppercase tracking-widest font-bold">2 yrs ago</Label>
          <Input inputMode="decimal" value={year2} onChange={(e) => setYear2(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-widest font-bold">Last FY</Label>
          <Input inputMode="decimal" value={year1} onChange={(e) => setYear1(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-widest font-bold">TTM</Label>
          <Input inputMode="decimal" value={ttm} onChange={(e) => setTtm(e.target.value)} placeholder="0.00" />
        </div>
      </div>
      <div>
        <Label className="text-[10px] uppercase tracking-widest font-bold">Professional rationale</Label>
        <Textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Owner draws $X annually for personal auto lease; not required for continuing operations."
          className="min-h-[80px]"
        />
      </div>
      <div className="flex justify-end pt-2">
        <Button onClick={submit} disabled={busy || !description.trim() || !category.trim()}>
          {busy && <Loader2 className="animate-spin h-3.5 w-3.5 mr-2" />}
          Save as DRAFT
        </Button>
      </div>
    </div>
  )
}

function RejectButton({ onSubmit, disabled }: { onSubmit: (reason: string) => void | Promise<void>; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <XCircle className="h-3 w-3 mr-1" /> Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Reject adjustment</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Please state the reason. This is stored with the row and visible to the proposer.
        </p>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[100px]" />
        <div className="flex justify-end">
          <Button
            variant="destructive"
            disabled={!reason.trim()}
            onClick={async () => { await onSubmit(reason.trim()); setOpen(false); setReason('') }}
          >
            Reject
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NeedsSupportButton({ onSubmit, disabled }: { onSubmit: (reason: string) => void | Promise<void>; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <MessageSquareWarning className="h-3 w-3 mr-1" /> Needs support
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Request support</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Describe what evidence, rationale, or number the proposer needs to add before this can be approved.
        </p>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[100px]" />
        <div className="flex justify-end">
          <Button
            disabled={!reason.trim()}
            onClick={async () => { await onSubmit(reason.trim()); setOpen(false); setReason('') }}
          >
            Send back
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
