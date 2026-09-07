'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, RefreshCw, Calculator, ShieldAlert, Plus } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  getValuationEngagement, initializeValuationEngagement,
  type ValuationEngagementForClient,
} from '@/app/actions/valuation-engagement'
import { runScenarioReconciliation } from '@/app/actions/valuation-compute'
import { getOwnershipAdjustments, type OwnershipAdjustmentForClient } from '@/app/actions/ownership-adjustments'
import { getAssumptionsForEngagement, type AssumptionForClient } from '@/app/actions/valuation-assumptions'

/**
 * Minimal Slice-13 workbench surface.
 *
 * Shows engagement state, per-scenario approaches with indicated values,
 * ownership discounts + statuses, and material assumptions + statuses.
 * Recompute buttons wire directly to the compute actions.
 *
 * Rich per-approach editors (DCF year grid, GPCM table) are deliberately
 * left to a follow-up UI slice — the load-bearing invariants of the
 * engine (no auto-discount, assumption approval flow, blocking
 * reconciliation) are all exercised through the server-action tests.
 */
export function ValuationWorkbench({ caseId }: { caseId: string }) {
  const [engagement, setEngagement] = React.useState<ValuationEngagementForClient | null>(null)
  const [assumptions, setAssumptions] = React.useState<AssumptionForClient[]>([])
  const [ownership, setOwnership]     = React.useState<OwnershipAdjustmentForClient[]>([])
  const [loading, setLoading]         = React.useState(false)
  const [busyScenarioId, setBusyScenarioId] = React.useState<string | null>(null)
  const { toast } = useToast()

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const e = await getValuationEngagement(caseId)
      setEngagement(e)
      if (e) {
        const [assumps, own] = await Promise.all([
          getAssumptionsForEngagement(e.id),
          getOwnershipAdjustments(e.id),
        ])
        setAssumptions(assumps); setOwnership(own)
      } else {
        setAssumptions([]); setOwnership([])
      }
    } catch (err: any) {
      toast({ title: 'Could not load engagement', description: err?.message ?? 'unknown', variant: 'destructive' })
    } finally { setLoading(false) }
  }, [caseId, toast])

  React.useEffect(() => { void reload() }, [reload])

  if (engagement === null) {
    return (
      <Card className="border-none shadow-sm bg-white">
        <CardHeader><CardTitle>Professional Valuation Workbench</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            No valuation engagement has been initialized for this case yet. Start one to structure
            the income, market, and asset approaches with per-scenario reconciliation.
          </p>
          <Button
            onClick={async () => {
              try { await initializeValuationEngagement({ caseId }); await reload() }
              catch (e: any) { toast({ title: 'Could not initialize', description: e?.message ?? 'unknown', variant: 'destructive' }) }
            }}>
            <Plus className="h-3 w-3 mr-1" /> Initialize Workbench
          </Button>
        </CardContent>
      </Card>
    )
  }

  const blocking = countBlocking(assumptions, ownership)

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            Professional Valuation Workbench
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reload} title="Refresh">
            {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex gap-4">
            <div><span className="text-muted-foreground">Standard of value:</span> <b>{engagement.standardOfValue ?? '—'}</b></div>
            <div><span className="text-muted-foreground">Premise:</span> <b>{engagement.premiseOfValue ?? '—'}</b></div>
            <div><span className="text-muted-foreground">Interest:</span> <b>{engagement.interestType ?? '—'}</b></div>
            <div><span className="text-muted-foreground">Marketability:</span> <b>{engagement.marketability ?? '—'}</b></div>
          </div>
          {blocking > 0 && (
            <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              <ShieldAlert className="h-4 w-4" />
              {blocking} item{blocking === 1 ? '' : 's'} still need professional approval before a final reconciliation.
            </div>
          )}
        </CardContent>
      </Card>

      {engagement.scenarios.map(scenario => (
        <Card key={scenario.id} className="border-none shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">
              Scenario — {scenario.name}
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline"
                disabled={busyScenarioId === scenario.id}
                onClick={async () => {
                  setBusyScenarioId(scenario.id)
                  try {
                    const r = await runScenarioReconciliation({ scenarioId: scenario.id, allowBlocking: true })
                    toast({
                      title: `Preview — ${scenario.name}`,
                      description: `EV ${r.enterpriseValue}, Equity ${r.equityValue}${r.hasBlockingAssumptions ? ' (blocking — preview only)' : ''}`,
                    })
                    await reload()
                  } catch (e: any) {
                    toast({ title: 'Reconciliation failed', description: e?.message ?? 'unknown', variant: 'destructive' })
                  } finally { setBusyScenarioId(null) }
                }}>
                {busyScenarioId === scenario.id ? <Loader2 className="animate-spin h-3 w-3 mr-1" /> : null}
                Preview
              </Button>
              <Button size="sm"
                disabled={busyScenarioId === scenario.id || blocking > 0}
                onClick={async () => {
                  setBusyScenarioId(scenario.id)
                  try {
                    await runScenarioReconciliation({ scenarioId: scenario.id })
                    toast({ title: `Reconciled ${scenario.name}` })
                    await reload()
                  } catch (e: any) {
                    toast({ title: 'Reconciliation refused', description: e?.message ?? 'unknown', variant: 'destructive' })
                  } finally { setBusyScenarioId(null) }
                }}>
                Reconcile
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {scenario.approaches.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-6">No approaches yet.</div>
            ) : (
              <div className="divide-y">
                {scenario.approaches.map(a => (
                  <div key={a.id} className="py-2 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{a.label}</div>
                      <div className="text-[10px] text-muted-foreground">
                        weight {a.weight} • {a.isIncluded ? 'included' : 'excluded'}
                      </div>
                    </div>
                    <div className="text-sm font-mono">
                      {a.indicatedValue ?? <span className="text-muted-foreground">not computed</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">Material Assumptions</CardTitle>
        </CardHeader>
        <CardContent>
          {assumptions.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">No assumptions yet.</div>
          ) : (
            <div className="divide-y">
              {assumptions.map(a => (
                <div key={a.id} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{a.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {a.key}
                      {a.valueString && <> • value <span className="font-mono">{a.valueString}</span></>}
                    </div>
                  </div>
                  <Badge className={statusBadgeCls(a.status)}>{a.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">
            Ownership Discounts (DLOC / DLOM)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-[11px] text-muted-foreground mb-3">
            Discounts do not auto-apply. Only APPROVED rows are picked up by the reconciliation math.
          </div>
          {ownership.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">No ownership adjustments defined.</div>
          ) : (
            <div className="divide-y">
              {ownership.map(o => (
                <div key={o.id} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{o.kindLabel}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{o.percent}</div>
                    {o.rationale && <div className="text-[10px] text-muted-foreground italic">{o.rationale}</div>}
                  </div>
                  <Badge className={statusBadgeCls(o.status)}>{o.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function countBlocking(assumps: AssumptionForClient[], own: OwnershipAdjustmentForClient[]): number {
  let n = 0
  for (const a of assumps) if (a.status === 'DRAFT' || a.status === 'PROPOSED' || a.status === 'REJECTED') n++
  for (const o of own) if (o.status === 'DRAFT' || o.status === 'PROPOSED') n++
  return n
}

function statusBadgeCls(status: string): string {
  if (status === 'APPROVED')   return 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
  if (status === 'PROPOSED')   return 'bg-blue-100 text-blue-800 hover:bg-blue-100'
  if (status === 'REJECTED')   return 'bg-red-100 text-red-800 hover:bg-red-100'
  if (status === 'SUPERSEDED') return 'bg-slate-100 text-slate-500 hover:bg-slate-100'
  return 'bg-slate-100 text-slate-800 hover:bg-slate-100'
}
