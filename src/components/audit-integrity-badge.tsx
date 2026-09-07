'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ShieldCheck, ShieldAlert, Loader2, RefreshCw } from 'lucide-react'
import { verifyOrganizationAuditChain } from '@/app/actions/audit-integrity'

type ChainState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok';     eventsChecked: number; eventsSkipped: number; verifiedAt: Date }
  | { kind: 'fail';   firstBadSequence?: number; message?: string; reason?: string }
  | { kind: 'error';  message: string }

/**
 * Small dashboard for the tamper-evident audit chain. Shows a Verified /
 * Failed badge for the caller's organization chain plus a re-verify
 * button. Meant to sit next to the case audit log panel so analysts can
 * spot-check integrity before relying on the trail for a report.
 *
 * The badge deliberately reports the underlying detail (first bad
 * sequence, reason code) — this is expert-witness UI, not a marketing
 * surface. No overclaiming; "verified" means the hash chain is intact,
 * nothing more.
 */
export function AuditIntegrityBadge() {
  const [state, setState] = React.useState<ChainState>({ kind: 'idle' })

  const verify = React.useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await verifyOrganizationAuditChain()
      if (res.ok) {
        setState({
          kind: 'ok',
          eventsChecked: res.eventsChecked,
          eventsSkipped: res.eventsSkipped,
          verifiedAt: new Date(),
        })
      } else {
        setState({
          kind: 'fail',
          firstBadSequence: res.firstBadSequence,
          message:          res.message,
          reason:           res.reason,
        })
      }
    } catch (e: any) {
      setState({ kind: 'error', message: e?.message ?? 'unknown error' })
    }
  }, [])

  React.useEffect(() => { verify() }, [verify])

  return (
    <Card className="border-none shadow-sm bg-white">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xs uppercase tracking-widest font-bold text-primary">
            Audit integrity
          </CardTitle>
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={verify}
            title="Re-verify chain"
            disabled={state.kind === 'loading'}
          >
            {state.kind === 'loading' ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {state.kind === 'idle' || state.kind === 'loading' ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="animate-spin h-3 w-3" /> Checking…
          </div>
        ) : state.kind === 'ok' ? (
          <div className="space-y-2">
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100 uppercase font-bold tracking-widest text-[10px]">
              <ShieldCheck className="h-3 w-3 mr-1" /> Verified
            </Badge>
            <p className="text-[11px] text-muted-foreground">
              {state.eventsChecked.toLocaleString()} chained event{state.eventsChecked === 1 ? '' : 's'} intact
              {state.eventsSkipped > 0
                ? ` · ${state.eventsSkipped} pre-chain event${state.eventsSkipped === 1 ? '' : 's'} skipped`
                : ''}
              <br />
              Verified at {state.verifiedAt.toLocaleTimeString()}
            </p>
          </div>
        ) : state.kind === 'fail' ? (
          <div className="space-y-2">
            <Badge className="bg-red-100 text-red-800 hover:bg-red-100 uppercase font-bold tracking-widest text-[10px]">
              <ShieldAlert className="h-3 w-3 mr-1" /> Failed
            </Badge>
            <p className="text-[11px] text-muted-foreground">
              First invalid link: event #{state.firstBadSequence ?? '?'}
              {state.reason ? ` (${state.reason})` : ''}
              <br />
              {state.message ?? 'The audit chain has been modified.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Badge variant="outline" className="uppercase font-bold tracking-widest text-[10px]">
              Error
            </Badge>
            <p className="text-[11px] text-muted-foreground">{state.message}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
