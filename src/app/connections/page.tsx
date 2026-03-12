import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Database, CheckCircle2, RefreshCcw, ExternalLink, ShieldCheck, AlertCircle } from "lucide-react"

export default function ConnectionsPage() {
  const sources = [
    { name: "SharePoint Online", status: "Connected", sync: "2 mins ago", type: "Custody Storage", color: "bg-green-100 text-green-700" },
    { name: "OneDrive Business", status: "Connected", sync: "1 hour ago", type: "Archive Storage", color: "bg-green-100 text-green-700" },
    { name: "IbisWorld API", status: "Active", sync: "Premium Sub", type: "Market Benchmarking", color: "bg-blue-100 text-blue-700" },
    { name: "BVR DealStats", status: "Error", sync: "Auth Required", type: "Valuation Multiples", color: "bg-red-100 text-red-700" },
  ]

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
              <Card key={source.name} className="border-none shadow-sm bg-white overflow-hidden group">
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
                  <Button variant="ghost" className="w-full text-[10px] font-bold uppercase tracking-widest h-10 hover:bg-white hover:text-accent">
                    {source.status === "Error" ? "Re-Authenticate" : "Manage Connection"}
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
      </SidebarInset>
    </SidebarProvider>
  )
}