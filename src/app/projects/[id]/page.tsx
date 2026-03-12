
'use client';

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
  BarChart4,
  Zap,
  Calculator,
  Database
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { getCaseDetails } from "@/app/actions/cases"
import { addDocument } from "@/app/actions/documents"
import { runFinancialExtraction, runIndustryAnalysis } from "@/app/actions/ai-actions"
import { toast } from "@/hooks/use-toast"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { format } from "date-fns"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"

export default function ProjectDetail() {
  const { id } = useParams()
  const [isExtracting, setIsExtracting] = React.useState(false)
  const [isAnalyzingIndustry, setIsAnalyzingIndustry] = React.useState(false)
  const [caseData, setCaseData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [isUploading, setIsUploading] = React.useState(false)
  const [uploadOpen, setUploadOpen] = React.useState(false)

  const loadData = React.useCallback(async () => {
    try {
      const data = await getCaseDetails(id as string);
      setCaseData(data);
    } catch (e) {
      toast({ title: "Error", description: "Could not load case details", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [id])

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExtraction = async () => {
    setIsExtracting(true)
    try {
      const mockDataUri = "data:application/pdf;base64,JVBERi0xLjQKJ..." 
      await runFinancialExtraction(id as string, mockDataUri);
      await loadData()
      toast({
        title: "Forensic Extraction Successful",
        description: `Financial values have been persisted to the ledger.`,
      })
    } catch (error) {
      toast({
        title: "Extraction Error",
        description: "Failed to process document.",
        variant: "destructive"
      })
    } finally {
      setIsExtracting(false)
    }
  }

  const handleIndustryAnalysis = async () => {
    setIsAnalyzingIndustry(true)
    try {
      await runIndustryAnalysis(id as string, "Forensic matter for: " + caseData?.name);
      await loadData()
      toast({
        title: "Industry Profile Updated",
        description: `Classification saved to database.`,
      })
    } catch (error) {
      toast({
        title: "Analysis Error",
        variant: "destructive"
      })
    } finally {
      setIsAnalyzingIndustry(false)
    }
  }

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsUploading(true)
    const formData = new FormData(e.currentTarget)
    try {
      await addDocument(id as string, formData)
      toast({ title: "Document Added", description: "Source evidence persisted to custody binder." })
      setUploadOpen(false)
      loadData()
    } catch (err) {
      toast({ title: "Error", description: "Failed to add document.", variant: "destructive" })
    } finally {
      setIsUploading(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin text-primary h-8 w-8" /></div>;
  if (!caseData) return <div className="p-8 text-center">Case not found.</div>;

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
              <h1 className="text-lg font-bold text-primary tracking-tight">{caseData.name}</h1>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-wide">
                <span>{caseData.client}</span>
                <span>•</span>
                <span className="text-accent">{caseData.manager}</span>
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
            
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-accent hover:bg-accent/90 shadow-lg text-xs font-bold uppercase h-10 px-6">
                  <Plus className="mr-2 h-4 w-4" />
                  Upload Source
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={handleUpload}>
                  <DialogHeader>
                    <DialogTitle>Add Forensic Evidence</DialogTitle>
                    <DialogDescription>Attach a document to the matter's custody binder.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="name" className="text-right">File Name</Label>
                      <Input id="name" name="name" placeholder="Tax_Return_2023.pdf" className="col-span-3" required />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="type" className="text-right">Type</Label>
                      <Input id="type" name="type" placeholder="Tax Return" className="col-span-3" required />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={isUploading}>
                      {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save to Binder
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
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
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y">
                        {caseData.documents.map((doc: any) => (
                          <div key={doc.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors group">
                            <div className="flex items-center gap-4">
                              <div className="bg-primary/5 p-2 rounded-lg">
                                <FileText className="h-5 w-5 text-primary/60" />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-primary group-hover:text-accent transition-colors">{doc.name}</p>
                                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{doc.size} • Received {format(new Date(doc.createdAt), 'MMM d, yyyy')}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <Badge variant='outline' className="text-[10px] uppercase font-bold tracking-widest">
                                {doc.status}
                              </Badge>
                            </div>
                          </div>
                        ))}
                        {caseData.documents.length === 0 && (
                          <div className="p-12 text-center text-muted-foreground text-sm">No documents in binder.</div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
                
                <div className="space-y-6">
                  <Card className="bg-primary text-white border-none shadow-xl overflow-hidden relative">
                    <CardHeader>
                      <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                        {isExtracting ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <Zap className="h-4 w-4 fill-accent text-accent" />}
                        AI Processing
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-xs leading-relaxed opacity-80 font-medium">
                        Standardize financial points directly to the matter ledger.
                      </p>
                      <Button 
                        onClick={handleExtraction} 
                        disabled={isExtracting || caseData.documents.length === 0}
                        className="w-full bg-accent hover:bg-accent/90 border-none font-bold uppercase text-[10px] tracking-widest h-11 shadow-lg"
                      >
                        {isExtracting ? "Processing..." : "Run Extraction"}
                      </Button>
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
                    <CardDescription className="text-xs">Persistent normalization results from database</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {caseData.financialData.length > 0 ? (
                    <Table>
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead className="text-[10px] uppercase font-bold text-primary tracking-widest">Year</TableHead>
                          <TableHead className="text-[10px] uppercase font-bold text-primary tracking-widest">Statement</TableHead>
                          <TableHead className="text-[10px] uppercase font-bold text-primary tracking-widest">Line Item</TableHead>
                          <TableHead className="text-right text-[10px] uppercase font-bold text-primary tracking-widest">Normalized Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {caseData.financialData.map((item: any) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-bold">{item.year}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[9px] uppercase font-bold tracking-wide">{item.statementType}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">{item.lineItem}</TableCell>
                            <TableCell className="text-right font-mono font-bold text-primary">
                              {item.value ? item.value.toLocaleString(undefined, { style: 'currency', currency: item.currency }) : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <BarChart4 className="h-16 w-16 text-primary/40 mb-4" />
                      <h3 className="font-bold text-xl text-primary">Ledger Is Empty</h3>
                      <Button onClick={handleExtraction} disabled={isExtracting} className="mt-8 bg-primary font-bold uppercase tracking-widest text-xs h-14">
                        {isExtracting ? <Loader2 className="mr-2 animate-spin" /> : <Zap className="mr-2" />}
                        Populate From AI
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="industry">
              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="border-none shadow-sm overflow-hidden bg-white">
                  <CardHeader className="border-b py-6">
                    <CardTitle className="text-lg font-bold font-headline">Classification Profiling</CardTitle>
                  </CardHeader>
                  <CardContent className="p-8">
                    {!caseData.industry ? (
                      <div className="text-center py-12">
                        <Button onClick={handleIndustryAnalysis} disabled={isAnalyzingIndustry} className="bg-accent font-bold uppercase text-xs">
                          {isAnalyzingIndustry ? <Loader2 className="mr-2 animate-spin" /> : <Globe className="mr-2" />}
                          Suggest Industry Codes
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-8">
                        <div className="p-8 bg-primary/5 rounded-2xl border">
                          <label className="text-[10px] font-bold uppercase text-primary tracking-widest block mb-2">Primary Classification</label>
                          <p className="text-2xl font-black text-primary">{caseData.industry.suggestedIndustry}</p>
                        </div>
                        <div className="grid gap-4">
                          <div className="flex items-center justify-between p-5 border rounded-2xl">
                             <Badge>NAICS</Badge>
                             <span className="font-mono font-bold text-xl">{caseData.industry.naicsCode || 'Pending'}</span>
                          </div>
                          <div className="flex items-center justify-between p-5 border rounded-2xl">
                             <Badge>SIC</Badge>
                             <span className="font-mono font-bold text-xl">{caseData.industry.sicCode || 'Pending'}</span>
                          </div>
                        </div>
                      </div>
                    )}
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
