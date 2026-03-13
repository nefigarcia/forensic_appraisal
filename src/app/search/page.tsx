
'use client';

import * as React from "react"
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search as SearchIcon, Sparkles, FileText, ArrowRight, Loader2 } from "lucide-react"
import { searchCases } from "@/app/actions/cases"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"

export default function SearchPage() {
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<any[]>([])
  const [isSearching, setIsSearching] = React.useState(false)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query) return
    setIsSearching(true)
    const data = await searchCases(query)
    setResults(data)
    setIsSearching(false)
  }

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
          </div>

          <form onSubmit={handleSearch} className="relative mb-12">
            <div className="absolute left-6 top-1/2 -translate-y-1/2 h-6 w-6 text-primary/40">
              <SearchIcon />
            </div>
            <Input 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-16 h-18 text-xl rounded-2xl shadow-xl border-none bg-white focus:ring-2 focus:ring-accent transition-all py-8" 
              placeholder="e.g., 'Smith Valuation'" 
            />
            <Button type="submit" className="absolute right-3 top-3 h-12 bg-primary hover:bg-primary/90 rounded-xl px-8 font-bold uppercase text-xs tracking-widest" disabled={isSearching}>
              {isSearching ? <Loader2 className="animate-spin h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4 fill-accent text-accent" />}
              Execute Discovery
            </Button>
          </form>

          <div className="space-y-6">
            {results.map((item) => (
              <Card key={item.id} className="border-none shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-bold">{item.name}</CardTitle>
                    <CardDescription>{item.client} • {item.type}</CardDescription>
                  </div>
                  <Link href={`/projects/${item.id}`}>
                    <Button variant="ghost" size="sm">
                      Open Case <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> {item.documents.length} Source Documents</span>
                    <Badge variant="outline">{item.status}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
            {results.length === 0 && !isSearching && query && (
              <div className="text-center py-12 text-muted-foreground">No matches found in the discovery archive.</div>
            )}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
