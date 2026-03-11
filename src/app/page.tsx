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
  Database
} from "lucide-react"
import Link from "next/link"

export default function Dashboard() {
  const recentProjects = [
    { id: "1", name: "Smith vs. Smith Valuation", client: "Mark Smith", status: "In Progress", date: "2 hours ago" },
    { id: "2", name: "Johnson Logistics Group", client: "Eduardo Johnson", status: "Completed", date: "1 day ago" },
    { id: "3", name: "Apex Realty Appraisal", client: "Sarah Apex", status: "Needs Review", date: "3 days ago" },
  ]

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-semibold font-headline text-primary">Workspace Dashboard</h1>
          </div>
          <div className="flex items-center gap-4">
            <Button className="bg-accent hover:bg-accent/90">
              <FilePlus className="mr-2 h-4 w-4" />
              New Appraisal
            </Button>
          </div>
        </header>
        
        <main className="flex-1 space-y-8 p-8">
          {/* Stats Grid */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Card className="border-l-4 border-l-primary">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Appraisals</CardTitle>
                <TrendingUp className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">12</div>
                <p className="text-xs text-muted-foreground">+2 from last week</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-accent">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Extraction Accuracy</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-accent" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">98.4%</div>
                <p className="text-xs text-muted-foreground">Based on last 500 pages</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-orange-500">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Pending Review</CardTitle>
                <Clock className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">4</div>
                <p className="text-xs text-muted-foreground">Requires manual sign-off</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-red-500">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Overdue Tasks</CardTitle>
                <AlertCircle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">2</div>
                <p className="text-xs text-muted-foreground">Critical valuation deadlines</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-7">
            {/* Recent Projects */}
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle className="text-lg font-headline">Recent Valuations</CardTitle>
                <CardDescription>Monitor ongoing appraisal workflows</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentProjects.map((project) => (
                    <div key={project.id} className="flex items-center justify-between p-4 rounded-lg border bg-card/50 hover:bg-card transition-colors group">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-primary">{project.name}</span>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" />
                          <span>{project.client}</span>
                          <span>•</span>
                          <span>{project.date}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          project.status === "Completed" ? "bg-green-100 text-green-700" :
                          project.status === "Needs Review" ? "bg-orange-100 text-orange-700" :
                          "bg-blue-100 text-blue-700"
                        }`}>
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
                </div>
                <Button variant="outline" className="w-full mt-6">View All Projects</Button>
              </CardContent>
            </Card>

            {/* Quick Actions / Integration Status */}
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-lg font-headline">Smart Insights</CardTitle>
                <CardDescription>AI recommendations and status</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-lg bg-primary/5 p-4 border border-primary/10">
                  <h4 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Storage Connections
                  </h4>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">SharePoint (Main)</span>
                    <span className="text-green-600 font-medium">Connected</span>
                  </div>
                  <div className="flex justify-between items-center text-sm mt-2">
                    <span className="text-muted-foreground">OneDrive (Archive)</span>
                    <span className="text-green-600 font-medium">Connected</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-primary">System Tips</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    AI extraction is processing "2023 Tax Return" for the Smith case. Preliminary data suggests a 15% revenue increase from 2022.
                  </p>
                  <Button variant="link" className="p-0 h-auto text-accent text-xs">View full extraction report</Button>
                </div>

                <div className="pt-4 border-t">
                  <h4 className="text-sm font-semibold text-primary mb-3">Industry Hub</h4>
                  <div className="flex flex-wrap gap-2">
                    {["NAICS 4841", "SIC 4213", "NAICS 5411"].map(code => (
                      <span key={code} className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded font-mono border border-accent/20">
                        {code}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">Most searched codes today</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
