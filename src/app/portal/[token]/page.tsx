/**
 * Public client-portal page. Renders the RequestList a specific
 * PortalAccess token authorizes; nothing else.
 *
 * Notes:
 *   - This is a server component: it invokes `getPortalRequestList` on
 *     the server and streams the (sanitized) shape to the browser.
 *   - Uploads are handled by the `PortalUploader` client component.
 *   - There is NO firm sidebar / nav — the portal user must not see
 *     firm branding suggesting an internal app.
 */

import * as React from 'react'
import { PortalUploader } from '@/components/portal-uploader'
import { getPortalRequestList } from '@/app/actions/portal'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Upload, CheckCircle2 } from 'lucide-react'
import { notFound } from 'next/navigation'

interface PageProps { params: Promise<{ token: string }> }

export default async function PortalPage({ params }: PageProps) {
  const { token } = await params
  let view
  try {
    view = await getPortalRequestList(token)
  } catch {
    notFound()
  }

  return (
    <main className="min-h-screen bg-slate-50 py-10">
      <div className="max-w-3xl mx-auto px-4 space-y-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Requested items</h1>
          <p className="text-sm text-muted-foreground">
            Hello {view.contactName}. Please upload the requested files below. This link expires{' '}
            {view.expiresAt.toISOString().slice(0, 10)}.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <SummaryCard label="Outstanding"  n={view.outstandingCount}   tone="danger" />
          <SummaryCard label="Clarification" n={view.clarificationCount} tone="warn"  />
          <SummaryCard label="Received"     n={view.receivedCount}      tone="good"  />
        </div>

        <div className="bg-white shadow-sm rounded-md divide-y">
          {view.items.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-10">Nothing outstanding.</div>
          ) : view.items.map(item => (
            <div key={item.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{item.title}</div>
                  {item.description && <div className="text-sm text-muted-foreground">{item.description}</div>}
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {item.categoryLabel && <span className="mr-2">{item.categoryLabel}</span>}
                    {item.dueDate && <span>Due {item.dueDate.toISOString().slice(0, 10)}</span>}
                  </div>
                </div>
                <StatusBadge status={item.status} label={item.statusLabel} />
              </div>
              {item.status === 'NEEDS_CLARIFICATION' && item.clarificationNote && (
                <div className="border border-amber-200 bg-amber-50 rounded-md p-3 text-sm text-amber-900 flex gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <div>
                    <div className="font-medium">Reviewer needs clarification</div>
                    <div>{item.clarificationNote}</div>
                  </div>
                </div>
              )}
              {item.documents.length > 0 && (
                <div className="text-xs">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Uploaded</div>
                  <ul className="list-disc pl-5">
                    {item.documents.map(d => (
                      <li key={d.id}>{d.name} <span className="text-muted-foreground">— {d.uploadedAt.toISOString().slice(0, 10)}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              {item.status !== 'ACCEPTED' && item.status !== 'NOT_APPLICABLE' && (
                <PortalUploader rawToken={token} requestItemId={item.id} />
              )}
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground text-center">
          Uploads are protected. Nothing you upload here is visible to anyone outside your engagement team.
        </p>
      </div>
    </main>
  )
}

function SummaryCard({ label, n, tone }: { label: string; n: number; tone: 'good' | 'warn' | 'danger' }) {
  const cls = tone === 'danger' ? 'border-red-200 bg-red-50'
            : tone === 'warn'   ? 'border-amber-200 bg-amber-50'
            : 'border-emerald-200 bg-emerald-50'
  return (
    <div className={`border rounded-md p-4 ${cls}`}>
      <div className="text-2xl font-bold">{n}</div>
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  )
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const cls = (status === 'RECEIVED' || status === 'ACCEPTED')
    ? 'bg-emerald-100 text-emerald-800'
    : status === 'NEEDS_CLARIFICATION'
    ? 'bg-amber-100 text-amber-800'
    : status === 'REQUESTED'
    ? 'bg-blue-100 text-blue-800'
    : 'bg-slate-100 text-slate-800'
  const icon = status === 'ACCEPTED' ? <CheckCircle2 className="h-3 w-3 mr-1" />
             : status === 'REQUESTED' ? <Upload className="h-3 w-3 mr-1" />
             : null
  return <Badge className={`${cls} hover:${cls} flex items-center`}>{icon}{label}</Badge>
}
