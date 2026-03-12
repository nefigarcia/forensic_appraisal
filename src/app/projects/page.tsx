import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  FilePlus, 
  Search,
  ArrowRight,
  Users,
  Briefcase,
  Filter,
  Download,
  Calendar
} from "lucide-react"
import Link from "next/link"
import { Input } from "@/components/ui/input"

export default function ProjectsPage() {
  const projects = [
    { id: "1", name: "Global Logistics Group Valuation", client: "Preston & Reed LLP", status: "In Progress", date: "Oct 24, 2024", type: "M&A Advisory" },
    { id: "2", name: "Marital Asset Audit - Smith", client: "Family Court Florida", status: "Completed", date: "Oct 23, 2024", type: "Family Law" },
    { id: "3", name: "Apex Realty Forensic Audit", client: "Federal Trade Comm.", status: "Review", date: "Oct 21, 2024", type: "Regulatory" },
    { id: "4", name: "Quantum Tech IP Audit", client: "Dr. Aris Quantum", status: "Active", date: "Oct 19, 2024", type: "Litigation" },
    { id: "5", name: "Sunshine Solar Estate", client: "Bank of America", status: "Active", date: "Oct 18, 2024", type: "Estate Tax" },
  ]

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white shadow-sm">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-bold font-headline text-foreground tracking-tight">Active Valuations</h1>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export Catalog
            </Button>
            <Button size="sm" className="bg-primary hover:bg-primary/90">
              <FilePlus className="mr-2 h-4 w-4" />
              New Valuation
            </Button>
          </div>
        </header>
        
        <main className="flex-1 space-y-6 p-8 max-w-7xl mx-auto w-full">
          <div className="flex flex-col sm:flex-row items-center gap-4 mb-8">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-10 h-10 w-full border-none shadow-sm bg-white" placeholder="Search cases by client, type, or matter name..." />
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button variant="outline" className="bg-white border-none shadow-sm flex-1 sm:flex-none">
                <Filter className="mr-2 h-4 w-4" />
                Filter
              </Button>
              <Button variant="outline" className="bg-white border-none shadow-sm flex-1 sm:flex-none">
                <Calendar className="mr-2 h-4 w-4" />
                Date Range
              </Button>
            </div>
          </div>

          <div className="grid gap-4">
            {projects.map((project) => (
              <Card key={project.id} className="border-none shadow-sm hover:ring-2 hover:ring-primary/20 transition-all group overflow-hidden bg-white">
                <CardContent className="p-0">
                  <div className="flex flex-col md:flex-row md:items-center justify-between p-6">
                    <div className="flex items-center gap-5">
                      <div className="bg-primary/5 p-4 rounded-xl hidden sm:block">
                        <Briefcase className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-lg text-primary tracking-tight">{project.name}</h3>
                          <span className="text-[10px] bg-muted px-2 py-0.5 rounded font-bold text-muted-foreground uppercase tracking-wider">{project.type}</span>
                        </div>
                        <div className="flex items-center gap-4 text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">
                          <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {project.client}</span>
                          <span>•</span>
                          <span>{project.date}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between md:justify-end gap-6 mt-4 md:mt-0 pt-4 md:pt-0 border-t md:border-t-0">
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${
                        project.status === "Completed" ? "bg-green-100 text-green-700" :
                        project.status === "Review" ? "bg-orange-100 text-orange-700" :
                        "bg-blue-100 text-blue-700"
                      }`}>
                        {project.status}
                      </span>
                      <Link href={`/projects/${project.id}`}>
                        <Button variant="ghost" className="font-bold uppercase text-[10px] tracking-widest group-hover:translate-x-1 transition-transform">
                          Open Matter
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}