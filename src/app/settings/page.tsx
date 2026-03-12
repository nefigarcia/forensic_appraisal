import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Bell, Lock, User, Palette, BrainCircuit, ShieldCheck, FileKey } from "lucide-react"

export default function SettingsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center px-6 border-b bg-white shadow-sm">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-bold font-headline text-primary tracking-tight">System Configuration</h1>
          </div>
        </header>
        
        <main className="flex-1 p-8 max-w-4xl mx-auto w-full">
          <div className="space-y-10">
            <section>
              <h3 className="text-xs font-bold text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
                <BrainCircuit className="h-4 w-4" /> Forensic AI Preferences
              </h3>
              <Card className="border-none shadow-sm">
                <CardContent className="pt-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label className="font-bold text-sm">Automated Extraction Binder</Label>
                      <p className="text-xs text-muted-foreground font-medium">Automatically trigger AI extraction upon document upload to matter binder.</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label className="font-bold text-sm">Strict Verification Threshold</Label>
                      <p className="text-xs text-muted-foreground font-medium">Flag any extraction data point with confidence lower than 99% for manual audit.</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label className="font-bold text-sm">Anomaly Detection Radar</Label>
                      <p className="text-xs text-muted-foreground font-medium">Enable real-time background scanning for financial irregularities and variances.</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                </CardContent>
              </Card>
            </section>

            <section>
              <h3 className="text-xs font-bold text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Security & Compliance
              </h3>
              <Card className="border-none shadow-sm">
                <CardContent className="pt-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label className="font-bold text-sm">End-to-End Encryption Keys</Label>
                      <p className="text-xs text-muted-foreground font-medium">Matter-level encryption enabled for all PII and sensitive tax data.</p>
                    </div>
                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100 font-bold uppercase text-[9px]">Active</Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label className="font-bold text-sm">Automatic Data Purge</Label>
                      <p className="text-xs text-muted-foreground font-medium">Archive and purge matter data 7 years after case completion (Compliance Standard).</p>
                    </div>
                    <Switch />
                  </div>
                </CardContent>
              </Card>
            </section>

            <div className="flex justify-end gap-3 pt-6">
              <Button variant="ghost" className="font-bold uppercase text-xs tracking-widest h-11 px-8">Discard Changes</Button>
              <Button className="bg-primary hover:bg-primary/90 font-bold uppercase text-xs tracking-widest h-11 px-8 shadow-lg">Commit Configuration</Button>
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}