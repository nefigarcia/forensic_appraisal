'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UserPlus, Loader2, RefreshCw, UserX, Shield } from 'lucide-react'
import {
  getCaseMembers,
  addCaseMember,
  removeCaseMember,
  changeCaseMemberRole,
} from '@/app/actions/case-team'
import { CASE_ROLES, CASE_ROLE_LABEL, type CaseRole } from '@/lib/case-team/roles'
import { useToast } from '@/hooks/use-toast'

interface Member {
  id: string
  userId: string
  userEmail: string | null
  userName: string | null
  caseRole: CaseRole
  caseRoleLabel: string
  addedAt: string | Date
  removedAt: string | Date | null
}

const CASE_ROLE_CLS: Record<CaseRole, string> = {
  ENGAGEMENT_PARTNER:    'bg-primary text-white',
  MANAGER:               'bg-blue-100 text-blue-800',
  SENIOR:                'bg-indigo-100 text-indigo-800',
  ANALYST:               'bg-slate-100 text-slate-700',
  REVIEWER:              'bg-amber-100 text-amber-800',
  READ_ONLY:             'bg-muted text-muted-foreground',
  EXTERNAL_COLLABORATOR: 'bg-orange-100 text-orange-800',
}

export function CaseTeamPanel({ caseId }: { caseId: string }) {
  const [members, setMembers] = React.useState<Member[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy]       = React.useState<string | null>(null)
  const { toast } = useToast()

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const rows = await getCaseMembers(caseId)
      setMembers(rows as any)
    } catch (e: any) {
      toast({ title: 'Could not load team', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [caseId, toast])

  React.useEffect(() => { load() }, [load])

  async function remove(memberId: string) {
    if (!confirm('Remove this member from the engagement team? They will lose access to the case.')) return
    setBusy(memberId)
    try {
      await removeCaseMember({ caseId, memberId })
      toast({ title: 'Member removed' })
      await load()
    } catch (e: any) {
      toast({ title: 'Remove failed', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function changeRole(memberId: string, caseRole: string) {
    setBusy(memberId)
    try {
      await changeCaseMemberRole({ caseId, memberId, caseRole })
      toast({ title: 'Role updated' })
      await load()
    } catch (e: any) {
      toast({ title: 'Role change failed', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally { setBusy(null) }
  }

  const active = (members ?? []).filter(m => !m.removedAt)

  return (
    <Card className="border-none shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-sm uppercase tracking-widest font-bold text-primary flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Engagement Team
          </CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">
            When members are added, only listed members plus org administrators can access this case.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={load}>
            {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <AddMemberDialog caseId={caseId} onAdded={load} />
        </div>
      </CardHeader>
      <CardContent>
        {members === null ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin h-5 w-5 text-muted-foreground" /></div>
        ) : active.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            No members yet. This case is still whole-org accessible until you add the first member.
          </div>
        ) : (
          <div className="divide-y">
            {active.map(m => (
              <div key={m.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-primary truncate">{m.userName ?? m.userEmail ?? m.userId}</div>
                  {m.userEmail && <div className="text-[10px] text-muted-foreground truncate">{m.userEmail}</div>}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Added {new Date(m.addedAt).toLocaleDateString()}
                  </div>
                </div>
                <Select value={m.caseRole} onValueChange={(v) => changeRole(m.id, v)} disabled={busy === m.id}>
                  <SelectTrigger className={`h-7 w-40 text-[10px] uppercase font-bold tracking-widest ${CASE_ROLE_CLS[m.caseRole]}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CASE_ROLES.map(r => (
                      <SelectItem key={r} value={r}>{CASE_ROLE_LABEL[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(m.id)} disabled={busy === m.id} title="Remove from team">
                  {busy === m.id ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AddMemberDialog({ caseId, onAdded }: { caseId: string; onAdded: () => void | Promise<void> }) {
  const [open, setOpen] = React.useState(false)
  const [userId, setUserId] = React.useState('')
  const [role, setRole] = React.useState<CaseRole>('ANALYST')
  const [busy, setBusy] = React.useState(false)
  const { toast } = useToast()

  async function submit() {
    if (!userId.trim()) return
    setBusy(true)
    try {
      const r = await addCaseMember({ caseId, userId: userId.trim(), caseRole: role })
      toast({
        title: 'Member added',
        description: r.flippedEngagementTeam
          ? 'Engagement team enforcement is now active for this case.'
          : undefined,
      })
      setOpen(false)
      setUserId('')
      await onAdded()
    } catch (e: any) {
      toast({ title: 'Add failed', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="h-3.5 w-3.5 mr-1" /> Add member
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add engagement-team member</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          User must belong to your organization. If this is the first member added to this case,
          case-level access will become restricted to the team plus org administrators.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold">User ID</label>
            <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="user-id-cuid" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold">Role</label>
            <Select value={role} onValueChange={(v) => setRole(v as CaseRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CASE_ROLES.map(r => <SelectItem key={r} value={r}>{CASE_ROLE_LABEL[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <Button onClick={submit} disabled={busy || !userId.trim()}>
            {busy && <Loader2 className="animate-spin h-3.5 w-3.5 mr-2" />}
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
