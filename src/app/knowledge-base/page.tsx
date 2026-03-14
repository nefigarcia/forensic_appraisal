
"use client"

import * as React from "react"
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { 
  BookOpen, 
  Search, 
  FileText, 
  Scale, 
  Globe, 
  BarChart3,
  ExternalLink,
  ArrowLeft
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function KnowledgeBase() {
  const resources = [
    {
      title: "Valuation Standards",
      description: "SSVS 1 and USPAP compliance guidelines for forensic reporting.",
      icon: Scale,
      tags: ["Compliance", "Standards"]
    },
    {
      title: "NAICS Code Directory",
      description: "Complete 2024 classification list for industry benchmarking.",
      icon: Globe,
      tags: ["Industry", "Classification"]
    },
    {
      title: "Courtroom Testimony",
      description: "Best practices for expert witness preparation and report defense.",
      icon: BookOpen,
      tags: ["Litigation", "Expert Witness"]
    },
    {
      title: "Market Multiple Trends",
      description: "Historical EBITDA and Revenue multiples by sector (2020-2024).",
      icon: BarChart3,
      tags: ["Data", "Benchmarks"]
    }
  ]

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white shadow-sm z-10">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <Link href="/dashboard" className="p-2 hover:bg-muted rounded-full transition-colors">
              <ArrowLeft className="h-4 w-4 text-primary" />
            </Link>
            <h1 className="text-xl font-bold font-headline text-foreground tracking-tight">Forensic Knowledge Base</h1>
          </div>
        </header>
        
        <main className="flex-1 p-8 max-w-5xl mx-auto w-full">
          <div className="relative mb-12">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input 
              className="pl-12 h-14 text-lg border-none shadow-sm bg-white rounded-2xl" 
              placeholder="Search standards, codes, or litigation guides..." 
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {resources.map((res) => (
              <Card key={res.title} className="border-none shadow-sm hover:shadow-md transition-all group cursor-pointer overflow-hidden bg-white">
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start">
                    <div className="bg-primary/5 p-3 rounded-xl group-hover:bg-primary group-hover:text-white transition-colors">
                      <res.icon className="h-6 w-6 text-primary group-hover:text-white" />
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="mt-4">
                    <CardTitle className="text-lg font-bold text-primary">{res.title}</CardTitle>
                    <CardDescription className="text-sm mt-1">{res.description}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {res.tags.map(tag => (
                      <span key={tag} className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-muted text-muted-foreground">
                        {tag}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-16 bg-primary/5 rounded-3xl p-10 border border-primary/10 text-center">
            <h3 className="text-xl font-bold text-primary mb-2">Request Firm-Specific Document</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              Need access to your firm's internal valuation templates? Contact your workspace administrator to sync custom archives.
            </p>
            <Button className="bg-primary font-bold uppercase text-xs tracking-widest px-8">Contact Admin</Button>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
