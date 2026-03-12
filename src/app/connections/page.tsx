"use client"

import * as React from "react"
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { 
  Database, 
  CheckCircle2, 
  ExternalLink, 
  ShieldCheck, 
  AlertCircle,
  Loader2,
  Lock
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/hooks/use-toast"

type Connector = {
  id: string
  name: string
  status: "Connected" | "Disconnected" | "Active" | "Error"
  sync: string
  type: string
  color: string
}

const initialSources: Connector[] = [
  { id: "sp", name: "SharePoint Online", status: "Connected", sync: "2 mins ago", type: "Custody Storage", color: "bg-green-100 text-green-700" },
  { id: "od", name: "OneDrive Business", status: "Connected", sync: "1 hour ago", type: "Archive Storage", color: "bg-green-100 text-green-700" },
  { id: "iw", name: "IbisWorld API", status: "Active", sync: "Premium Sub", type: "Market Benchmarking", color: "bg-blue-100 text-blue-700" },
  { id: "bvr", name: "BVR DealStats", status: "Error", sync: "Auth Required", type: "Valuation Multiples", color: "bg-red-100 text-red-700" },
]

export default function ConnectionsPage() {
  const [sources, setSources] = React.useState<Connector[]>(initialSources)
  const [selectedSource, setSelectedSource] = React.useState<Connector | null>(null)
  const [isConnecting, setIsConnecting] = React.useState(false)

  const handleConnect = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedSource) return

    setIsConnecting(true)
    // Simulate API Auth flow
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    setSources(prev => prev.map(s => 
      s.id === selectedSource.id 
        ? { ...s, status: "Connected" as const, sync: "Just now", color: "bg-green-100 text-green-700" } 
        : s
    ))

    toast({
      title: "Connection Established",
      description: `ValuVault is now securely synced with ${selectedSource.name}.`,
    })
    
    setIsConnecting(false)
    setSelectedSource(null)
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center px-6 border-b bg-white shadow-sm">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-bold font-headline text-primary tracking-tight">Data Connectors</h1>
          </div>
        </header>
        
        <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
            {sources.map((source) => (
              <Card key={source.id} className="border-none shadow-sm bg-white overflow-hidden group">
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start">
                    <div className="bg-primary/5 p-3 rounded-xl">
                      <Database className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${source.color}`}>
                        {source.status}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4">
                    <CardTitle className="text-lg font-bold text-primary group-hover:text-accent transition-colors">{source.name}</CardTitle>
                    <CardDescription className="text-xs uppercase font-bold tracking-widest text-muted-foreground mt-1">{source.type}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                    {source.status === "Error" ? <AlertCircle className="h-3 w-3 text-red-500" /> : <CheckCircle2 className="h-3 w-3 text-green-500" />}
                    Last sync status: {source.sync}
                  </div>
                </CardContent>
                <CardFooter className="bg-muted/30 pt-4 border-t">
                  <Button 
                    onClick={() => setSelectedSource(source)}
                    variant="ghost" 
                    className="w-full text-[10px] font-bold uppercase tracking-widest h-10 hover:bg-white hover:text-accent"
                  >
                    {source.status === "Error" || source.status === "Disconnected" ? "Sign In & Authorize" : "Manage Connection"}
                    <ExternalLink className="ml-2 h-3.5 w-3.5" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>

          <div className="mt-12 p-10 rounded-2xl border-2 border-dashed border-primary/20 bg-primary/5 text-center">
            <div className="mx-auto bg-white p-4 rounded-full w-16 h-16 flex items-center justify-center shadow-md mb-6">
              <ShieldCheck className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-bold text-xl text-primary tracking-tight">Need Secure Integration?</h3>
            <p className="text-sm text-muted-foreground mt-2 mb-8 max-w-md mx-auto font-medium">
              ValuVault supports enterprise-grade OAuth2 and SSL-encrypted pipelines for over 50+ financial data providers.
            </p>
            <Button className="bg-primary font-bold uppercase text-[11px] tracking-widest px-8 h-12 shadow-lg">Request Custom Connector</Button>
          </div>
        </main>

        <Dialog open={!!selectedSource} onOpenChange={(open) => !open && setSelectedSource(null)}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <div className="flex justify-center mb-4">
                <div className="bg-primary/10 p-4 rounded-full">
                  <Lock className="h-8 w-8 text-primary" />
                </div>
              </div>
              <DialogTitle className="text-center">Secure Sign-In: {selectedSource?.name}</DialogTitle>
              <DialogDescription className="text-center">
                Enter your credentials for {selectedSource?.name} to authorize ValuVault AI access.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleConnect} className="space-y-6 pt-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="vendor-email" className="text-xs font-bold uppercase tracking-widest">Enterprise Email</Label>
                  <Input id="vendor-email" type="email" placeholder="name@organization.com" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendor-pass" className="text-xs font-bold uppercase tracking-widest">Security Credentials</Label>
                  <Input id="vendor-pass" type="password" placeholder="••••••••" required />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isConnecting} className="w-full bg-primary font-bold uppercase text-xs h-12 tracking-widest">
                  {isConnecting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Authenticating...
                    </>
                  ) : "Authorize Connection"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </SidebarProvider>
  )
}
