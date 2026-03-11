import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Bell, Lock, User, Palette, BrainCircuit } from "lucide-react"

export default function SettingsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center px-6 border-b bg-white">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-semibold font-headline text-primary">Settings</h1>
          </div>
        </header>
        
        <main className="flex-1 p-8 max-w-4xl">
          <div className="space-y-8">
            <section>
              <h3 className="text-sm font-semibold text-primary mb-4 flex items-center gap-2">
                <BrainCircuit className="h-4 w-4" /> AI Preferences
              </h3>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Auto-Extraction</Label>
                      <p className="text-xs text-muted-foreground">Automatically trigger extraction on document upload</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Confidence Threshold</Label>
                      <p className="text-xs text-muted-foreground">Flag extractions below 95% confidence for review</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                </CardContent>
              </Card>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-primary mb-4 flex items-center gap-2">
                <Bell className="h-4 w-4" /> Notifications
              </h3>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Email Alerts</Label>
                      <p className="text-xs text-muted-foreground">Receive updates when reports are ready</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Browser Notifications</Label>
                      <p className="text-xs text-muted-foreground">Show desktop notifications for urgent tasks</p>
                    </div>
                    <Switch />
                  </div>
                </CardContent>
              </Card>
            </section>

            <div className="flex justify-end gap-3">
              <Button variant="outline">Discard Changes</Button>
              <Button className="bg-accent hover:bg-accent/90">Save Configuration</Button>
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
