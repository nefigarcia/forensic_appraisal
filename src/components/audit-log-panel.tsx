'use client'

import * as React from 'react'
import { getAuditLog } from '@/app/actions/ai-actions'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

interface AuditLogPanelProps {
  caseId: string
}

const ACTION_COLORS: Record<string, string> = {
  CREATE_CASE:        'bg-blue-100   text-blue-800',
  UPLOAD_DOCUMENT:    'bg-indigo-100 text-indigo-800',
  RUN_EXTRACTION:     'bg-violet-100 text-violet-800',
  ACCEPT_VALUE:       'bg-emerald-100 text-emerald-800',
  OVERRIDE_VALUE:     'bg-amber-100  text-amber-800',
  REJECT_VALUE:       'bg-red-100    text-red-800',
  LOCK_VALUE:         'bg-slate-200  text-slate-800',
  UNLOCK_VALUE:       'bg-slate-100  text-slate-600',
  RUN_ANOMALY_DETECT: 'bg-orange-100 text-orange-800',
  RESOLVE_ANOMALY:    'bg-teal-100   text-teal-800',
  SAVE_VALUATION:     'bg-cyan-100   text-cyan-800',
  APPROVE_VALUES:     'bg-emerald-100 text-emerald-800',
  DELETE_DOCUMENT:    'bg-red-100    text-red-800',
}

export function AuditLogPanel({ caseId }: AuditLogPanelProps) {
  const [entries, setEntries] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await getAuditLog(caseId)
      setEntries(data)
    } finally {
      setLoading(false)
    }
  }, [caseId])

  React.useEffect(() => { load() }, [load])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Audit Trail
          <span className="text-muted-foreground font-normal">({entries.length} events)</span>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No audit events recorded yet.</p>
      ) : (
        <ScrollArea className="h-[520px] pr-3">
          <ol className="relative border-l border-border ml-3 space-y-1">
            {entries.map((entry, i) => (
              <li key={entry.id ?? i} className="ml-4 pb-4">
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-background bg-border" />
                <div className="flex flex-wrap items-start gap-2">
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[10px] font-semibold tracking-wide',
                      ACTION_COLORS[entry.action] ?? 'bg-slate-100 text-slate-700',
                    )}
                  >
                    {entry.action.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground mt-0.5">
                    {entry.user?.name ?? entry.user?.email ?? 'System'}
                    {' · '}
                    {format(new Date(entry.createdAt), 'MMM d, yyyy h:mm a')}
                  </span>
                </div>
                {entry.note && (
                  <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>
                )}
                {(entry.oldValue || entry.newValue) && (
                  <div className="mt-1 flex gap-3 text-[11px] font-mono">
                    {entry.oldValue && (
                      <span className="text-red-600 line-through">{entry.oldValue}</span>
                    )}
                    {entry.newValue && (
                      <span className="text-emerald-700">{entry.newValue}</span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </ScrollArea>
      )}
    </div>
  )
}
