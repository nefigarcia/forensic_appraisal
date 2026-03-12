import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search as SearchIcon, Sparkles, Filter, FileText, ArrowRight } from "lucide-react"

export default function SearchPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center px-6 border-b bg-white shadow-sm">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-bold font-headline text-primary tracking-tight">Discovery Search</h1>
          </div>
        </header>
        
        <main className="flex-1 p-8 max-w-4xl mx-auto w-full">
          <div className="text-center space-y-4 mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold uppercase tracking-widest mb-2">
              <Sparkles className="h-3 w-3 fill-accent" />
              AI-Powered Forensic Discovery
            </div>
            <h2 className="text-4xl font-bold text-primary tracking-tighter">Deep Archive Intelligence</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto font-medium">Search across all Matter binders using natural legal and accounting language.</p>
          </div>

          <div className="relative mb-12">
            <div className="absolute left-6 top-1/2 -translate-y-1/2 h-6 w-6 text-primary/40">
              <SearchIcon />
            </div>
            <Input 
              className="pl-16 h-18 text-xl rounded-2xl shadow-xl border-none bg-white focus:ring-2 focus:ring-accent transition-all py-8" 
              placeholder="e.g., 'Find all S-Corp distributions over $50k in the Smith case'" 
            />
            <Button className="absolute right-3 top-3 h-12 bg-primary hover:bg-primary/90 rounded-xl px-8 font-bold uppercase text-xs tracking-widest">
              <Sparkles className="mr-2 h-4 w-4 fill-accent text-accent" />
              Execute Discovery
            </Button>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card className="border-none shadow-sm bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Recent Deep Scans</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {[
                  "2023 Revenue trends in Florida region",
                  "Operating agreement buyout clauses",
                  "Johnson case tax variances > 10%",
                  "Cold-chain transport multipliers"
                ].map(q => (
                  <Button key={q} variant="ghost" className="w-full justify-start text-[11px] font-bold text-primary h-10 hover:bg-accent/5">
                    <SearchIcon className="mr-3 h-3.5 w-3.5 opacity-40" />
                    {q}
                    <ArrowRight className="ml-auto h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Button>
                ))}
              </CardContent>
            </Card>
            
            <Card className="border-none shadow-sm bg-muted/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Filter Intelligence</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <div className="flex flex-wrap gap-2">
                  {["Date: Last 12m", "Type: Tax Return", "Client: Preston", "Confidence: >90%"].map(tag => (
                    <Badge key={tag} variant="secondary" className="bg-white border-none shadow-sm px-3 py-1 font-bold text-[10px] uppercase tracking-wide">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="p-4 bg-white/50 rounded-xl border border-border/50">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-primary mb-2">Discovery Tip</h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                    Try searching for specific ledger patterns, like "unusual cash withdrawals between Dec 20-30 across all retail cases".
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}