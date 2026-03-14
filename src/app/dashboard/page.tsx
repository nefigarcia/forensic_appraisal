
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  FilePlus, 
  Clock, 
  TrendingUp, 
  CheckCircle2, 
  AlertCircle,
  ArrowRight,
  Users,
  Briefcase,
  Zap,
  BarChart2
} from "lucide-react"
import Link from "next/link"
import { getCases } from "@/app/actions/cases"
import { formatDistanceToNow } from "date-fns"

export default async function Dashboard() {
  const cases = await getCases();
  
  const kpiData = [
    { title: "Active Cases", value: cases.length.toString(), sub: "Real-time count", icon: Briefcase, color: "text-primary" },
    { title: "Extraction Accuracy", value: "99.2%", sub: "Verified system-wide", icon: Zap, color: "text-accent" },
    { title: "Pending Review", value: cases.filter(c => c.status === 'REVIEW').length.toString(), sub: "Needs sign-off", icon: Clock, color: "text-orange-500" },
    { title: "Engagements", value: "Active", sub: "Monitoring lifecycle", icon: BarChart2, color: "text-green-500" },
  ]

  const recentValuations = cases.slice(0, 3);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white shadow-sm z-10">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-bold font-headline text-foreground tracking-tight">Engagement Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/projects">
              <Button size="sm" className="bg-primary hover:bg-primary/90">
                <FilePlus className="mr-2 h-4 w-4" />
                New Valuation
              </Button>
            </Link>
          </div>
        </header>
        
        <main className="flex-1 space-y-8 p-8 max-w-7xl mx-auto w-full">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {kpiData.map((kpi) => (
              <Card key={kpi.title} className="border-none shadow-sm bg-white overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-wider">{kpi.title}</CardTitle>
                  <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold tracking-tight">{kpi.value}</div>
                  <p className="text-[10px] font-medium text-muted-foreground mt-1 uppercase">{kpi.sub}</p>
                </CardContent>
                <div className="h-1 bg-muted">
                  <div className={`h-full bg-primary`} style={{ width: '70%' }} />
                </div>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-7">
            <Card className="lg:col-span-4 border-none shadow-sm">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="text-lg font-bold font-headline">Ongoing Valuations</CardTitle>
                    <CardDescription>Track real-time progress of engagement lifecycles</CardDescription>
                  </div>
                  <Link href="/projects">
                    <Button variant="ghost" size="sm" className="text-xs font-semibold uppercase">View All</Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentValuations.map((project) => (
                    <div key={project.id} className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-white hover:border-primary/30 hover:shadow-md transition-all group cursor-pointer">
                      <div className="flex items-center gap-4">
                        <div className={`w-2 h-10 rounded-full bg-primary`} />
                        <div className="flex flex-col gap-1">
                          <span className="font-bold text-primary text-sm group-hover:text-accent transition-colors">{project.name}</span>
                          <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-medium uppercase">
                            <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {project.client}</span>
                            <span>•</span>
                            <span>{formatDistanceToNow(new Date(project.createdAt))} ago</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-blue-100 text-blue-700`}>
                          {project.status}
                        </span>
                        <Link href={`/projects/${project.id}`}>
                          <Button variant="ghost" size="sm" className="group-hover:translate-x-1 transition-transform">
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))}
                  {recentValuations.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground text-sm">No active cases. Create one to get started.</div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-3 border-none shadow-sm bg-primary text-white">
              <CardHeader>
                <CardTitle className="text-lg font-bold font-headline flex items-center gap-2">
                  <Zap className="h-5 w-5 fill-accent text-accent" />
                  Forensic Insights
                </CardTitle>
                <CardDescription className="text-white/60">AI-generated alerts for your workspace</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-xl bg-white/10 p-4 border border-white/10 backdrop-blur-sm">
                  <h4 className="text-xs font-bold uppercase tracking-widest mb-3 text-white/80">System Status</h4>
                  <p className="text-sm leading-relaxed font-medium">
                    All AI extraction nodes are operational. Forensic ledger sync is real-time across your workspace.
                  </p>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-white/80">Benchmark Updates</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                      <div className="text-lg font-bold">12.4%</div>
                      <div className="text-[10px] opacity-60 uppercase">Avg Multiplier (SaaS)</div>
                    </div>
                    <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                      <div className="text-lg font-bold">8.1x</div>
                      <div className="text-[10px] opacity-60 uppercase">Avg EBITDA (Mfg)</div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <Link href="/knowledge-base">
                    <Button className="w-full bg-white text-primary hover:bg-white/90 font-bold uppercase text-xs tracking-widest">
                      Open Knowledge Base
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
