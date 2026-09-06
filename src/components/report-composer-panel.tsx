'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Loader2, RefreshCw, FileText, Sparkles, ShieldAlert, Download, Info, Plus,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  getReport, initializeReport, changeReportStatus,
  getReportChecklistItems, listSeedChecklists, attachSeedChecklist,
  updateChecklistItemStatus,
  type ReportForClient, type ReportChecklistItemForClient,
} from '@/app/actions/reports'
import {
  draftSectionWithAI, saveSectionEdit, changeSectionStatus,
} from '@/app/actions/report-sections'
import { freezeReportVersion, exportReportPlainText, exportReportDocx } from '@/app/actions/report-export'

/**
 * Report composer surface. Wires up section drafting, editing,
 * approval, checklist status, snapshot, and export. Deliberately
 * minimal — the load-bearing invariants (no self-approval, no stale
 * approval, no invented citations) are enforced server-side.
 */
export function ReportComposerPanel({ caseId }: { caseId: string }) {
  const [report,   setReport]   = React.useState<ReportForClient | null | undefined>(undefined) // undefined = not loaded yet
  const [checkls,  setCheckls]  = React.useState<ReportChecklistItemForClient[]>([])
  const [loading,  setLoading]  = React.useState(false)
  const [activeSectionId, setActiveSectionId] = React.useState<string | null>(null)
  const [editBody, setEditBody] = React.useState('')
  const [seeds,    setSeeds]    = React.useState<Array<{ key: string; name: string; itemCount: number; standardsFamily: string }>>([])
  const { toast } = useToast()

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const r = await getReport(caseId)
      setReport(r)
      if (r) {
        const cls = await getReportChecklistItems(r.id)
        setCheckls(cls)
        if (!activeSectionId && r.sections.length > 0) {
          setActiveSectionId(r.sections[0]!.id)
        }
      } else {
        setCheckls([])
      }
    } catch (e: any) {
      toast({ title: 'Could not load report', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally { setLoading(false) }
  }, [caseId, activeSectionId, toast])

  React.useEffect(() => { void reload() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [caseId])

  React.useEffect(() => { void listSeedChecklists().then(setSeeds).catch(() => setSeeds([])) }, [])

  if (report === undefined) {
    return <Card className="border-none shadow-sm bg-white"><CardContent className="py-8 text-center"><Loader2 className="animate-spin h-5 w-5 mx-auto text-muted-foreground" /></CardContent></Card>
  }

  if (report === null) {
    return (
      <Card className="border-none shadow-sm bg-white">
        <CardHeader><CardTitle>Report Composer</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            No report has been initialized for this case yet. Initialize to seed the standard sections and
            (optionally) attach a professional-standards checklist.
          </p>
          <Button onClick={async () => {
            try { await initializeReport({ caseId }); await reload() }
            catch (e: any) { toast({ title: 'Init failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
          }}>
            <Plus className="h-3 w-3 mr-1" /> Initialize Report
          </Button>
        </CardContent>
      </Card>
    )
  }

  const active = report.sections.find(s => s.id === activeSectionId) ?? null

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary flex items-center gap-2">
              <FileText className="h-4 w-4" /> Report Composer
            </CardTitle>
            <div className="text-[11px] text-muted-foreground mt-1">
              Report readiness: <b>{report.readiness.readinessPercent}%</b>
              {' — '}{report.readiness.requiredApproved} of {report.readiness.requiredTotal} required sections approved
              {report.readiness.requiredStale > 0 && (
                <span className="ml-2 text-amber-700">
                  ({report.readiness.requiredStale} stale)
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reload}>
              {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-[11px] p-2 border border-amber-200 bg-amber-50 rounded flex gap-2 items-start">
            <Info className="h-4 w-4 mt-0.5 text-amber-700 shrink-0" />
            <div className="text-amber-900">{report.disclaimer}</div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant="outline">status: {report.status}</Badge>
            {report.standardsFamily && <Badge variant="outline">standards: {report.standardsFamily}</Badge>}
            <Button size="sm" variant="outline"
              onClick={async () => {
                try {
                  const r = await freezeReportVersion({ reportId: report.id })
                  toast({ title: `Froze version ${r.versionNumber}` })
                  await reload()
                } catch (e: any) { toast({ title: 'Freeze failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
              }}>
              Freeze Version
            </Button>
            <Button size="sm" variant="outline"
              disabled={!report.readiness.isFinalReady}
              onClick={async () => {
                try { await changeReportStatus({ reportId: report.id, status: 'FINAL' }); await reload() }
                catch (e: any) { toast({ title: 'Finalize failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
              }}>
              Mark FINAL
            </Button>
            <Button size="sm" variant="outline"
              onClick={async () => {
                try {
                  const r = await exportReportPlainText({ reportId: report.id })
                  downloadFile(r.filename, r.text, 'text/plain')
                } catch (e: any) { toast({ title: 'Export failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
              }}>
              <Download className="h-3 w-3 mr-1" /> Text
            </Button>
            <Button size="sm"
              onClick={async () => {
                try {
                  const r = await exportReportDocx({ reportId: report.id })
                  downloadBase64(r.filename, r.base64,
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
                } catch (e: any) { toast({ title: 'DOCX failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
              }}>
              <Download className="h-3 w-3 mr-1" /> DOCX
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border-none shadow-sm bg-white lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">Sections</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {report.sections.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setActiveSectionId(s.id); setEditBody('') }}
                  className={`w-full text-left px-3 py-2 hover:bg-slate-50 ${s.id === activeSectionId ? 'bg-slate-50' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{s.title}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {s.isRequired ? 'required' : 'optional'}
                        {s.isStale && <span className="ml-1 text-amber-700">• stale</span>}
                      </div>
                    </div>
                    <Badge className={statusBadgeCls(s.status)}>{s.status.replace(/_/g, ' ')}</Badge>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white lg:col-span-2">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">
              {active?.title ?? 'Select a section'}
            </CardTitle>
            {active && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline"
                  disabled={report.status === 'FINAL'}
                  onClick={async () => {
                    try {
                      const r = await draftSectionWithAI({ sectionId: active.id })
                      toast({
                        title: `AI drafted (${r.citationsSaved} cites saved${r.citationsDropped > 0 ? `, ${r.citationsDropped} dropped` : ''})`,
                        description: r.isConfident ? undefined : 'AI returned low confidence — reviewer must check',
                      })
                      await reload()
                    } catch (e: any) {
                      toast({ title: 'AI draft failed', description: e?.message ?? 'unknown', variant: 'destructive' })
                    }
                  }}>
                  <Sparkles className="h-3 w-3 mr-1" /> AI Draft
                </Button>
                <Button size="sm" variant="outline"
                  disabled={report.status === 'FINAL' || !editBody.trim()}
                  onClick={async () => {
                    try {
                      await saveSectionEdit({ sectionId: active.id, body: editBody })
                      setEditBody('')
                      await reload()
                    } catch (e: any) {
                      toast({ title: 'Save failed', description: e?.message ?? 'unknown', variant: 'destructive' })
                    }
                  }}>
                  Save Edit
                </Button>
                <Select
                  value={active.status}
                  onValueChange={async (v) => {
                    try { await changeSectionStatus({ sectionId: active.id, next: v }); await reload() }
                    catch (e: any) { toast({ title: 'Status change failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
                  }}>
                  <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NOT_STARTED">Not started</SelectItem>
                    <SelectItem value="AI_DRAFTED">AI drafted</SelectItem>
                    <SelectItem value="HUMAN_EDITING">Human editing</SelectItem>
                    <SelectItem value="READY_FOR_REVIEW">Ready for review</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {active ? (
              <div className="space-y-3">
                {active.isStale && (
                  <div className="border border-amber-200 bg-amber-50 rounded p-2 text-xs text-amber-900 flex gap-2">
                    <ShieldAlert className="h-4 w-4" />
                    This section's draft was written against an earlier facts snapshot. Approval is refused until it is re-drafted or edited against the current facts.
                  </div>
                )}
                <Textarea
                  className="min-h-[240px] font-mono text-xs"
                  placeholder="Write or paste the section body here. The AI Draft button will populate this from approved case data only."
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                />
                <div className="text-[10px] text-muted-foreground">
                  Current facts hash: <span className="font-mono">{report.currentFactsHash?.slice(0, 16)}…</span>
                  {' • Section factsHash: '}
                  <span className="font-mono">{active.currentFactsHash?.slice(0, 16) ?? '(none)'}…</span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground text-center py-6">Pick a section from the list.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">Standards Checklist</CardTitle>
            <div className="text-[10px] text-muted-foreground mt-1">
              Professional aid. Attaching a checklist does NOT certify compliance.
            </div>
          </div>
          <div className="flex gap-2">
            {seeds.map(seed => (
              <Button key={seed.key} size="sm" variant="outline"
                onClick={async () => {
                  try {
                    const r = await attachSeedChecklist({ reportId: report.id, seedKey: seed.key })
                    toast({ title: r.added > 0 ? `Added ${r.added} items` : 'All items already attached' })
                    await reload()
                  } catch (e: any) { toast({ title: 'Attach failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
                }}>
                + {seed.standardsFamily}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {checkls.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">No checklist attached.</div>
          ) : (
            <div className="divide-y">
              {checkls.map(c => (
                <div key={c.id} className="py-2 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm">
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-2">{c.standardsFamily}</span>
                      {c.title}
                    </div>
                    {c.guidance && <div className="text-[10px] text-muted-foreground">{c.guidance}</div>}
                  </div>
                  <Select
                    value={c.status}
                    onValueChange={async (v) => {
                      try { await updateChecklistItemStatus({ itemId: c.id, status: v }); await reload() }
                      catch (e: any) { toast({ title: 'Update failed', description: e?.message ?? 'unknown', variant: 'destructive' }) }
                    }}>
                    <SelectTrigger className="w-40 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PENDING">Pending</SelectItem>
                      <SelectItem value="ADDRESSED">Addressed</SelectItem>
                      <SelectItem value="NOT_APPLIC">Not applicable</SelectItem>
                      <SelectItem value="AT_RISK">At risk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function statusBadgeCls(status: string): string {
  if (status === 'APPROVED')          return 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
  if (status === 'READY_FOR_REVIEW')  return 'bg-blue-100 text-blue-800 hover:bg-blue-100'
  if (status === 'HUMAN_EDITING')     return 'bg-amber-100 text-amber-800 hover:bg-amber-100'
  if (status === 'AI_DRAFTED')        return 'bg-violet-100 text-violet-800 hover:bg-violet-100'
  return 'bg-slate-100 text-slate-800 hover:bg-slate-100'
}

function downloadFile(name: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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
