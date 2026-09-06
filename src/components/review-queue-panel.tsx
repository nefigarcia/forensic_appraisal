'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, RefreshCw, ListChecks } from 'lucide-react'
import { getCaseReviewQueue } from '@/app/actions/review-queue'
import { useToast } from '@/hooks/use-toast'

interface Summary {
  caseId: string
  reviewItems: Array<{
    targetType: string
    targetTypeLabel: string
    readyForReviewCount: number
    changesRequestedCount: number
    approvedCount: number
    draftCount: number
  }>
  derived: {
    financialValuesPending: number
    addBacksProposed: number
    addBacksNeedsSupport: number
    tieOutsDiscrepancy: number
    documentsPending: number
    anomalyFlagsOpen: number
  }
  totalItemsAwaitingReview: number
}

/**
 * Case-level review queue. Shows the aggregate "what still needs a
 * human decision" surface across every earlier-slice model + explicit
 * ReviewItem rows.
 */
export function ReviewQueuePanel({ caseId }: { caseId: string }) {
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const [loading, setLoading] = React.useState(false)
  const { toast } = useToast()

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const s = await getCaseReviewQueue(caseId)
      setSummary(s as any)
    } catch (e: any) {
      toast({ title: 'Could not load queue', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [caseId, toast])

  React.useEffect(() => { load() }, [load])

  return (
    <Card className="border-none shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            Review Queue
          </CardTitle>
          {summary && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {summary.totalItemsAwaitingReview === 0
                ? 'Nothing awaiting review.'
                : `${summary.totalItemsAwaitingReview} item${summary.totalItemsAwaitingReview === 1 ? '' : 's'} awaiting review.`}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={load}>
          {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent>
        {summary === null ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin h-5 w-5 text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                Derived from case data
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <QueueTile label="Financial values pending" n={summary.derived.financialValuesPending} />
                <QueueTile label="Add-backs proposed"       n={summary.derived.addBacksProposed}       />
                <QueueTile label="Add-backs need support"   n={summary.derived.addBacksNeedsSupport}   />
                <QueueTile label="Tie-out discrepancies"    n={summary.derived.tieOutsDiscrepancy}     danger />
                <QueueTile label="Documents pending"        n={summary.derived.documentsPending}       />
                <QueueTile label="Anomaly flags open"       n={summary.derived.anomalyFlagsOpen}       danger />
              </div>
            </div>
            {summary.reviewItems.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                  Explicit review items
                </div>
                <div className="divide-y">
                  {summary.reviewItems.map(r => (
                    <div key={r.targetType} className="py-2 flex items-center justify-between">
                      <div className="text-sm">{r.targetTypeLabel}</div>
                      <div className="flex gap-1 items-center">
                        {r.readyForReviewCount > 0 && <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{r.readyForReviewCount} ready</Badge>}
                        {r.changesRequestedCount > 0 && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{r.changesRequestedCount} changes</Badge>}
                        {r.draftCount > 0 && <Badge variant="outline">{r.draftCount} draft</Badge>}
                        {r.approvedCount > 0 && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{r.approvedCount} approved</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function QueueTile({ label, n, danger }: { label: string; n: number; danger?: boolean }) {
  return (
    <div className={`border rounded-md p-3 ${n > 0 && danger ? 'border-red-200 bg-red-50/40' : ''}`}>
      <div className={`text-xl font-bold ${n > 0 && danger ? 'text-red-800' : 'text-primary'}`}>{n}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  )
}
