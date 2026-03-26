"use client"

import * as React from "react"
import {
  LayoutDashboard,
  Search,
  Settings,
  Users,
  Database,
  Briefcase,
  LogOut,
  ShieldCheck,
  CreditCard,
  ChevronUp,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { getBillingInfo } from "@/app/actions/billing-actions"

const mainItems = [
  { title: "Dashboard",       url: "/dashboard", icon: LayoutDashboard },
  { title: "Valuations",      url: "/projects",  icon: Briefcase },
  { title: "Discovery Search",url: "/search",    icon: Search },
]

const adminItems = [
  { title: "Connectors",      url: "/connections",      icon: Database },
  { title: "Engagement Team", url: "/team",             icon: Users },
  { title: "App Settings",    url: "/settings",         icon: Settings },
  { title: "Billing & Plans", url: "/settings/billing", icon: CreditCard },
]

const planColors: Record<string, string> = {
  TRIAL:      'bg-white/10 text-white/50',
  SOLO:       'bg-[#F0A80E]/20 text-[#F0A80E]',
  FIRM:       'bg-blue-500/20 text-blue-300',
  ENTERPRISE: 'bg-purple-500/20 text-purple-300',
}

export function AppSidebar() {
  const pathname = usePathname()
  const [billing, setBilling] = React.useState<any>(null)

  React.useEffect(() => {
    getBillingInfo().then(setBilling).catch(() => {})
  }, [])

  const planLabel = billing?.plan ?? '...'
  const orgName   = billing?.orgName ?? 'My Firm'
  const initials  = orgName.split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-16 flex items-center px-4 border-b border-sidebar-border/50">
        <div className="flex items-center gap-2">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0">
            <ShieldCheck className="size-5" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate font-bold text-white uppercase tracking-tight">ValuVault AI</span>
            <span className="truncate text-[10px] opacity-60 uppercase font-medium">Forensic Engine</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-white/40 text-[10px] uppercase font-bold px-4">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url || (item.url !== '/dashboard' && pathname.startsWith(item.url))}
                    tooltip={item.title}
                    className="h-10 px-4"
                  >
                    <Link href={item.url}>
                      <item.icon className="size-4" />
                      <span className="font-medium">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-white/40 text-[10px] uppercase font-bold px-4">Administration</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url}
                    tooltip={item.title}
                    className="h-10 px-4"
                  >
                    <Link href={item.url}>
                      <item.icon className="size-4" />
                      <span className="font-medium">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/50 p-3 space-y-1">
        {/* Org / plan row */}
        <div className="group-data-[collapsible=icon]:hidden flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent/60 transition-colors">
          {/* avatar */}
          <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center shrink-0 text-xs font-black text-white/80">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-white/80 truncate leading-tight">{orgName}</p>
            <span className={`inline-block text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 ${planColors[planLabel] ?? planColors.TRIAL}`}>
              {planLabel}
            </span>
          </div>
          <Link href="/settings/billing" className="shrink-0 opacity-40 hover:opacity-80 transition-opacity">
            <ChevronUp className="size-3.5 text-white rotate-180" />
          </Link>
        </div>

        {/* Sign out */}
        <SidebarMenu>
          <SidebarMenuItem>
            <form action="/api/auth/logout" method="POST">
              <SidebarMenuButton
                type="submit"
                tooltip="Sign Out"
                className="w-full justify-start gap-2 text-white/55 hover:text-white hover:bg-sidebar-accent transition-colors h-9 px-4"
              >
                <LogOut className="size-4" />
                <span className="group-data-[collapsible=icon]:hidden font-medium text-sm">Sign Out</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
