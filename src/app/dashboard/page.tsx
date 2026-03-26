
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import {
  FilePlus, Clock, CheckCircle2, AlertCircle, ArrowRight,
  Users, Briefcase, Zap, BarChart2, Lightbulb, AlertTriangle,
  ShieldCheck, FileCheck, TrendingUp,
} from "lucide-react"
import Link from "next/link"
import { getCases } from "@/app/actions/cases"
import { formatDistanceToNow } from "date-fns"
import { cn } from "@/lib/utils"

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

function getInsightIcon(type: string) {
  switch (type) {
    case 'ANOMALY':     return <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
    case 'WARNING':     return <AlertCircle   className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
    case 'SUGGESTION':  return <Lightbulb     className="h-3.5 w-3.5 text-blue-300 shrink-0 mt-0.5" />
    case 'COMPLETION':  return <CheckCircle2  className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
    default:            return <Lightbulb     className="h-3.5 w-3.5 text-white/40 shrink-0 mt-0.5" />
  }
}

const statusColors: Record<string, string> = {
  ACTIVE:   'bg-emerald-100 text-emerald-700',
  REVIEW:   'bg-amber-100   text-amber-700',
  CLOSED:   'bg-slate-100   text-slate-600',
  ARCHIVED: 'bg-slate-100   text-slate-500',
}

export default async function Dashboard() {
  const cases = await getCases()

  const totalAnomalies  = cases.reduce((s, c) => s + c._count.anomalyFlags, 0)
  const pendingReview   = cases.filter(c => c.status === 'REVIEW').length
  const avgCompleteness = cases.length > 0
    ? Math.round(cases.reduce((s, c) => s + getCaseCompleteness(c), 0) / cases.length)
    : 0

  const allInsights = cases.flatMap(c =>
    c.insights.map((i: any) => ({ ...i, caseName: c.name, caseId: c.id }))
  ).slice(0, 6)

  const kpiData = [
    {
      title: 'Active Cases',
      value: cases.length.toString(),
      sub: 'All engagements',
      icon: Briefcase,
      accent: 'bg-primary/5 border-primary/10',
      iconColor: 'text-primary',
      bar: 'bg-primary',
    },
    {
      title: 'Avg Completeness',
      value: `${avgCompleteness}%`,
      sub: 'Across all cases',
      icon: FileCheck,
      accent: 'bg-emerald-50 border-emerald-100',
      iconColor: 'text-emerald-600',
      bar: 'bg-emerald-500',
    },
    {
      title: 'Open Anomaly Flags',
      value: totalAnomalies.toString(),
      sub: 'Requires investigation',
      icon: AlertTriangle,
      accent: 'bg-orange-50 border-orange-100',
      iconColor: 'text-orange-500',
      bar: 'bg-orange-400',
    },
    {
      title: 'Pending Review',
      value: pendingReview.toString(),
      sub: 'Needs sign-off',
      icon: Clock,
      accent: 'bg-amber-50 border-amber-100',
      iconColor: 'text-amber-500',
      bar: 'bg-amber-400',
    },
  ]

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white shadow-sm z-10">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <div>
              <h1 className="text-lg font-black text-foreground tracking-tight leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
                Engagement Dashboard
              </h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold hidden sm:block">
                {cases.length} active engagement{cases.length !== 1 ? 's' : ''} · {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          </div>
          <Link href="/projects">
            <Button size="sm" className="bg-primary hover:bg-primary/90 shadow-sm font-bold text-[11px] uppercase tracking-wider gap-2">
              <FilePlus className="h-4 w-4" />
              New Valuation
            </Button>
          </Link>
        </header>

        <main className="flex-1 space-y-7 p-6 lg:p-8 max-w-7xl mx-auto w-full">

          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpiData.map((kpi) => (
              <div key={kpi.title} className={cn('rounded-2xl border p-5 bg-white relative overflow-hidden shadow-sm', kpi.accent)}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{kpi.title}</p>
                  <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center', kpi.accent)}>
                    <kpi.icon className={cn('h-4 w-4', kpi.iconColor)} />
                  </div>
                </div>
                <p className="text-3xl font-black tracking-tight text-foreground">{kpi.value}</p>
                <p className="text-[10px] text-muted-foreground mt-1 font-medium uppercase tracking-wide">{kpi.sub}</p>
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-muted">
                  <div className={cn('h-full', kpi.bar)} style={{ width: `${Math.min(parseInt(kpi.value) * 10, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-7">

            {/* Case List */}
            <Card className="lg:col-span-4 border border-border/50 shadow-sm bg-white rounded-2xl overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between px-6 pt-5 pb-4 border-b border-border/30">
                <div>
                  <CardTitle className="text-base font-black tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
                    Ongoing Valuations
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">Completeness score &amp; anomaly flags per engagement</CardDescription>
                </div>
                <Link href="/projects">
                  <Button variant="ghost" size="sm" className="text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary gap-1">
                    View All <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent className="p-4 space-y-2">
                {cases.slice(0, 5).map(project => {
                  const pct   = getCaseCompleteness(project)
                  const flags = project._count.anomalyFlags
                  const statusCls = statusColors[project.status] ?? statusColors.ACTIVE
                  return (
                    <Link key={project.id} href={`/projects/${project.id}`}>
                      <div className="flex items-center gap-4 px-4 py-3.5 rounded-xl border border-transparent hover:border-primary/20 hover:bg-primary/[0.02] transition-all group cursor-pointer">
                        {/* completeness dot */}
                        <div className={cn(
                          'w-1.5 h-10 rounded-full shrink-0',
                          pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-rose-400'
                        )} />

                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-primary text-sm truncate group-hover:text-accent transition-colors leading-tight">
                              {project.name}
                            </span>
                            {flags > 0 && (
                              <Badge className="bg-orange-100 text-orange-700 text-[9px] font-bold shrink-0 border-0 px-1.5">
                                {flags} flag{flags > 1 ? 's' : ''}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                            <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {project.client}</span>
                            <span className="text-border">·</span>
                            <span>{formatDistanceToNow(new Date(project.createdAt))} ago</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Progress value={pct} className="h-1 flex-1" />
                            <span className={cn(
                              'text-[10px] font-black shrink-0 w-8 text-right',
                              pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-rose-600'
                            )}>{pct}%</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className={cn('text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full', statusCls)}>
                            {project.status}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                    </Link>
                  )
                })}
                {cases.length === 0 && (
                  <div className="text-center py-16 text-muted-foreground text-sm space-y-3">
                    <Briefcase className="h-10 w-10 mx-auto text-muted-foreground/30" />
                    <p>No active cases. <Link href="/projects" className="text-primary font-bold hover:underline">Create one</Link> to get started.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Right column */}
            <div className="lg:col-span-3 space-y-5">

              {/* AI Insights */}
              <div className="rounded-2xl overflow-hidden shadow-sm" style={{ background: 'linear-gradient(160deg, #0B2046 0%, #070f24 100%)' }}>
                <div className="px-5 pt-5 pb-3 border-b border-white/8">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-[#F0A80E] fill-[#F0A80E]" />
                    <p className="text-sm font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
                      Proactive AI Insights
                    </p>
                  </div>
                  <p className="text-[10px] text-white/45 mt-1 font-medium">AI-generated alerts across all active cases</p>
                </div>
                <div className="p-4 space-y-2">
                  {allInsights.length === 0 ? (
                    <div className="rounded-xl bg-white/6 border border-white/8 p-4 text-xs text-white/55 leading-relaxed">
                      No insights yet. Open a case and click <span className="text-white/80 font-semibold">Refresh Insights</span> in the Report tab.
                    </div>
                  ) : (
                    allInsights.map((insight: any) => (
                      <Link key={insight.id} href={`/projects/${insight.caseId}?tab=report`}>
                        <div className="rounded-xl bg-white/6 border border-white/8 p-3 hover:bg-white/10 hover:border-white/14 transition-all cursor-pointer group">
                          <div className="flex items-start gap-2.5">
                            {getInsightIcon(insight.type)}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-white leading-snug group-hover:text-[#F0A80E] transition-colors">{insight.title}</p>
                              <p className="text-[10px] text-white/50 mt-0.5 leading-relaxed line-clamp-2">{insight.body}</p>
                              <p className="text-[9px] text-white/30 mt-1 uppercase font-bold tracking-wide">{insight.caseName}</p>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </div>

              {/* System Status */}
              <Card className="border border-border/50 shadow-sm bg-white rounded-2xl">
                <CardHeader className="px-5 pt-4 pb-3 border-b border-border/30">
                  <CardTitle className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                    System Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {[
                    { label: 'AI Extraction Engine',  status: 'Operational', ok: true },
                    { label: 'Anomaly Detection',      status: 'Operational', ok: true },
                    { label: 'Audit Log',              status: 'Active',      ok: true },
                    { label: 'Secure Storage',         status: 'Connected',   ok: true },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-medium">{item.label}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={cn('w-1.5 h-1.5 rounded-full', item.ok ? 'bg-emerald-500' : 'bg-red-500')} />
                        <span className={cn('text-[10px] font-bold uppercase tracking-wide', item.ok ? 'text-emerald-600' : 'text-red-600')}>
                          {item.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Case completeness grid */}
          {cases.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-black text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                  Case Completeness Overview
                </h2>
                <TrendingUp className="h-4 w-4 text-muted-foreground/40" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cases.map(project => {
                  const pct = getCaseCompleteness(project)
                  const items = [
                    { label: 'Documents',     done: project._count.documents > 0 },
                    { label: 'Extracted',     done: project._count.financialData > 0 },
                    { label: 'Add-backs',     done: project._count.addBacks > 0 },
                    { label: 'Valuation',     done: project._count.valuationModels > 0 },
                    { label: 'Std of Value',  done: !!project.standardOfValue },
                    { label: 'Purpose',       done: !!project.purposeOfValue },
                  ]
                  return (
                    <Link key={project.id} href={`/projects/${project.id}`}>
                      <Card className="border border-border/50 shadow-sm bg-white hover:shadow-md hover:border-primary/20 transition-all cursor-pointer rounded-2xl group">
                        <CardContent className="p-5 space-y-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-bold text-sm text-primary line-clamp-1 group-hover:text-accent transition-colors leading-tight">{project.name}</p>
                              <p className="text-[10px] text-muted-foreground uppercase font-medium mt-0.5 tracking-wide">{project.client}</p>
                            </div>
                            <span className={cn(
                              'text-xl font-black shrink-0 leading-none mt-0.5',
                              pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-rose-600'
                            )}>{pct}%</span>
                          </div>
                          <Progress value={pct} className="h-1.5" />
                          <div className="grid grid-cols-3 gap-1.5">
                            {items.map(item => (
                              <div key={item.label} className="flex items-center gap-1">
                                {item.done
                                  ? <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                  : <AlertCircle  className="h-3 w-3 text-muted-foreground/30 shrink-0" />}
                                <span className="text-[9px] uppercase font-bold text-muted-foreground truncate tracking-wide">{item.label}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
