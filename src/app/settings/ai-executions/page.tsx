import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { AiExecutionsPanel } from "@/components/ai-executions-panel"

/**
 * ADMIN-only diagnostics page. The `AiExecutionsPanel` calls
 * `getRecentAiExecutions`, which enforces `team:manage`. Non-admins see
 * the friendly error toast rather than the list.
 */
export default function AiExecutionsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center px-6 border-b bg-white shadow-sm">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <h1 className="text-xl font-bold font-headline text-primary tracking-tight">AI Execution Registry</h1>
          </div>
        </header>
        <main className="flex-1 p-8 max-w-6xl mx-auto w-full">
          <div className="mb-6">
            <p className="text-sm text-muted-foreground">
              Every AI-assisted forensic step your organization runs is recorded here — the flow,
              the model, the source document versions, and the human review outcome. This page is
              restricted to workspace administrators.
            </p>
          </div>
          <AiExecutionsPanel />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
