
'use client';

import * as React from "react"
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
  Calendar,
  Loader2
} from "lucide-react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { getCases, createCase } from "@/app/actions/cases"
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

export default function ProjectsPage() {
  const [projects, setProjects] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [isCreating, setIsCreating] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  const loadProjects = React.useCallback(async () => {
    setLoading(true)
    const data = await getCases()
    setProjects(data)
    setLoading(false)
  }, [])

  React.useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.client.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleCreateCase = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsCreating(true)
    const formData = new FormData(e.currentTarget)
    try {
      await createCase(formData)
      toast({ title: "Success", description: "Valuation case created." })
      setOpen(false)
      loadProjects()
    } catch (err) {
      toast({ title: "Error", description: "Failed to create case.", variant: "destructive" })
    } finally {
      setIsCreating(false)
    }
  }

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
            
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-primary hover:bg-primary/90">
                  <FilePlus className="mr-2 h-4 w-4" />
                  New Valuation
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <form onSubmit={handleCreateCase}>
                  <DialogHeader>
                    <DialogTitle>New Forensic Matter</DialogTitle>
                    <DialogDescription>
                      Initialize a new valuation case in the workspace.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="name" className="text-right">Matter Name</Label>
                      <Input id="name" name="name" className="col-span-3" required />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="client" className="text-right">Client</Label>
                      <Input id="client" name="client" className="col-span-3" required />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="type" className="text-right">Type</Label>
                      <Select name="type" defaultValue="Litigation">
                        <SelectTrigger className="col-span-3">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Litigation">Litigation</SelectItem>
                          <SelectItem value="M&A Advisory">M&A Advisory</SelectItem>
                          <SelectItem value="Estate Tax">Estate Tax</SelectItem>
                          <SelectItem value="Family Law">Family Law</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="manager" className="text-right">Manager</Label>
                      <Input id="manager" name="manager" className="col-span-3" required />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={isCreating}>
                      {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Initialize Case
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </header>
        
        <main className="flex-1 space-y-6 p-8 max-w-7xl mx-auto w-full">
          <div className="flex flex-col sm:flex-row items-center gap-4 mb-8">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                className="pl-10 h-10 w-full border-none shadow-sm bg-white" 
                placeholder="Search cases by client or matter name..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4">
            {loading ? (
              <div className="text-center py-20"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>
            ) : filteredProjects.map((project) => (
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
                          <span>{new Date(project.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between md:justify-end gap-6 mt-4 md:mt-0 pt-4 md:pt-0 border-t md:border-t-0">
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-blue-100 text-blue-700`}>
                        {project.status || 'ACTIVE'}
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
            {!loading && filteredProjects.length === 0 && (
              <div className="text-center py-20 text-muted-foreground">No matters found.</div>
            )}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
