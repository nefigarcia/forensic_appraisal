import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { UserPlus, Mail, Shield, ShieldCheck, MoreVertical } from "lucide-react"

export default function TeamPage() {
  const members = [
    { name: "Sarah Jenkins, CPA", role: "Principal Appraiser", email: "sarah@valuvault.ai", status: "Admin", avatar: "SJ" },
    { name: "Jane Smith", role: "Senior Financial Analyst", email: "jane@valuvault.ai", status: "Editor", avatar: "JS" },
    { name: "Mike Johnson", role: "Forensic Auditor", email: "mike@valuvault.ai", status: "Editor", avatar: "MJ" },
    { name: "David Wong", role: "Junior Analyst", email: "david@valuvault.ai", status: "Viewer", avatar: "DW" },
  ]

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white shadow-sm">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-bold font-headline text-primary tracking-tight">Engagement Team</h1>
          </div>
          <Button className="bg-accent hover:bg-accent/90 font-bold uppercase text-[10px] tracking-widest h-10 px-6 shadow-sm">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite Analyst
          </Button>
        </header>
        
        <main className="flex-1 p-8 max-w-5xl mx-auto w-full">
          <Card className="border-none shadow-sm overflow-hidden bg-white">
            <CardHeader className="border-b py-6">
              <CardTitle className="text-lg font-bold font-headline">Workspace Members</CardTitle>
              <CardDescription className="text-xs">Manage matter-level access and forensic auditing permissions</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {members.map((member) => (
                  <div key={member.email} className="flex items-center justify-between p-6 hover:bg-muted/30 transition-colors group">
                    <div className="flex items-center gap-5">
                      <Avatar className="h-12 w-12 border-2 border-primary/10 shadow-sm">
                        <AvatarFallback className="bg-primary/5 text-primary font-bold">{member.avatar}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-bold text-primary tracking-tight">{member.name}</p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mt-0.5">{member.role}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-12">
                      <div className="hidden lg:flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground/60" />
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          {member.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className={`text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full flex items-center gap-1.5 ${
                          member.status === 'Admin' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                        }`}>
                          {member.status === 'Admin' && <ShieldCheck className="h-3 w-3" />}
                          {member.status}
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="mt-8 p-6 bg-accent/5 rounded-xl border border-accent/10">
            <h4 className="text-xs font-bold uppercase tracking-widest text-accent mb-2">Team Capacity</h4>
            <p className="text-xs text-muted-foreground font-medium">Your team is currently managing 24 active valuations. 3 more analysts can be added to your current workspace plan.</p>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}