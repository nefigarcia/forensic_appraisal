import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Database, CheckCircle2, RefreshCcw, ExternalLink } from "lucide-react"

export default function ConnectionsPage() {
  const sources = [
    { name: "SharePoint", status: "Connected", sync: "2 mins ago", type: "Storage" },
    { name: "OneDrive", status: "Connected", sync: "1 hour ago", type: "Storage" },
    { name: "IbisWorld", status: "Active", sync: "Subscription", type: "Market Data" },
    { name: "BVR", status: "Disconnected", sync: "Manual", type: "Market Data" },
  ]

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center px-6 border-b bg-white">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-semibold font-headline text-primary">External Connections</h1>
          </div>
        </header>
        
        <main className="flex-1 p-8">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sources.map((source) => (
              <Card key={source.name} className={source.status === "Disconnected" ? "opacity-70" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div className="bg-muted p-2 rounded-md">
                      <Database className="h-5 w-5 text-primary" />
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${
                      source.status === "Connected" || source.status === "Active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}>
                      {source.status}
                    </span>
                  </div>
                  <CardTitle className="text-lg mt-4">{source.name}</CardTitle>
                  <CardDescription>{source.type}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">Last sync: {source.sync}</p>
                </CardContent>
                <CardFooter className="pt-0">
                  <Button variant="outline" className="w-full text-xs h-8">
                    {source.status === "Disconnected" ? "Connect Now" : "Manage Settings"}
                    <ExternalLink className="ml-2 h-3 w-3" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>

          <div className="mt-12 p-6 rounded-lg border bg-primary/5 border-dashed border-primary/20 text-center">
            <h3 className="font-semibold text-primary">Need another integration?</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">We support over 50+ data sources and storage providers.</p>
            <Button variant="secondary">Request New Connector</Button>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
