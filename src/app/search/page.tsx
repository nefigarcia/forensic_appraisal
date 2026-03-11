import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search as SearchIcon, Sparkles } from "lucide-react"

export default function SearchPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center px-6 border-b bg-white">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-semibold font-headline text-primary">Smart Search</h1>
          </div>
        </header>
        
        <main className="flex-1 p-8 max-w-4xl mx-auto w-full">
          <div className="text-center space-y-4 mb-12">
            <h2 className="text-3xl font-bold text-primary">Intelligent Discovery</h2>
            <p className="text-muted-foreground">Search through all project documents using natural language.</p>
          </div>

          <div className="relative mb-8">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input 
              className="pl-12 h-14 text-lg rounded-xl shadow-sm border-primary/20 focus:ring-primary" 
              placeholder="e.g., 'Find all tax returns with revenue over $1M' or 'Show me the Smith case agreement'" 
            />
            <Button className="absolute right-2 top-2 h-10 bg-accent hover:bg-accent/90">
              <Sparkles className="mr-2 h-4 w-4" />
              Ask AI
            </Button>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Recent Queries</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {["2023 Revenue trends in Florida", "Shareholder buyout clauses", "Johnson case financials"].map(q => (
                  <Button key={q} variant="ghost" className="w-full justify-start text-xs font-normal">
                    <SearchIcon className="mr-2 h-3 w-3 opacity-50" />
                    {q}
                  </Button>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Search Tips</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-2">
                <p>• Use quotes for exact matches</p>
                <p>• Filter by date using "after 2023" or "last week"</p>
                <p>• Ask for specific document types like "Find PDF files"</p>
              </CardContent>
            </Card>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
