import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  FilePlus, 
  Search,
  ArrowRight,
  Users,
  Briefcase
} from "lucide-react"
import Link from "next/link"
import { Input } from "@/components/ui/input"

export default function ProjectsPage() {
  const projects = [
    { id: "1", name: "Smith vs. Smith Valuation", client: "Mark Smith", status: "In Progress", date: "Oct 24, 2024", type: "Family Law" },
    { id: "2", name: "Johnson Logistics Group", client: "Eduardo Johnson", status: "Completed", date: "Oct 23, 2024", type: "M&A" },
    { id: "3", name: "Apex Realty Appraisal", client: "Sarah Apex", status: "Needs Review", date: "Oct 21, 2024", type: "Estate Tax" },
    { id: "4", name: "Quantum Tech IP Audit", client: "Dr. Aris Quantum", status: "Active", date: "Oct 19, 2024", type: "Litigation" },
  ]

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-semibold font-headline text-primary">All Projects</h1>
          </div>
          <Button className="bg-accent hover:bg-accent/90">
            <FilePlus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </header>
        
        <main className="flex-1 space-y-6 p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-10 h-10 w-full max-w-md" placeholder="Search by name, client, or type..." />
            </div>
            <Button variant="outline">Filter</Button>
          </div>

          <div className="grid gap-4">
            {projects.map((project) => (
              <Card key={project.id} className="hover:border-accent transition-colors group">
                <CardContent className="p-0">
                  <div className="flex items-center justify-between p-6">
                    <div className="flex items-center gap-4">
                      <div className="bg-primary/10 p-3 rounded-lg">
                        <Briefcase className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg text-primary">{project.name}</h3>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {project.client}</span>
                          <span>•</span>
                          <span>{project.type}</span>
                          <span>•</span>
                          <span>{project.date}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        project.status === "Completed" ? "bg-green-100 text-green-700" :
                        project.status === "Needs Review" ? "bg-orange-100 text-orange-700" :
                        "bg-blue-100 text-blue-700"
                      }`}>
                        {project.status}
                      </span>
                      <Link href={`/projects/${project.id}`}>
                        <Button variant="ghost" className="group-hover:translate-x-1 transition-transform">
                          Open Project
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
