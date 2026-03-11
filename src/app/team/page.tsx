import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { UserPlus, Mail, Shield } from "lucide-react"

export default function TeamPage() {
  const members = [
    { name: "John Doe", role: "Senior Appraiser", email: "john@valuvault.ai", status: "Admin" },
    { name: "Jane Smith", role: "Financial Analyst", email: "jane@valuvault.ai", status: "Editor" },
    { name: "Mike Johnson", role: "Junior Analyst", email: "mike@valuvault.ai", status: "Editor" },
  ]

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-semibold font-headline text-primary">Team Management</h1>
          </div>
          <Button className="bg-accent hover:bg-accent/90">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite Member
          </Button>
        </header>
        
        <main className="flex-1 p-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Workspace Members</CardTitle>
              <CardDescription>Manage your team's access levels and permissions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {members.map((member) => (
                  <div key={member.email} className="flex items-center justify-between py-4 group">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-10 w-10 border">
                        <AvatarFallback className="bg-primary/5 text-primary">{member.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-primary">{member.name}</p>
                        <p className="text-xs text-muted-foreground">{member.role}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-8">
                      <div className="hidden md:block">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {member.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-muted px-2 py-0.5 rounded font-bold text-muted-foreground">
                          {member.status}
                        </span>
                        <Button variant="ghost" size="sm">Manage</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
