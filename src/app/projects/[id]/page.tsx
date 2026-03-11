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

export default function ProjectDetail() {
  const { id } = useParams()
  const [isExtracting, setIsExtracting] = React.useState(false)
  const [isAnalyzingIndustry, setIsAnalyzingIndustry] = React.useState(false)
  const [extractedData, setExtractedData] = React.useState<FinancialDocumentExtractionOutput | null>(null)
  const [industryData, setIndustryData] = React.useState<AiIndustryCodeSuggestionOutput | null>(null)
  
  // Mock project info
  const project = {
    id,
    name: "Smith vs. Smith Valuation",
    client: "Mark Smith",
    created: "Oct 24, 2024",
    status: "Active",
    type: "Divorce Property Division",
  }

  const handleExtraction = async () => {
    setIsExtracting(true)
    try {
      // In a real app, we'd use a real Base64 URI from an uploaded file
      // For the prototype, we use a placeholder "mock" data URI
      const mockDataUri = "data:application/pdf;base64,JVBERi0xLjQKJ..." 
      const result = await extractFinancialData({
        documentDataUri: mockDataUri,
        documentName: "2023_Financials_Smith.pdf",
        documentTypeHint: "Income Statement and Balance Sheet"
      })
      setExtractedData(result)
      toast({
        title: "Extraction Complete",
        description: `Successfully extracted ${result.extractedData.length} data points.`,
      })
    } catch (error) {
      toast({
        title: "Extraction Failed",
        description: "There was an error processing the document.",
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
        businessDescription: "Residential real estate holding company with multiple rental properties in the Southern Florida region.",
        websiteUrl: "https://smith-realty-group.example.com",
      })
      setIndustryData(result)
      toast({
        title: "Industry Identified",
        description: `Classification: ${result.suggestedIndustry}`,
      })
    } catch (error) {
      toast({
        title: "Analysis Failed",
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
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <Link href="/" className="p-2 hover:bg-muted rounded-full">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-primary">{project.name}</h1>
              <p className="text-xs text-muted-foreground">{project.client} • {project.type}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export Model
            </Button>
            <Button size="sm" className="bg-accent">
              <Plus className="mr-2 h-4 w-4" />
              Upload Document
            </Button>
          </div>
        </header>

        <main className="flex-1 p-8 bg-background/50">
          <Tabs defaultValue="documents" className="space-y-6">
            <TabsList className="bg-white border w-full justify-start p-1 h-12">
              <TabsTrigger value="documents" className="data-[state=active]:bg-primary data-[state=active]:text-white px-6">
                <FileText className="mr-2 h-4 w-4" />
                Documents
              </TabsTrigger>
              <TabsTrigger value="analysis" className="data-[state=active]:bg-primary data-[state=active]:text-white px-6">
                <TableIcon className="mr-2 h-4 w-4" />
                Financial Analysis
              </TabsTrigger>
              <TabsTrigger value="industry" className="data-[state=active]:bg-primary data-[state=active]:text-white px-6">
                <Globe className="mr-2 h-4 w-4" />
                Industry Hub
              </TabsTrigger>
            </TabsList>

            <TabsContent value="documents">
              <div className="grid gap-6 md:grid-cols-4">
                <div className="md:col-span-3 space-y-6">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">Project Files</CardTitle>
                        <CardDescription>Managed files for this appraisal task</CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input className="pl-9 w-64 h-9" placeholder="Natural language search..." />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1">
                        {[
                          { name: "2023 Tax Return (Combined).pdf", size: "4.2 MB", date: "Oct 24", type: "Tax Return" },
                          { name: "2024-Q3 Internal Financials.pdf", size: "1.1 MB", date: "Oct 22", type: "Financials" },
                          { name: "Shareholder Agreement.pdf", size: "850 KB", date: "Oct 20", type: "Legal" },
                        ].map((doc) => (
                          <div key={doc.name} className="flex items-center justify-between p-3 rounded-md hover:bg-muted/50 border border-transparent hover:border-border group">
                            <div className="flex items-center gap-3">
                              <FileText className="h-5 w-5 text-primary/60" />
                              <div>
                                <p className="text-sm font-medium">{doc.name}</p>
                                <p className="text-[10px] text-muted-foreground">{doc.size} • Uploaded {doc.date}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] bg-muted px-2 py-0.5 rounded text-muted-foreground uppercase tracking-wider font-semibold">{doc.type}</span>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <div className="space-y-6">
                  <Card className="bg-primary text-white">
                    <CardHeader>
                      <CardTitle className="text-md flex items-center gap-2">
                        <Loader2 className={`h-4 w-4 ${isExtracting ? "animate-spin" : ""}`} />
                        Quick Extraction
                      </CardTitle>
                      <CardDescription className="text-white/70">Extract structured data from the latest document</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-xs leading-relaxed opacity-90">
                        Our AI identifies line items, years, and complex statement structures (Tax Returns, Balance Sheets) instantly.
                      </p>
                      <Button 
                        onClick={handleExtraction} 
                        disabled={isExtracting}
                        className="w-full bg-accent hover:bg-accent/90 border-none"
                      >
                        {isExtracting ? "Processing..." : "Run Extraction"}
                      </Button>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Storage Connector</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2">
                          <Database className="h-3 w-3 text-accent" />
                          SharePoint
                        </span>
                        <span className="text-green-600 font-medium">Syncing</span>
                      </div>
                      <Button variant="outline" className="w-full text-xs h-8">Configure Sync</Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="analysis">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Extracted Financial Data</CardTitle>
                    <CardDescription>Year-by-year financial breakdown from all processed documents</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" className="h-8">
                    <Download className="mr-2 h-4 w-4" />
                    Download CSV
                  </Button>
                </CardHeader>
                <CardContent>
                  {extractedData ? (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow>
                            <TableHead className="w-[100px]">Year</TableHead>
                            <TableHead>Statement Type</TableHead>
                            <TableHead>Line Item</TableHead>
                            <TableHead className="text-right">Value</TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {extractedData.extractedData.map((item, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="font-medium">{item.year}</TableCell>
                              <TableCell className="text-xs uppercase text-muted-foreground">{item.statementType}</TableCell>
                              <TableCell>{item.lineItem}</TableCell>
                              <TableCell className="text-right font-mono">
                                {item.value !== null ? item.value.toLocaleString(undefined, {
                                  style: 'currency',
                                  currency: item.currency || 'USD'
                                }) : 'N/A'}
                              </TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" className="h-6 w-6">
                                  <CheckCircle2 className="h-3 w-3 text-green-600" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="bg-muted p-4 rounded-full mb-4">
                        <TableIcon className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <h3 className="font-medium text-lg">No data extracted yet</h3>
                      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                        Process a document in the Documents tab to see year-over-year financial comparisons here.
                      </p>
                      <Button onClick={handleExtraction} disabled={isExtracting}>
                        {isExtracting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Start Extraction
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="industry">
              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Industry Identification</CardTitle>
                    <CardDescription>AI-suggested classifications based on client data</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {!industryData ? (
                      <div className="py-8 text-center space-y-4">
                        <p className="text-sm text-muted-foreground">
                          Analyze the business description and website to find the most accurate industry codes.
                        </p>
                        <Button onClick={handleIndustryAnalysis} disabled={isAnalyzingIndustry} className="bg-accent">
                          {isAnalyzingIndustry && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Analyze Industry
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="p-4 bg-muted/50 rounded-lg border">
                          <label className="text-[10px] font-bold uppercase text-primary tracking-widest block mb-1">Suggested Industry</label>
                          <p className="text-lg font-semibold">{industryData.suggestedIndustry}</p>
                        </div>
                        
                        <div className="space-y-3">
                          <label className="text-[10px] font-bold uppercase text-primary tracking-widest block">Associated Codes</label>
                          <div className="grid gap-2">
                            {industryData.industryCodes.map((code, idx) => (
                              <div key={idx} className="flex items-center justify-between p-3 border rounded bg-white">
                                <div>
                                  <span className="text-[10px] font-bold text-accent mr-2">{code.type}</span>
                                  <span className="font-mono font-medium">{code.code}</span>
                                </div>
                                <Button variant="ghost" size="sm" className="h-7 text-[10px] uppercase">Verify</Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">External Research Hub</CardTitle>
                    <CardDescription>Quick links to industry data sources</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-xs text-muted-foreground mb-4">
                      Based on identified codes, access valuation data from your connected subscriptions:
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {["IbisWorld", "BVR", "DealStats", "PratStats", "BizComps", "MergerStats"].map((src) => (
                        <Button key={src} variant="outline" className="justify-between text-xs h-10 px-4 group">
                          {src}
                          <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Button>
                      ))}
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
