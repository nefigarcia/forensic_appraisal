'use client'

import * as React from "react"
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  FilePlus,
  Search,
  ArrowRight,
  Users,
  Briefcase,
  Download,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
} from "lucide-react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { getCases, createCase } from "@/app/actions/cases"
import { getBillingInfo } from "@/app/actions/billing-actions"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"

function getCaseCompleteness(c: any): number {
  const checks = [
    c._count.documents > 0,
    c._count.financialData > 0,
    c._count.financialData >= 4,
    c._count.addBacks > 0,
    c._count.valuationModels > 0,
    !!c.standardOfValue,
    !!c.purposeOfValue,
    !!c.valuationDate,
  ]
  return Math.round(checks.filter(Boolean).length / checks.length * 100)
}

const statusColors: Record<string, string> = {
  ACTIVE:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  REVIEW:   'bg-amber-100   text-amber-700   border-amber-200',
  CLOSED:   'bg-slate-100   text-slate-600   border-slate-200',
  ARCHIVED: 'bg-slate-100   text-slate-500   border-slate-200',
}

const typeColors: Record<string, string> = {
  'Litigation':   'text-red-600    bg-red-50    border-red-100',
  'M&A Advisory': 'text-blue-600   bg-blue-50   border-blue-100',
  'Estate Tax':   'text-purple-600 bg-purple-50 border-purple-100',
  'Family Law':   'text-rose-600   bg-rose-50   border-rose-100',
}

export default function ProjectsPage() {
  const [projects, setProjects]   = React.useState<any[]>([])
  const [loading, setLoading]     = React.useState(true)
  const [searchQuery, setSearch]  = React.useState("")
  const [isCreating, setCreating] = React.useState(false)
  const [open, setOpen]           = React.useState(false)
  const [billing, setBilling]     = React.useState<any>(null)

  const loadProjects = React.useCallback(async () => {
    setLoading(true)
    const [data, bill] = await Promise.all([getCases(), getBillingInfo()])
    setProjects(data)
    setBilling(bill)
    setLoading(false)
  }, [])

  React.useEffect(() => { loadProjects() }, [loadProjects])

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.client.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setCreating(true)
    const fd = new FormData(e.currentTarget)
    try {
      await createCase(fd)
      toast({ title: "Case created", description: "Your new valuation case is ready." })
      setOpen(false)
      loadProjects()
    } catch (err: any) {
      toast({ title: "Error", description: err?.message ?? "Failed to create case.", variant: "destructive" })
    } finally {
      setCreating(false)
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white shadow-sm">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <div>
              <h1 className="text-lg font-black text-foreground tracking-tight leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
                Active Valuations
              </h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold hidden sm:block">
                {projects.length} engagement{projects.length !== 1 ? 's' : ''} in workspace
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="hidden sm:flex gap-2 text-xs font-bold border-border/60">
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-primary hover:bg-primary/90 gap-2 shadow-sm font-bold text-[11px] uppercase tracking-wider">
                  <FilePlus className="h-4 w-4" />
                  New Valuation
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[460px]">
                <form onSubmit={handleCreate}>
                  <DialogHeader className="pb-2">
                    <DialogTitle className="font-black" style={{ fontFamily: "'Playfair Display', serif" }}>New Valuation Case</DialogTitle>
                    <DialogDescription className="text-xs">
                      Initialize a new engagement in the forensic workbench.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="name" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Case Name</Label>
                      <Input id="name" name="name" placeholder="Smith v. Jones — Business Interest" className="h-10" required />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="client" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Client</Label>
                        <Input id="client" name="client" placeholder="Plaintiff name" className="h-10" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="manager" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Manager</Label>
                        <Input id="manager" name="manager" placeholder="Lead analyst" className="h-10" required />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="type" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Engagement Type</Label>
                      <Select name="type" defaultValue="Litigation">
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Litigation">Litigation</SelectItem>
                          <SelectItem value="M&A Advisory">M&amp;A Advisory</SelectItem>
                          <SelectItem value="Estate Tax">Estate Tax</SelectItem>
                          <SelectItem value="Family Law">Family Law</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" type="button" onClick={() => setOpen(false)} className="text-xs">Cancel</Button>
                    <Button type="submit" disabled={isCreating} className="gap-2 bg-primary hover:bg-primary/90 font-bold text-[11px] uppercase tracking-wider">
                      {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus className="h-4 w-4" />}
                      Initialize Case
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <main className="flex-1 space-y-5 p-6 lg:p-8 max-w-7xl mx-auto w-full">

          {/* Plan limit banner */}
          {billing && billing.casesLimit !== 999999 && (() => {
            const pct     = Math.round((billing.caseCount / billing.casesLimit) * 100)
            const atLimit = billing.caseCount >= billing.casesLimit
            const near    = !atLimit && pct >= 80
            if (!near && !atLimit) return null
            return (
              <div className={cn(
                'rounded-xl px-5 py-3.5 flex items-center justify-between gap-4 text-sm font-medium border',
                atLimit ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'
              )}>
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="text-xs font-semibold">
                    {atLimit
                      ? `Case limit reached — ${billing.caseCount}/${billing.casesLimit} on the ${billing.plan} plan. Upgrade to create more cases.`
                      : `Approaching limit — ${billing.caseCount}/${billing.casesLimit} cases on the ${billing.plan} plan.`}
                  </span>
                </div>
                <a href="/settings/billing" className="shrink-0 text-[10px] font-black uppercase tracking-widest underline underline-offset-2">Upgrade Plan</a>
              </div>
            )
          })()}

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
            <Input
              className="pl-10 h-11 bg-white border-border/60 shadow-sm text-sm"
              placeholder="Search by case name or client…"
              value={searchQuery}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Case cards */}
          <div className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-24 space-y-4">
                <Briefcase className="h-12 w-12 mx-auto text-muted-foreground/25" />
                <div>
                  <p className="text-sm font-bold text-muted-foreground">
                    {searchQuery ? 'No cases match your search' : 'No cases yet'}
                  </p>
                  {!searchQuery && (
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      Click <span className="font-bold">New Valuation</span> to create your first engagement.
                    </p>
                  )}
                </div>
              </div>
            ) : filtered.map((project) => {
              const pct   = getCaseCompleteness(project)
              const flags = project._count.anomalyFlags
              const docs  = project._count.documents
              const typeCls   = typeColors[project.type]   ?? 'text-slate-600 bg-slate-50 border-slate-100'
              const statusCls = statusColors[project.status] ?? statusColors.ACTIVE
              return (
                <Card key={project.id} className="border border-border/50 shadow-sm hover:shadow-md hover:border-primary/20 transition-all group bg-white rounded-2xl overflow-hidden">
                  <CardContent className="p-0">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-0">

                      {/* color bar */}
                      <div className={cn(
                        'w-full sm:w-1.5 h-1.5 sm:h-auto self-stretch rounded-t-2xl sm:rounded-l-2xl sm:rounded-tr-none shrink-0',
                        pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-rose-400'
                      )} />

                      <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5">
                        {/* left info */}
                        <div className="flex items-start gap-4 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-center shrink-0 hidden sm:flex">
                            <Briefcase className="h-5 w-5 text-primary/60" />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-bold text-base text-primary tracking-tight group-hover:text-accent transition-colors leading-tight truncate">
                                {project.name}
                              </h3>
                              <span className={cn('text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border', typeCls)}>
                                {project.type}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-medium uppercase tracking-wide flex-wrap">
                              <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {project.client}</span>
                              <span className="text-border">·</span>
                              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDistanceToNow(new Date(project.createdAt))} ago</span>
                              <span className="text-border">·</span>
                              <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> {docs} doc{docs !== 1 ? 's' : ''}</span>
                              {flags > 0 && (
                                <>
                                  <span className="text-border">·</span>
                                  <span className="flex items-center gap-1 text-orange-600 font-bold">
                                    <AlertTriangle className="h-3 w-3" /> {flags} flag{flags > 1 ? 's' : ''}
                                  </span>
                                </>
                              )}
                            </div>
                            {/* completeness bar */}
                            <div className="flex items-center gap-2 max-w-xs">
                              <Progress value={pct} className="h-1 flex-1" />
                              <span className={cn(
                                'text-[10px] font-black w-8 text-right',
                                pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-rose-600'
                              )}>{pct}%</span>
                              {pct >= 80 && <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />}
                            </div>
                          </div>
                        </div>

                        {/* right actions */}
                        <div className="flex items-center gap-3 shrink-0 sm:ml-4">
                          <span className={cn('text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border', statusCls)}>
                            {project.status || 'ACTIVE'}
                          </span>
                          <Link href={`/projects/${project.id}`}>
                            <Button size="sm" variant="ghost" className="h-9 font-bold text-[10px] uppercase tracking-widest group-hover:bg-primary group-hover:text-white transition-all gap-1.5 border border-border/50 group-hover:border-primary">
                              Open
                              <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
