'use client'

import * as React from 'react'
import { getAddBacks, createAddBack, updateAddBack, deleteAddBack, approveAddBack } from '@/app/actions/addback-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/hooks/use-toast'
import { Loader2, Plus, Trash2, CheckCircle2, Bot, Pencil, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const CATEGORIES = ['Owner Compensation', 'Related Party Rent', 'One-Time Expense', 'Depreciation', 'Amortization', 'Consulting Fee', 'Non-Recurring Item', 'Other']

interface AddBackScheduleProps {
  caseId: string
}

type AddBack = Awaited<ReturnType<typeof getAddBacks>>[number]

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function parseDollar(s: string): number | null {
  const v = parseFloat(s.replace(/[^0-9.-]/g, ''))
  return isNaN(v) ? null : v
}

interface EditRow {
  category: string
  description: string
  year2: string
  year1: string
  ttm: string
  rationale: string
}

export function AddBackSchedule({ caseId }: AddBackScheduleProps) {
  const [rows, setRows] = React.useState<AddBack[]>([])
  const [loading, setLoading] = React.useState(true)
  const [adding, setAdding] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editState, setEditState] = React.useState<EditRow>({ category: '', description: '', year2: '', year1: '', ttm: '', rationale: '' })
  const [newRow, setNewRow] = React.useState<EditRow>({ category: CATEGORIES[0], description: '', year2: '', year1: '', ttm: '', rationale: '' })

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setRows(await getAddBacks(caseId))
    } finally {
      setLoading(false)
    }
  }, [caseId])

  React.useEffect(() => { load() }, [load])

  const years = React.useMemo(() => {
    const allYears = rows.flatMap(r => [r.year2 != null ? 'Year-2' : null, r.year1 != null ? 'Year-1' : null, r.ttm != null ? 'TTM' : null].filter(Boolean) as string[])
    const has = (s: string) => rows.some(r => r[s === 'Year-2' ? 'year2' : s === 'Year-1' ? 'year1' : 'ttm'] != null)
    const cols: string[] = []
    if (has('Year-2')) cols.push('Year-2')
    if (has('Year-1')) cols.push('Year-1')
    cols.push('TTM')
    return cols
  }, [rows])

  const total = React.useMemo(() => ({
    year2: rows.reduce((s, r) => s + (r.year2 ?? 0), 0),
    year1: rows.reduce((s, r) => s + (r.year1 ?? 0), 0),
    ttm:   rows.reduce((s, r) => s + (r.ttm   ?? 0), 0),
  }), [rows])

  async function handleAdd() {
    if (!newRow.description.trim()) { toast({ title: 'Description required', variant: 'destructive' }); return }
    setAdding(true)
    try {
      await createAddBack(caseId, {
        category:    newRow.category,
        description: newRow.description,
        year2:       parseDollar(newRow.year2),
        year1:       parseDollar(newRow.year1),
        ttm:         parseDollar(newRow.ttm),
        rationale:   newRow.rationale,
      })
      setNewRow({ category: CATEGORIES[0], description: '', year2: '', year1: '', ttm: '', rationale: '' })
      await load()
      toast({ title: 'Add-back created' })
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    } finally {
      setAdding(false)
    }
  }

  function startEdit(row: AddBack) {
    setEditingId(row.id)
    setEditState({
      category:    row.category,
      description: row.description,
      year2:       row.year2  != null ? String(row.year2)  : '',
      year1:       row.year1  != null ? String(row.year1)  : '',
      ttm:         row.ttm    != null ? String(row.ttm)    : '',
      rationale:   row.rationale ?? '',
    })
  }

  async function saveEdit(id: string) {
    try {
      await updateAddBack(id, {
        category:    editState.category,
        description: editState.description,
        year2:       parseDollar(editState.year2),
        year1:       parseDollar(editState.year1),
        ttm:         parseDollar(editState.ttm),
        rationale:   editState.rationale,
      })
      setEditingId(null)
      await load()
      toast({ title: 'Add-back updated' })
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteAddBack(id)
      await load()
      toast({ title: 'Add-back deleted' })
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    }
  }

  async function handleApprove(id: string) {
    try {
      await approveAddBack(id)
      await load()
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-36">Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right w-28">Year-2</TableHead>
              <TableHead className="text-right w-28">Year-1</TableHead>
              <TableHead className="text-right w-28">TTM</TableHead>
              <TableHead className="w-24 text-center">Status</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No add-backs yet. Add one below.
                </TableCell>
              </TableRow>
            )}
            {rows.map(row => (
              <TableRow key={row.id} className={cn(row.isApproved && 'bg-emerald-50/40')}>
                {editingId === row.id ? (
                  <>
                    <TableCell>
                      <Select value={editState.category} onValueChange={v => setEditState(s => ({ ...s, category: v }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input className="h-8 text-xs" value={editState.description} onChange={e => setEditState(s => ({ ...s, description: e.target.value }))} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8 text-xs font-mono text-right" value={editState.year2} onChange={e => setEditState(s => ({ ...s, year2: e.target.value }))} placeholder="0" />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8 text-xs font-mono text-right" value={editState.year1} onChange={e => setEditState(s => ({ ...s, year1: e.target.value }))} placeholder="0" />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8 text-xs font-mono text-right" value={editState.ttm} onChange={e => setEditState(s => ({ ...s, ttm: e.target.value }))} placeholder="0" />
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveEdit(row.id)}><Check className="h-3.5 w-3.5 text-emerald-600" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}><X className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell>
                      <span className="text-xs font-medium text-muted-foreground">{row.category}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start gap-1.5">
                        <span className="text-sm">{row.description}</span>
                        {row.aiSuggested && (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger>
                                <Bot className="h-3.5 w-3.5 text-violet-500 mt-0.5 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">
                                AI suggested · confidence {Math.round((row.confidence ?? 0) * 100)}%
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                      {row.rationale && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{row.rationale}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(row.year2)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(row.year1)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(row.ttm)}</TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn('h-7 text-xs px-2', row.isApproved && 'text-emerald-700')}
                        onClick={() => handleApprove(row.id)}
                      >
                        {row.isApproved
                          ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approved</>
                          : 'Approve'}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(row)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(row.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))}

            {/* Totals row */}
            {rows.length > 0 && (
              <TableRow className="border-t-2 bg-muted/30 font-semibold">
                <TableCell />
                <TableCell className="text-sm">Total Normalizations</TableCell>
                <TableCell className="text-right font-mono text-sm">${fmt(total.year2)}</TableCell>
                <TableCell className="text-right font-mono text-sm">${fmt(total.year1)}</TableCell>
                <TableCell className="text-right font-mono text-sm">${fmt(total.ttm)}</TableCell>
                <TableCell /><TableCell />
              </TableRow>
            )}

            {/* Add new row */}
            <TableRow className="bg-blue-50/30">
              <TableCell>
                <Select value={newRow.category} onValueChange={v => setNewRow(s => ({ ...s, category: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input
                  className="h-8 text-xs"
                  placeholder="Description…"
                  value={newRow.description}
                  onChange={e => setNewRow(s => ({ ...s, description: e.target.value }))}
                />
              </TableCell>
              <TableCell>
                <Input className="h-8 text-xs font-mono text-right" placeholder="0" value={newRow.year2} onChange={e => setNewRow(s => ({ ...s, year2: e.target.value }))} />
              </TableCell>
              <TableCell>
                <Input className="h-8 text-xs font-mono text-right" placeholder="0" value={newRow.year1} onChange={e => setNewRow(s => ({ ...s, year1: e.target.value }))} />
              </TableCell>
              <TableCell>
                <Input className="h-8 text-xs font-mono text-right" placeholder="0" value={newRow.ttm} onChange={e => setNewRow(s => ({ ...s, ttm: e.target.value }))} />
              </TableCell>
              <TableCell />
              <TableCell className="text-right">
                <Button size="sm" className="h-8 text-xs" onClick={handleAdd} disabled={adding}>
                  {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Plus className="h-3.5 w-3.5 mr-1" />Add</>}
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
