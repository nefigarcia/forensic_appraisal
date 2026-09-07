'use client'

import * as React from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Sparkles, Filter, Loader2, ShieldAlert, ArrowRight, Search,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  searchCasesFactual, searchCasesWithAI,
  type SearchResultRow, type AiSearchResult,
} from '@/app/actions/case-search'
import type { FilterSet } from '@/lib/search/query-shape'

const APPROACH_KINDS = [
  'INCOME_CAP_EARNINGS', 'INCOME_DCF',
  'MARKET_GPCM', 'MARKET_TRANSACTIONS', 'ASSET',
]

/**
 * Two-mode Slice-16 search UI:
 *   - Factual: structured filters (state, industry, method, DLOM/DLOC bands, etc.)
 *   - Semantic: AI-planned. The AI's proposed filters are shown BEFORE
 *     any results — the user sees exactly which filters ran.
 */
export function CaseSearchPanel() {
  const [mode, setMode]           = React.useState<'factual' | 'semantic'>('factual')
  const [rows, setRows]           = React.useState<SearchResultRow[]>([])
  const [aiResult, setAiResult]   = React.useState<AiSearchResult | null>(null)
  const [totalAuthorized, setTotalAuthorized] = React.useState<number>(0)
  const [restricted, setRestricted] = React.useState<number>(0)
  const [busy, setBusy]           = React.useState(false)

  // Factual controls
  const [state,       setState]       = React.useState('')
  const [industry,    setIndustry]    = React.useState('')
  const [method,      setMethod]      = React.useState('')
  const [dlomMin,     setDlomMin]     = React.useState('')
  const [dlomMax,     setDlomMax]     = React.useState('')
  const [relatedParty,setRelatedParty]= React.useState(false)

  const [question, setQuestion] = React.useState('')
  const { toast } = useToast()

  const runFactual = async () => {
    setBusy(true); setAiResult(null)
    const filters: FilterSet['filters'] = []
    if (state.trim())     filters.push({ kind: 'string', filter: { field: 'subjectState', op: 'eq', value: state.trim().toUpperCase() } })
    if (industry.trim())  filters.push({ kind: 'string', filter: { field: 'industryLabel', op: 'contains', value: industry.trim() } })
    if (method)           filters.push({ kind: 'array',  filter: { field: 'methodsApplied', op: 'includes', value: method } })
    if (dlomMin && dlomMax) {
      filters.push({ kind: 'numeric', filter: { field: 'approvedDlomPercent', op: 'between', min: dlomMin, max: dlomMax } })
    } else if (dlomMin) {
      filters.push({ kind: 'numeric', filter: { field: 'approvedDlomPercent', op: 'gte', value: dlomMin } })
    } else if (dlomMax) {
      filters.push({ kind: 'numeric', filter: { field: 'approvedDlomPercent', op: 'lte', value: dlomMax } })
    }
    if (relatedParty) filters.push({ kind: 'boolean', filter: { field: 'hasRelatedPartyAddBack', op: 'eq', value: true } })

    try {
      const r = await searchCasesFactual({ filters, orderBy: 'valuationDate', orderDir: 'desc' })
      setRows(r.rows); setTotalAuthorized(r.totalAuthorized); setRestricted(r.restrictedCount)
      if (r.dropped.length > 0) {
        toast({ title: `Dropped ${r.dropped.length} unknown field(s)`, description: r.dropped.join(', '), variant: 'destructive' })
      }
    } catch (e: any) {
      toast({ title: 'Search failed', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const runSemantic = async () => {
    if (!question.trim()) return
    setBusy(true); setAiResult(null)
    try {
      const r = await searchCasesWithAI({ question })
      setAiResult(r); setRows(r.rows); setTotalAuthorized(r.totalAuthorized); setRestricted(r.restrictedCount)
    } catch (e: any) {
      toast({ title: 'AI search failed', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary flex items-center gap-2">
            <Search className="h-4 w-4" /> Historical Case Search
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant={mode === 'factual' ? 'default' : 'outline'} onClick={() => setMode('factual')}>
              <Filter className="h-3 w-3 mr-1" /> Factual filters
            </Button>
            <Button size="sm" variant={mode === 'semantic' ? 'default' : 'outline'} onClick={() => setMode('semantic')}>
              <Sparkles className="h-3 w-3 mr-1" /> Ask a question
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-[11px] text-muted-foreground">
            Search your firm's own case history. Results respect organization boundaries and case-membership restrictions. Historical decisions are never presented as recommendations.
          </div>

          {mode === 'factual' ? (
            <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
              <Input placeholder="State (e.g. CO)" value={state} onChange={e => setState(e.target.value)} />
              <Input placeholder="Industry" value={industry} onChange={e => setIndustry(e.target.value)} />
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue placeholder="Any method" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  {APPROACH_KINDS.map(k => <SelectItem key={k} value={k}>{k.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="DLOM min (0.18)" value={dlomMin} onChange={e => setDlomMin(e.target.value)} />
              <Input placeholder="DLOM max (0.25)" value={dlomMax} onChange={e => setDlomMax(e.target.value)} />
              <label className="text-xs flex items-center gap-2">
                <input type="checkbox" checked={relatedParty} onChange={e => setRelatedParty(e.target.checked)} />
                Related-party add-back
              </label>
              <Button className="md:col-span-6" onClick={runFactual} disabled={busy}>
                {busy ? <Loader2 className="animate-spin h-3 w-3 mr-1" /> : null} Search
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Textarea
                placeholder='e.g. "Find HVAC valuations performed in Colorado" or "Show cases with DLOM between 18% and 25%"'
                value={question}
                onChange={e => setQuestion(e.target.value)}
                className="min-h-[80px]"
              />
              <Button onClick={runSemantic} disabled={busy || !question.trim()}>
                {busy ? <Loader2 className="animate-spin h-3 w-3 mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Ask
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {aiResult && (
        <Card className="border-none shadow-sm bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">
              AI Plan {aiResult.isConfident ? <Badge className="bg-emerald-100 text-emerald-800 ml-2">confident</Badge>
                                             : <Badge className="bg-amber-100 text-amber-800 ml-2">low confidence</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-2">
            <div className="text-sm">{aiResult.explanation}</div>
            {aiResult.fallbackReason && (
              <div className="border border-amber-200 bg-amber-50 rounded p-2 text-amber-900 flex gap-2">
                <ShieldAlert className="h-3 w-3 mt-0.5" />{aiResult.fallbackReason}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground">Filters applied:</div>
            <ul className="text-[11px] font-mono space-y-1">
              {aiResult.proposedFilters.filters.map((f, i) => (
                <li key={i}>• {(f.filter as any).field} {(f.filter as any).op} {JSON.stringify((f.filter as any).value ?? [(f.filter as any).min, (f.filter as any).max, ...((f.filter as any).values ?? [])].filter(Boolean))}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">
            {rows.length} Result{rows.length === 1 ? '' : 's'}
          </CardTitle>
          <div className="text-[10px] text-muted-foreground">
            {totalAuthorized} case{totalAuthorized === 1 ? '' : 's'} indexed for you • {restricted} restricted (engagement gate)
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-8">No results.</div>
          ) : (
            <div className="divide-y">
              {rows.map(r => (
                <Link key={r.caseId} href={`/projects/${r.caseId}`} className="block py-3 hover:bg-slate-50 -mx-3 px-3 rounded">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.caseName} <span className="text-muted-foreground">— {r.clientName}</span></div>
                      <div className="text-[10px] text-muted-foreground flex flex-wrap gap-2 mt-1">
                        {r.subjectState && <Badge variant="outline" className="text-[9px]">{r.subjectState}</Badge>}
                        {r.industryLabel && <Badge variant="outline" className="text-[9px]">{r.industryLabel}</Badge>}
                        {r.naicsCode && <Badge variant="outline" className="text-[9px]">NAICS {r.naicsCode}</Badge>}
                        {r.valuationDate && <Badge variant="outline" className="text-[9px]">{r.valuationDate.toISOString().slice(0, 10)}</Badge>}
                        {r.methodsApplied.map(m => <Badge key={m} variant="outline" className="text-[9px]">{m.replace(/_/g, ' ')}</Badge>)}
                        {r.approvedDlomPercent && <Badge className="text-[9px] bg-amber-100 text-amber-800">DLOM {r.approvedDlomPercent}</Badge>}
                        {r.hasRelatedPartyAddBack && <Badge className="text-[9px] bg-red-100 text-red-800">related-party</Badge>}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
