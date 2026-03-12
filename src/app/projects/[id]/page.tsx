"use client"

import * as React from "react"
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  FileText, 
  Table as TableIcon, 
  Search, 
  Upload, 
  Download, 
  MoreVertical,
  Plus,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Globe,
  ExternalLink,
  Database,
  History,
  ShieldAlert,
  BarChart4
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { extractFinancialData, type FinancialDocumentExtractionOutput } from "@/ai/flows/ai-financial-statement-extraction-flow"
import { aiIndustryCodeSuggestion, type AiIndustryCodeSuggestionOutput } from "@/ai/flows/ai-industry-code-suggestion-flow"
import { toast } from "@/hooks/use-toast"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

export default function ProjectDetail() {
  const { id } = useParams()
  const [isExtracting, setIsExtracting] = React.useState(false)
  const [isAnalyzingIndustry, setIsAnalyzingIndustry] = React.useState(false)
  const [extractedData, setExtractedData] = React.useState<FinancialDocumentExtractionOutput | null>(null)
  const [industryData, setIndustryData] = React.useState<AiIndustryCodeSuggestionOutput | null>(null)
  
  const project = {
    id,
    name: "Global Logistics Group Valuation",
    client: "Preston & Reed LLP",
    created: "Oct 24, 2024",
    status: "Active",
    type: "M&A Forensic Audit",
    manager: "Sarah Jenkins, CPA",
  }

  const handleExtraction = async () => {
    setIsExtracting(true)
    try {
      const mockDataUri = "data:application/pdf;base64,JVBERi0xLjQKJ..." 
      const result = await extractFinancialData({
        documentDataUri: mockDataUri,
        documentName: "2023_Combined_Financials.pdf",
        documentTypeHint: "Income Statement, Balance Sheet, and Tax Summary"
      })
      setExtractedData(result)
      toast({
        title: "Forensic Extraction Successful",
        description: `Identified and structured ${result.extractedData.length} data points across 3 fiscal years.`,
      })
    } catch (error) {
      toast({
        title: "Extraction Error",
        description: "Verification engine failed to parse document structure.",
        variant: "destructive"
      })
    } finally {
      setIsExtracting(false)
    }
  }

  const handleIndustryAnalysis = async () => {
    setIsAnalyzingIndustry(true)
    try {
      const result = await aiIndustryCodeSuggestion({
        businessDescription: "Global logistics and freight forwarding company specializing in cold-chain pharmaceutical transportation across North America and Europe.",
        websiteUrl: "https://global-logistics-example.com",
      })
      setIndustryData(result)
      toast({
        title: "Industry Classification Fixed",
        description: `Primary NAICS: ${result.industryCodes.find(c => c.type === 'NAICS')?.code}`,
      })
    } catch (error) {
      toast({
        title: "Benchmarking Error",
        variant: "destructive"
      })
    } finally {
      setIsAnalyzingIndustry(false)
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white shadow-sm z-10">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <Link href="/projects" className="p-2 hover:bg-muted rounded-full transition-colors">
              <ArrowLeft className="h-4 w-4 text-primary" />
            </Link>
            <div className="border-l pl-4">
              <h1 className="text-lg font-bold text-primary tracking-tight">{project.name}</h1>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-wide">
                <span>{project.client}</span>
                <span>•</span>
                <span className="text-accent">{project.manager}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="bg-white border-none shadow-sm text-xs font-bold uppercase">
              <Download className="mr-2 h-3.5 w-3.5" />
              Report Binder
            </Button>
            <Button size="sm" className="bg-accent hover:bg-accent/90 shadow-sm text-xs font-bold uppercase">
              <Plus className="mr-2 h-3.5 w-3.5" />
              Upload Source
            </Button>
          </div>
        </header>

        <main className="flex-1 p-8 bg-background/30 max-w-7xl mx-auto w-full">
          <Tabs defaultValue="documents" className="space-y-6">
            <TabsList className="bg-white/80 border w-full justify-start p-1 h-12 shadow-sm rounded-xl">
              <TabsTrigger value="documents" className="data-[state=active]:bg-primary data-[state=active]:text-white px-8 font-bold text-xs uppercase tracking-widest rounded-lg">
                <FileText className="mr-2 h-4 w-4" />
                Custody Binder
              </TabsTrigger>
              <TabsTrigger value="analysis" className="data-[state=active]:bg-primary data-[state=active]:text-white px-8 font-bold text-xs uppercase tracking-widest rounded-lg">
                <TableIcon className="mr-2 h-4 w-4" />
                Analysis Ledger
              </TabsTrigger>
              <TabsTrigger value="industry" className="data-[state=active]:bg-primary data-[state=active]:text-white px-8 font-bold text-xs uppercase tracking-widest rounded-lg">
                <Globe className="mr-2 h-4 w-4" />
                Market Benchmarks
              </TabsTrigger>
            </TabsList>

            <TabsContent value="documents">
              <div className="grid gap-6 lg:grid-cols-4">
                <div className="lg:col-span-3 space-y-6">
                  <Card className="border-none shadow-sm overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between border-b bg-white py-4">
                      <div>
                        <CardTitle className="text-lg font-bold font-headline">Source Evidence</CardTitle>
                        <CardDescription className="text-xs">Verified documents for valuation model</CardDescription>
                      </div>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                        <Input className="pl-9 w-64 h-9 text-xs border-none bg-muted/50 focus:bg-white transition-colors" placeholder="Scan document content..." />
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y">
                        {[
                          { name: "2023 Audited Financials.pdf", size: "4.2 MB", date: "Oct 24", type: "Financials", status: "Verified" },
                          { name: "Global Logistics Q3 P&L.pdf", size: "1.1 MB", date: "Oct 22", type: "P&L", status: "Review" },
                          { name: "Shareholder Operating Agreement.pdf", size: "850 KB", date: "Oct 20", type: "Legal", status: "Verified" },
                          { name: "Equipment Appraisal Report.xlsx", size: "12 MB", date: "Oct 15", type: "Appraisal", status: "Draft" },
                        ].map((doc) => (
                          <div key={doc.name} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors group">
                            <div className="flex items-center gap-4">
                              <div className="bg-primary/5 p-2 rounded-lg">
                                <FileText className="h-5 w-5 text-primary/60" />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-primary group-hover:text-accent transition-colors">{doc.name}</p>
                                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{doc.size} • Received {doc.date}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <Badge variant={doc.status === 'Verified' ? 'default' : 'outline'} className="text-[10px] uppercase font-bold tracking-widest">
                                {doc.status}
                              </Badge>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                                  <Download className="h-4 w-4" />
                                </Button>
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
                </div>
                
                <div className="space-y-6">
                  <Card className="bg-primary text-white border-none shadow-lg overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <Zap className="h-20 w-20 fill-white" />
                    </div>
                    <CardHeader>
                      <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                        {isExtracting ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <Zap className="h-4 w-4 fill-accent text-accent" />}
                        AI Processing
                      </CardTitle>
                      <CardDescription className="text-white/60 font-medium">Extract data from latest uploads</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-xs leading-relaxed opacity-80 font-medium">
                        Our engine standardizes P&L and Balance Sheet line items into our Forensic Ledger automatically.
                      </p>
                      <Button 
                        onClick={handleExtraction} 
                        disabled={isExtracting}
                        className="w-full bg-accent hover:bg-accent/90 border-none font-bold uppercase text-[10px] tracking-widest h-10 shadow-md"
                      >
                        {isExtracting ? "Indexing..." : "Run AI Extraction"}
                      </Button>
                    </CardContent>
                  </Card>
                  
                  <Card className="border-none shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                        <History className="h-3.5 w-3.5" />
                        Custody Chain
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-3">
                        {[
                          { action: "Document Upload", time: "2h ago", user: "S. Jenkins" },
                          { action: "AI Extraction", time: "1h ago", user: "ValuVault AI" },
                          { action: "Review Started", time: "15m ago", user: "S. Jenkins" },
                        ].map((log, i) => (
                          <div key={i} className="flex gap-3 relative">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary/20 mt-1.5 shrink-0" />
                            <div>
                              <p className="text-[11px] font-bold text-primary">{log.action}</p>
                              <p className="text-[9px] text-muted-foreground uppercase font-medium">{log.time} • {log.user}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <Button variant="ghost" className="w-full text-[10px] uppercase font-bold tracking-widest h-8 text-primary">Full Audit Log</Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="analysis">
              <Card className="border-none shadow-sm overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between border-b bg-white py-6">
                  <div>
                    <CardTitle className="text-lg font-bold font-headline">Valuation Ledger</CardTitle>
                    <CardDescription className="text-xs">Structured year-over-year financial comparisons</CardDescription>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" size="sm" className="bg-white text-xs font-bold uppercase tracking-wide h-9">
                      <Download className="mr-2 h-4 w-4" />
                      Excel Sync
                    </Button>
                    <Button variant="outline" size="sm" className="bg-white text-xs font-bold uppercase tracking-wide h-9">
                      <ShieldAlert className="mr-2 h-4 w-4 text-orange-500" />
                      Run Variance Check
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {extractedData ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-muted/50 border-b">
                          <TableRow>
                            <TableHead className="w-[100px] text-[10px] uppercase font-bold text-primary tracking-widest">Year</TableHead>
                            <TableHead className="text-[10px] uppercase font-bold text-primary tracking-widest">Statement</TableHead>
                            <TableHead className="text-[10px] uppercase font-bold text-primary tracking-widest">Line Item</TableHead>
                            <TableHead className="text-right text-[10px] uppercase font-bold text-primary tracking-widest">Value</TableHead>
                            <TableHead className="w-[80px] text-center text-[10px] uppercase font-bold text-primary tracking-widest">Source</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {extractedData.extractedData.map((item, idx) => (
                            <TableRow key={idx} className="hover:bg-accent/5 transition-colors">
                              <TableCell className="font-bold text-primary">{item.year}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[9px] uppercase font-bold tracking-wide border-primary/20 text-primary">
                                  {item.statementType}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-medium">{item.lineItem}</TableCell>
                              <TableCell className="text-right font-mono font-bold text-primary">
                                {item.value !== null ? item.value.toLocaleString(undefined, {
                                  style: 'currency',
                                  currency: item.currency || 'USD'
                                }) : '—'}
                              </TableCell>
                              <TableCell className="text-center">
                                <Button variant="ghost" size="icon" className="h-6 w-6">
                                  <ExternalLink className="h-3 w-3 text-accent" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="bg-primary/5 p-6 rounded-full mb-6">
                        <BarChart4 className="h-12 w-12 text-primary/40" />
                      </div>
                      <h3 className="font-bold text-xl text-primary tracking-tight">Ledger Empty</h3>
                      <p className="text-sm text-muted-foreground mb-8 max-w-sm font-medium">
                        Initiate AI extraction from source documents to populate the forensic comparison table.
                      </p>
                      <Button onClick={handleExtraction} disabled={isExtracting} className="bg-primary font-bold uppercase tracking-widest text-xs px-8 h-12 shadow-lg">
                        {isExtracting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4 fill-white" />}
                        Generate Ledger
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="industry">
              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="border-none shadow-sm overflow-hidden">
                  <CardHeader className="bg-white border-b py-6">
                    <CardTitle className="text-lg font-bold font-headline">NAICS/SIC Profiling</CardTitle>
                    <CardDescription className="text-xs">AI-suggested classifications for benchmarking</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-8 p-8">
                    {!industryData ? (
                      <div className="py-12 text-center space-y-6">
                        <p className="text-sm text-muted-foreground font-medium">
                          Analyze the business engagement profile to find the most accurate industry benchmark codes.
                        </p>
                        <Button onClick={handleIndustryAnalysis} disabled={isAnalyzingIndustry} className="bg-accent font-bold uppercase tracking-widest text-xs px-8 h-11">
                          {isAnalyzingIndustry ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                          Identify Industry
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="p-6 bg-primary/5 rounded-xl border border-primary/10">
                          <label className="text-[10px] font-bold uppercase text-primary tracking-widest block mb-2">Primary Classification</label>
                          <p className="text-xl font-bold text-primary tracking-tight">{industryData.suggestedIndustry}</p>
                        </div>
                        
                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase text-primary tracking-widest block">Reference Codes</label>
                          <div className="grid gap-3">
                            {industryData.industryCodes.map((code, idx) => (
                              <div key={idx} className="flex items-center justify-between p-4 border rounded-xl bg-white shadow-sm hover:ring-2 hover:ring-accent/20 transition-all group">
                                <div className="flex items-center gap-3">
                                  <Badge variant="secondary" className="font-bold text-[10px]">{code.type}</Badge>
                                  <span className="font-mono font-bold text-primary tracking-tighter text-lg">{code.code}</span>
                                </div>
                                <Button variant="ghost" size="sm" className="text-[10px] font-bold uppercase tracking-widest text-accent">Benchmarking</Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-none shadow-sm bg-muted/20">
                  <CardHeader className="py-6 border-b bg-white">
                    <CardTitle className="text-lg font-bold font-headline">Valuation Data Hub</CardTitle>
                    <CardDescription className="text-xs">Direct API access to industry benchmarkers</CardDescription>
                  </CardHeader>
                  <CardContent className="p-8 space-y-6">
                    <p className="text-sm text-muted-foreground mb-6 font-medium leading-relaxed">
                      Based on identified codes, access valuation data from your connected subscriptions:
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      {["IbisWorld", "BVR Resources", "DealStats", "PratStats", "BizComps", "MergerStats"].map((src) => (
                        <Button key={src} variant="outline" className="justify-between text-xs font-bold uppercase tracking-widest h-14 px-6 bg-white border-none shadow-sm group hover:ring-2 hover:ring-primary/20">
                          {src}
                          <ExternalLink className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                        </Button>
                      ))}
                    </div>
                    <div className="mt-8 p-6 bg-accent/10 rounded-xl border border-accent/20">
                      <div className="flex items-center gap-3 mb-2">
                        <Database className="h-4 w-4 text-accent" />
                        <h4 className="text-xs font-bold uppercase tracking-widest text-accent">Connector Status</h4>
                      </div>
                      <p className="text-[11px] text-accent/80 leading-relaxed font-medium">
                        IbisWorld subscription is active. BVR credentials need update.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}