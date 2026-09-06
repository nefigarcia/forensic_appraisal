'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2, RefreshCw, ListChecks, ClipboardList, Send, Copy, Sparkles, Trash2, Plus } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  getRequestListsForCase, getRequestItems, getRequestDashboard,
  createRequestList, addRequestItem, changeRequestItemStatus,
  deleteRequestItem, markRequestListSent, closeRequestList,
  listSeedTemplates, listRequestTemplates,
  type RequestListForClient, type RequestItemForClient, type RequestListDashboard,
} from '@/app/actions/requests'
import {
  invitePortalAccess, getClientContacts, addClientContact, listPortalInvites,
  revokePortalAccess, sendPortalReminder,
  type ClientContactForClient, type PortalInviteSummary,
} from '@/app/actions/portal-invites'
import { runRequestCompletenessCheck } from '@/app/actions/request-completeness'

/**
 * Firm-side dashboard for a case's request lists. Composes:
 *   - the "N received / N clarification / N outstanding" headline
 *   - the per-list breakdown with items grid
 *   - a client-contact + portal-invite panel
 */
export function RequestListPanel({ caseId }: { caseId: string }) {
  const [lists, setLists]         = React.useState<RequestListForClient[] | null>(null)
  const [dashboard, setDashboard] = React.useState<RequestListDashboard | null>(null)
  const [selectedListId, setSelectedListId] = React.useState<string | null>(null)
  const [items, setItems]         = React.useState<RequestItemForClient[]>([])
  const [contacts, setContacts]   = React.useState<ClientContactForClient[]>([])
  const [invites, setInvites]     = React.useState<PortalInviteSummary[]>([])
  const [loading, setLoading]     = React.useState(false)
  const [newInvite, setNewInvite] = React.useState<{ url: string; expiresAt: string } | null>(null)

  const { toast } = useToast()

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const [ls, dash, cs] = await Promise.all([
        getRequestListsForCase(caseId),
        getRequestDashboard(caseId),
        getClientContacts(caseId),
      ])
      setLists(ls); setDashboard(dash); setContacts(cs)
      const nextId = selectedListId ?? ls[0]?.id ?? null
      setSelectedListId(nextId)
      if (nextId) {
        const [it, inv] = await Promise.all([
          getRequestItems(nextId),
          listPortalInvites({ requestListId: nextId }),
        ])
        setItems(it); setInvites(inv)
      } else {
        setItems([]); setInvites([])
      }
    } catch (e: any) {
      toast({ title: 'Could not load requests', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [caseId, selectedListId, toast])

  React.useEffect(() => { void reload() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [caseId])

  const onSelectList = async (id: string) => {
    setSelectedListId(id)
    setLoading(true)
    try {
      const [it, inv] = await Promise.all([
        getRequestItems(id),
        listPortalInvites({ requestListId: id }),
      ])
      setItems(it); setInvites(inv)
    } catch (e: any) {
      toast({ title: 'Could not load list', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <SummaryTile label="Received"      n={dashboard?.received ?? 0}      total={dashboard?.totalTracked ?? 0} tone="good" />
        <SummaryTile label="Clarification" n={dashboard?.clarification ?? 0} tone="warn" />
        <SummaryTile label="Outstanding"   n={dashboard?.outstanding ?? 0}   tone="danger" />
        <SummaryTile label="Not applicable" n={dashboard?.notApplicable ?? 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border-none shadow-sm bg-white lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary flex items-center gap-2">
              <ClipboardList className="h-4 w-4" /> Request Lists
            </CardTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reload} title="Refresh">
              {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <NewRequestListButton caseId={caseId} onCreated={reload} />
            {lists === null ? (
              <div className="py-6 flex justify-center"><Loader2 className="animate-spin h-5 w-5 text-muted-foreground" /></div>
            ) : lists.length === 0 ? (
              <div className="text-xs text-muted-foreground py-6 text-center">No request lists yet.</div>
            ) : (
              <div className="divide-y">
                {lists.map(l => (
                  <button key={l.id} type="button"
                    onClick={() => onSelectList(l.id)}
                    className={`w-full text-left py-2 flex items-center justify-between hover:bg-slate-50 rounded px-2 ${l.id === selectedListId ? 'bg-slate-50' : ''}`}>
                    <div>
                      <div className="text-sm font-medium">{l.title}</div>
                      <div className="text-[10px] text-muted-foreground">{l.itemCount} items • {l.status}</div>
                    </div>
                    <Badge variant="outline" className="text-[10px] uppercase">{l.status}</Badge>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white lg:col-span-2">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary flex items-center gap-2">
                <ListChecks className="h-4 w-4" /> Items
              </CardTitle>
              {selectedListId && <div className="text-[11px] text-muted-foreground mt-1">{items.length} total</div>}
            </div>
            {selectedListId && (
              <div className="flex gap-2">
                <AddItemButton listId={selectedListId} onCreated={reload} />
                <Button size="sm" variant="outline"
                        onClick={() => selectedListId && markRequestListSent({ requestListId: selectedListId }).then(reload)}>
                  <Send className="h-3 w-3 mr-1" /> Send
                </Button>
                <Button size="sm" variant="outline"
                        onClick={() => selectedListId && closeRequestList({ requestListId: selectedListId }).then(reload)}>
                  Close
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {selectedListId === null ? (
              <div className="text-xs text-muted-foreground py-6 text-center">Select a list on the left.</div>
            ) : items.length === 0 ? (
              <div className="text-xs text-muted-foreground py-6 text-center">No items yet.</div>
            ) : (
              <div className="divide-y">
                {items.map(it => (
                  <RequestItemRow key={it.id} item={it} onChanged={reload} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary">Client Portal Invites</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <AddContactRow caseId={caseId} onAdded={reload} />
          {contacts.length === 0 ? (
            <div className="text-xs text-muted-foreground">No client contacts yet.</div>
          ) : (
            <div className="grid gap-2">
              {contacts.map(c => (
                <div key={c.id} className="border rounded-md p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground">{c.email}{c.role ? ` — ${c.role}` : ''}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm" variant="outline" disabled={!selectedListId}
                      onClick={async () => {
                        if (!selectedListId) return
                        try {
                          const r = await invitePortalAccess({ requestListId: selectedListId, clientContactId: c.id })
                          setNewInvite({ url: r.url, expiresAt: r.expiresAt.toISOString() })
                          reload()
                          toast({ title: 'Invite issued', description: 'A portal link was created. Copy it below.' })
                        } catch (e: any) {
                          toast({ title: 'Invite failed', description: e?.message ?? 'unknown', variant: 'destructive' })
                        }
                      }}>
                      <Send className="h-3 w-3 mr-1" /> Invite
                    </Button>
                    <Button
                      size="sm" variant="outline" disabled={!selectedListId}
                      onClick={async () => {
                        if (!selectedListId) return
                        const r = await sendPortalReminder({ requestListId: selectedListId, clientContactId: c.id })
                        toast({ title: r.sent ? 'Reminder sent' : 'Rate-limited', description: r.reason })
                      }}>
                      Remind
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {newInvite && (
            <div className="border rounded-md p-3 bg-emerald-50 border-emerald-200">
              <div className="text-[11px] uppercase tracking-widest font-bold text-emerald-800 mb-1">Portal link (shown once)</div>
              <div className="flex items-center gap-2">
                <Input readOnly value={newInvite.url} className="font-mono text-xs" />
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(newInvite.url); toast({ title: 'Copied' }) }}>
                  <Copy className="h-3 w-3 mr-1" /> Copy
                </Button>
              </div>
              <div className="text-[10px] text-emerald-800 mt-2">Expires {newInvite.expiresAt}</div>
            </div>
          )}
          {invites.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">Recent invites</div>
              <div className="divide-y">
                {invites.slice(0, 10).map(i => (
                  <div key={i.tokenHash} className="py-1 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-medium">{i.contactName}</span> <span className="text-muted-foreground">({i.contactEmail})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">used {i.usageCount}×</span>
                      {i.revokedAt ? (
                        <Badge variant="outline" className="text-[10px]">Revoked</Badge>
                      ) : (
                        <Button size="sm" variant="ghost"
                          onClick={() => revokePortalAccess({ tokenHash: i.tokenHash }).then(reload)}>
                          Revoke
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────

function SummaryTile({ label, n, total, tone }: { label: string; n: number; total?: number; tone?: 'good' | 'warn' | 'danger' }) {
  const cls = tone === 'danger' ? 'text-red-800 border-red-200 bg-red-50/40'
            : tone === 'warn'   ? 'text-amber-800 border-amber-200 bg-amber-50/40'
            : tone === 'good'   ? 'text-emerald-800 border-emerald-200 bg-emerald-50/40'
            : 'text-primary'
  return (
    <div className={`border rounded-md p-3 ${cls}`}>
      <div className="text-xl font-bold">{n}{total !== undefined && ` / ${total}`}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  )
}

function NewRequestListButton({ caseId, onCreated }: { caseId: string; onCreated: () => void }) {
  const [open, setOpen]           = React.useState(false)
  const [title, setTitle]         = React.useState('')
  const [seedKey, setSeedKey]     = React.useState<string>('')
  const [seedTemplates, setSeedTemplates] = React.useState<Array<{ key: string; name: string; itemCount: number }>>([])
  const [templates, setTemplates] = React.useState<Array<{ id: string; name: string; itemCount: number }>>([])
  const [templateId, setTemplateId] = React.useState<string>('')
  const { toast } = useToast()

  React.useEffect(() => {
    if (!open) return
    void listSeedTemplates().then(setSeedTemplates)
    void listRequestTemplates().then(t => setTemplates(t.map(x => ({ id: x.id, name: x.name, itemCount: x.itemCount })))).catch(() => setTemplates([]))
  }, [open])

  const submit = async () => {
    if (!title.trim()) return
    try {
      await createRequestList({
        caseId, title,
        templateId: templateId || undefined,
        seedKey:    seedKey    || undefined,
      })
      setOpen(false); setTitle(''); setSeedKey(''); setTemplateId('')
      onCreated()
    } catch (e: any) {
      toast({ title: 'Could not create list', description: e?.message ?? 'unknown', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="w-full"><Plus className="h-3 w-3 mr-1" /> New request list</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create request list</DialogTitle>
          <DialogDescription>Optionally start from one of your firm templates or a built-in seed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Title</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="PBC list — Q4 close" />
          </div>
          {templates.length > 0 && (
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Firm template</label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({t.itemCount})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Or seed</label>
            <Select value={seedKey} onValueChange={setSeedKey}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {seedTemplates.map(s => <SelectItem key={s.key} value={s.key}>{s.name} ({s.itemCount})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddItemButton({ listId, onCreated }: { listId: string; onCreated: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const { toast } = useToast()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-3 w-3 mr-1" /> Item</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add request item</DialogTitle></DialogHeader>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Federal tax returns (5 years)" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={async () => {
            try {
              await addRequestItem({ requestListId: listId, title })
              setOpen(false); setTitle(''); onCreated()
            } catch (e: any) {
              toast({ title: 'Could not add item', description: e?.message ?? 'unknown', variant: 'destructive' })
            }
          }}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RequestItemRow({ item, onChanged }: { item: RequestItemForClient; onChanged: () => void }) {
  const { toast } = useToast()
  const badgeCls = (item.status === 'RECEIVED' || item.status === 'ACCEPTED') ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                 : item.status === 'NEEDS_CLARIFICATION' ? 'bg-amber-100 text-amber-800 hover:bg-amber-100'
                 : item.status === 'REQUESTED' ? 'bg-blue-100 text-blue-800 hover:bg-blue-100'
                 : 'bg-slate-100 text-slate-800 hover:bg-slate-100'

  const nextStatus = async (to: string, note?: string) => {
    try { await changeRequestItemStatus({ id: item.id, next: to, note }); onChanged() }
    catch (e: any) { toast({ title: 'Cannot change status', description: e?.message ?? 'unknown', variant: 'destructive' }) }
  }
  return (
    <div className="py-3 flex items-center justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{item.title}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {item.categoryLabel && <span className="mr-2">{item.categoryLabel}</span>}
          {item.documentCount > 0 && <span>{item.documentCount} file{item.documentCount === 1 ? '' : 's'}</span>}
          {item.aiCompleteness && (
            <span className={`ml-2 inline-flex items-center gap-1 ${!item.aiCompletenessConfident ? 'text-amber-700' : ''}`}>
              <Sparkles className="h-3 w-3" />
              AI: {item.aiCompleteness}{!item.aiCompletenessConfident ? ' (unconfident)' : ''}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge className={badgeCls}>{item.statusLabel}</Badge>
        <Select value={item.status} onValueChange={v => nextStatus(v)}>
          <SelectTrigger className="w-40 h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="REQUESTED">Requested</SelectItem>
            <SelectItem value="RECEIVED">Received</SelectItem>
            <SelectItem value="NEEDS_CLARIFICATION">Needs clarification</SelectItem>
            <SelectItem value="ACCEPTED">Accepted</SelectItem>
            <SelectItem value="NOT_APPLICABLE">Not applicable</SelectItem>
          </SelectContent>
        </Select>
        {item.documentCount > 0 && (
          <Button size="sm" variant="ghost" title="Run AI completeness check"
            onClick={async () => {
              try {
                const r = await runRequestCompletenessCheck({ requestItemId: item.id })
                toast({ title: `AI: ${r.verdict}`, description: r.reason + (r.isConfident ? '' : ' (unconfident — needs human)') })
                onChanged()
              } catch (e: any) {
                toast({ title: 'AI check failed', description: e?.message ?? 'unknown', variant: 'destructive' })
              }
            }}>
            <Sparkles className="h-3 w-3" />
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => deleteRequestItem({ id: item.id }).then(onChanged)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

function AddContactRow({ caseId, onAdded }: { caseId: string; onAdded: () => void }) {
  const [name, setName]   = React.useState('')
  const [email, setEmail] = React.useState('')
  const { toast } = useToast()
  return (
    <div className="flex flex-col md:flex-row gap-2">
      <Input placeholder="Client name" value={name} onChange={e => setName(e.target.value)} />
      <Input placeholder="client@example.com" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      <Button size="sm" onClick={async () => {
        try {
          await addClientContact({ caseId, name, email })
          setName(''); setEmail(''); onAdded()
        } catch (e: any) {
          toast({ title: 'Could not add contact', description: e?.message ?? 'unknown', variant: 'destructive' })
        }
      }}>
        <Plus className="h-3 w-3 mr-1" /> Add contact
      </Button>
    </div>
  )
}
