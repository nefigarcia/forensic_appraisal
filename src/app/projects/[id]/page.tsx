
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
  Plus,
  ArrowLeft,
  Loader2,
  Globe,
  ExternalLink,
  History,
  ShieldAlert,
  BarChart4,
  Zap,
  Download,
  MoreVertical,
  Calculator,
  Database
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
            <Link href="/dashboard" className="p-2 hover:bg-muted rounded-full transition-colors">
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
            <Link href={`/projects/${id}/valuation`}>
              <Button variant="outline" size="sm" className="bg-white border-primary/20 text-primary shadow-sm text-xs font-bold uppercase h-10 px-6">
                <Calculator className="mr-2 h-4 w-4" />
                Open Modeler
              </Button>
            </Link>
            <Button size="sm" className="bg-accent hover:bg-accent/90 shadow-lg text-xs font-bold uppercase h-10 px-6">
              <Plus className="mr-2 h-4 w-4" />
              Upload Source
            </Button>
          </div>
        </header>

        <main className="flex-1 p-8 bg-background/30 max-w-7xl mx-auto w-full">
          <Tabs defaultValue="documents" className="space-y-6">
            <TabsList className="bg-white/80 border w-full justify-start p-1 h-12 shadow-sm rounded-xl">
              <TabsTrigger value="documents" className="data-[state=active]:bg-primary data-[state=active]:text-white px-8 font-bold text-xs uppercase tracking-widest rounded-lg h-full">
                <FileText className="mr-2 h-4 w-4" />
                Custody Binder
              </TabsTrigger>
              <TabsTrigger value="analysis" className="data-[state=active]:bg-primary data-[state=active]:text-white px-8 font-bold text-xs uppercase tracking-widest rounded-lg h-full">
                <TableIcon className="mr-2 h-4 w-4" />
                Forensic Ledger
              </TabsTrigger>
              <TabsTrigger value="industry" className="data-[state=active]:bg-primary data-[state=active]:text-white px-8 font-bold text-xs uppercase tracking-widest rounded-lg h-full">
                <Globe className="mr-2 h-4 w-4" />
                Benchmarks
              </TabsTrigger>
            </TabsList>

            <TabsContent value="documents">
              <div className="grid gap-6 lg:grid-cols-4">
                <div className="lg:col-span-3 space-y-6">
                  <Card className="border-none shadow-sm overflow-hidden bg-white">
                    <CardHeader className="flex flex-row items-center justify-between border-b py-4">
                      <div>
                        <CardTitle className="text-lg font-bold font-headline">Source Evidence</CardTitle>
                        <CardDescription className="text-xs">Secure document custody for matter audit</CardDescription>
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
                  <Card className="bg-primary text-white border-none shadow-xl overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <Zap className="h-24 w-24 fill-white" />
                    </div>
                    <CardHeader>
                      <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                        {isExtracting ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <Zap className="h-4 w-4 fill-accent text-accent" />}
                        AI Processing
                      </CardTitle>
                      <CardDescription className="text-white/60 font-medium">Standardize P&L and Balance Sheet</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-xs leading-relaxed opacity-80 font-medium">
                        Our forensic engine maps messy account names into structured valuation line items automatically.
                      </p>
                      <Button 
                        onClick={handleExtraction} 
                        disabled={isExtracting}
                        className="w-full bg-accent hover:bg-accent/90 border-none font-bold uppercase text-[10px] tracking-widest h-11 shadow-lg"
                      >
                        {isExtracting ? "Indexing Binder..." : "Execute AI Extraction"}
                      </Button>
                    </CardContent>
                  </Card>
                  
                  <Card className="border-none shadow-sm bg-white">
                    <CardHeader className="pb-3 border-b">
                      <CardTitle className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                        <History className="h-3.5 w-3.5" />
                        Custody Chain
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-4">
                      <div className="space-y-4">
                        {[
                          { action: "Document Upload", time: "2h ago", user: "S. Jenkins" },
                          { action: "AI Extraction", time: "1h ago", user: "ValuVault AI" },
                          { action: "Model Updated", time: "15m ago", user: "Sarah Jenkins" },
                        ].map((log, i) => (
                          <div key={i} className="flex gap-3 relative">
                            <div className="w-2 h-2 rounded-full bg-primary/30 mt-1 shrink-0" />
                            <div>
                              <p className="text-[11px] font-bold text-primary">{log.action}</p>
                              <p className="text-[9px] text-muted-foreground uppercase font-medium">{log.time} • {log.user}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <Button variant="ghost" className="w-full text-[10px] uppercase font-bold tracking-widest h-8 text-primary hover:bg-muted">Full Audit Log</Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="analysis">
              <Card className="border-none shadow-sm overflow-hidden bg-white">
                <CardHeader className="flex flex-row items-center justify-between border-b py-6">
                  <div>
                    <CardTitle className="text-lg font-bold font-headline">Forensic Ledger</CardTitle>
                    <CardDescription className="text-xs">Structured normalization for valuation modeling</CardDescription>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" size="sm" className="bg-white text-xs font-bold uppercase tracking-wide h-9 border-muted">
                      <Download className="mr-2 h-4 w-4 text-primary" />
                      Excel Sync
                    </Button>
                    <Button variant="outline" size="sm" className="bg-white text-xs font-bold uppercase tracking-wide h-9 border-muted">
                      <ShieldAlert className="mr-2 h-4 w-4 text-orange-500" />
                      Run Variance
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {extractedData ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-muted/30">
                          <TableRow>
                            <TableHead className="text-[10px] uppercase font-bold text-primary tracking-widest">Year</TableHead>
                            <TableHead className="text-[10px] uppercase font-bold text-primary tracking-widest">Statement</TableHead>
                            <TableHead className="text-[10px] uppercase font-bold text-primary tracking-widest">Line Item</TableHead>
                            <TableHead className="text-right text-[10px] uppercase font-bold text-primary tracking-widest">Normalized Value</TableHead>
                            <TableHead className="w-[80px] text-center text-[10px] uppercase font-bold text-primary tracking-widest">Ref</TableHead>
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
                              <TableCell className="font-medium text-sm">{item.lineItem}</TableCell>
                              <TableCell className="text-right font-mono font-bold text-primary text-sm">
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
                      <div className="bg-primary/5 p-8 rounded-full mb-6">
                        <BarChart4 className="h-16 w-16 text-primary/40" />
                      </div>
                      <h3 className="font-bold text-xl text-primary tracking-tight">Ledger Is Empty</h3>
                      <p className="text-sm text-muted-foreground mb-8 max-w-sm font-medium">
                        Execute AI extraction on the matter binder to populate normalized comparisons.
                      </p>
                      <Button onClick={handleExtraction} disabled={isExtracting} className="bg-primary font-bold uppercase tracking-widest text-xs px-10 h-14 shadow-xl">
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
                <Card className="border-none shadow-sm overflow-hidden bg-white">
                  <CardHeader className="bg-white border-b py-6">
                    <CardTitle className="text-lg font-bold font-headline">Classification Profiling</CardTitle>
                    <CardDescription className="text-xs">NAICS/SIC mapping for peer benchmarking</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-8 p-8">
                    {!industryData ? (
                      <div className="py-12 text-center space-y-6">
                        <p className="text-sm text-muted-foreground font-medium">
                          Analyze the engagement profile to identify the primary benchmark industry codes.
                        </p>
                        <Button onClick={handleIndustryAnalysis} disabled={isAnalyzingIndustry} className="bg-accent font-bold uppercase tracking-widest text-xs px-10 h-12 shadow-md">
                          {isAnalyzingIndustry ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4" />}
                          Suggest Codes
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="p-8 bg-primary/5 rounded-2xl border border-primary/10">
                          <label className="text-[10px] font-bold uppercase text-primary tracking-widest block mb-2">Primary Classification</label>
                          <p className="text-2xl font-black text-primary tracking-tight leading-tight">{industryData.suggestedIndustry}</p>
                        </div>
                        
                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase text-primary tracking-widest block">Reference Codes</label>
                          <div className="grid gap-4">
                            {industryData.industryCodes.map((code, idx) => (
                              <div key={idx} className="flex items-center justify-between p-5 border rounded-2xl bg-white shadow-sm hover:ring-2 hover:ring-accent/20 transition-all group">
                                <div className="flex items-center gap-4">
                                  <Badge variant="secondary" className="font-bold text-[10px] px-3 py-1">{code.type}</Badge>
                                  <span className="font-mono font-bold text-primary tracking-tighter text-xl">{code.code}</span>
                                </div>
                                <Button variant="ghost" size="sm" className="text-[10px] font-bold uppercase tracking-widest text-accent hover:bg-accent/10">
                                  Benchmarking
                                  <ArrowRight className="ml-2 h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-none shadow-sm bg-muted/10">
                  <CardHeader className="py-6 border-b bg-white">
                    <CardTitle className="text-lg font-bold font-headline text-primary">Data Connectors</CardTitle>
                    <CardDescription className="text-xs">Direct API access to industry benchmarkers</CardDescription>
                  </CardHeader>
                  <CardContent className="p-8 space-y-8">
                    <p className="text-sm text-muted-foreground font-medium leading-relaxed">
                      Access valuation multiples and risk ratios from connected premium subscriptions based on the identified codes.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      {["IbisWorld", "BVR Resources", "DealStats", "PratStats", "BizComps", "MergerStats"].map((src) => (
                        <Button key={src} variant="outline" className="justify-between text-xs font-bold uppercase tracking-widest h-16 px-6 bg-white border-none shadow-sm group hover:ring-2 hover:ring-primary/20 transition-all">
                          {src}
                          <Database className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                        </Button>
                      ))}
                    </div>
                    <div className="mt-8 p-6 bg-accent/10 rounded-2xl border border-accent/20 flex gap-4">
                      <Database className="h-5 w-5 text-accent shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-accent mb-1">Live Connection Status</h4>
                        <p className="text-[11px] text-accent font-medium leading-relaxed">
                          BVR Credentials Expired. IbisWorld syncing current industry multiples for {industryData?.suggestedIndustry || "unclassified"}.
                        </p>
                      </div>
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
