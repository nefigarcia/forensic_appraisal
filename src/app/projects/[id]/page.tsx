
'use client';

import * as React from "react"
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
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
  Database,
  CloudDownload,
  UploadCloud,
  HardDrive,
  FileCheck,
  ImageIcon,
  CheckCircle2,
  Save,
  Download,
  FileSpreadsheet,
  Send,
  Edit3
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { getCaseDetails } from "@/app/actions/cases"
import { addDocument } from "@/app/actions/documents"
import { runFinancialExtraction, runIndustryAnalysis, updateFinancialValue, approveFinancialValues } from "@/app/actions/ai-actions"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export default function ProjectDetail() {
  const { id } = useParams()
  const [isExtracting, setIsExtracting] = React.useState(false)
  const [isAnalyzingIndustry, setIsAnalyzingIndustry] = React.useState(false)
  const [caseData, setCaseData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [isUploading, setIsUploading] = React.useState(false)
  const [uploadOpen, setUploadOpen] = React.useState(false)
  
  // Ledger State
  const [isEditingLedger, setIsEditingLedger] = React.useState(false)
  const [activeStatement, setActiveStatement] = React.useState<string | null>(null)
  const [savingId, setSavingId] = React.useState<string | null>(null)

  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)

  const loadData = React.useCallback(async () => {
    try {
      const data = await getCaseDetails(id as string);
      setCaseData(data);
      
      // Set initial active statement if not set
      if (data?.financialData?.length > 0 && !activeStatement) {
        setActiveStatement(data.financialData[0].statementType)
      }
    } catch (e) {
      toast({ title: "Error", description: "Could not load case details", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [id, activeStatement])

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExtraction = async () => {
    if (!caseData?.documents || caseData.documents.length === 0) {
      toast({ title: "No Documents", description: "Please upload a document to the binder first.", variant: "destructive" })
      return
    }

    setIsExtracting(true)
    try {
      await runFinancialExtraction(id as string);
      await loadData()
      toast({ title: "Forensic Extraction Successful", description: `Financial values have been persisted to the ledger.` })
    } catch (error: any) {
      toast({ title: "Extraction Error", description: error.message || "Failed to process document content.", variant: "destructive" })
    } finally {
      setIsExtracting(false)
    }
  }

  const handleSaveEdit = async (itemId: string, newValue: number, newLineItem: string) => {
    setSavingId(itemId)
    try {
      await updateFinancialValue(itemId, newValue, newLineItem)
      toast({ title: "Entry Updated" })
      await loadData()
    } catch (error) {
      toast({ title: "Save Error", variant: "destructive" })
    } finally {
      setSavingId(null)
    }
  }

  const handleApprove = async () => {
    if (!activeStatement) return
    try {
      await approveFinancialValues(id as string, activeStatement)
      toast({ title: "Statement Approved", description: "All entries marked as verified." })
      await loadData()
    } catch (error) {
      toast({ title: "Approval Error", variant: "destructive" })
    }
  }

  const handleIndustryAnalysis = async () => {
    setIsAnalyzingIndustry(true)
    try {
      await runIndustryAnalysis(id as string, "Forensic matter for: " + caseData?.name);
      await loadData()
      toast({ title: "Industry Profile Updated" })
    } catch (error) {
      toast({ title: "Analysis Error", variant: "destructive" })
    } finally {
      setIsAnalyzingIndustry(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0])
    }
  }

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsUploading(true)
    const formData = new FormData(e.currentTarget)
    
    if (selectedFile) {
      formData.set("file", selectedFile)
      if (!formData.get("name")) formData.set("name", selectedFile.name)
    }

    try {
      await addDocument(id as string, formData)
      toast({ title: "Document Added" })
      setUploadOpen(false)
      setSelectedFile(null)
      loadData()
    } catch (err) {
      toast({ title: "Error", description: "Failed to add document.", variant: "destructive" })
    } finally {
      setIsUploading(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin text-primary h-8 w-8" /></div>;
  if (!caseData) return <div className="p-8 text-center">Case not found.</div>;

  const groupedData = caseData.financialData.reduce((acc: any, item: any) => {
    if (!acc[item.statementType]) acc[item.statementType] = [];
    acc[item.statementType].push(item);
    return acc;
  }, {});

  const currentStatementData = activeStatement ? groupedData[activeStatement] || [] : [];
  const statementTypes = Object.keys(groupedData);

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
            
            <Dialog open={uploadOpen} onOpenChange={(open) => { setUploadOpen(open); if (!open) setSelectedFile(null); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-accent hover:bg-accent/90 shadow-lg text-xs font-bold uppercase h-10 px-6">
                  <Plus className="mr-2 h-4 w-4" />
                  Upload Source
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Add Forensic Evidence</DialogTitle>
                  <DialogDescription>Attach documents or images to the matter's custody binder for audit verification.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleUpload} className="space-y-6 mt-4">
                  <div className="space-y-2">
                    <input type="file" className="hidden" ref={fileInputRef} accept=".pdf,.png,.jpg,.jpeg" onChange={handleFileChange} />
                    <div onClick={() => fileInputRef.current?.click()} className={cn("flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer group bg-muted/5 hover:bg-muted/10", selectedFile ? "border-green-500/50 bg-green-50/50" : "border-muted-foreground/20")}>
                      {selectedFile ? (
                        <div className="text-center">
                          <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-2" />
                          <p className="text-xs font-bold text-green-700">{selectedFile.name}</p>
                        </div>
                      ) : (
                        <div className="text-center">
                          <UploadCloud className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                          <p className="text-xs font-medium text-muted-foreground">Select File (PDF, JPG, PNG)</p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-xs font-bold uppercase tracking-wider">Display Name</Label>
                      <Input id="name" name="name" defaultValue={selectedFile?.name || ""} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="type" className="text-xs font-bold uppercase tracking-wider">Document Type</Label>
                      <Select name="type" defaultValue="Income Statement">
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Income Statement">Income Statement</SelectItem>
                          <SelectItem value="Balance Sheet">Balance Sheet</SelectItem>
                          <SelectItem value="Tax Return">Tax Return</SelectItem>
                          <SelectItem value="Bank Statement">Bank Statement</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={isUploading || !selectedFile} className="w-full bg-primary font-bold uppercase text-xs h-11">
                      {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save to Local Binder"}
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
                    <CardHeader className="border-b py-4">
                      <CardTitle className="text-lg font-bold font-headline">Source Evidence</CardTitle>
                      <CardDescription className="text-xs">Secure document custody for matter audit</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y">
                        {caseData.documents.map((doc: any) => (
                          <div key={doc.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors group">
                            <div className="flex items-center gap-4">
                              <div className="bg-primary/5 p-2 rounded-lg">
                                {doc.type?.toLowerCase().includes('image') ? <ImageIcon className="h-5 w-5 text-primary/60" /> : <FileText className="h-5 w-5 text-primary/60" />}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-primary">{doc.name}</p>
                                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{doc.size} • {format(new Date(doc.createdAt), 'MMM d, yyyy')}</p>
                              </div>
                            </div>
                            <Badge variant='outline' className="text-[10px] uppercase font-bold tracking-widest">{doc.status}</Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <div className="space-y-6">
                  <Card className="bg-primary text-white border-none shadow-xl relative overflow-hidden">
                    <CardHeader><CardTitle className="text-sm font-bold uppercase tracking-widest">AI Extraction</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-xs opacity-80">Automatically extract financial data from your uploaded binder.</p>
                      <Button onClick={handleExtraction} disabled={isExtracting || caseData.documents.length === 0} className="w-full bg-accent hover:bg-accent/90 border-none font-bold uppercase text-[10px] tracking-widest h-11 shadow-lg">
                        {isExtracting ? "Processing..." : "Run Extraction"}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="analysis">
              <div className="space-y-2 mb-6">
                <h2 className="text-2xl font-black text-primary tracking-tight">AI Financial Extraction</h2>
                <p className="text-sm text-muted-foreground font-medium">AI has automatically extracted financial statement data from the uploaded PDFs. Review and export to Excel.</p>
              </div>

              <div className="grid gap-6 lg:grid-cols-12 items-start">
                <Card className="lg:col-span-3 border-none shadow-sm overflow-hidden bg-white">
                  <CardHeader className="bg-muted/30 border-b py-4">
                    <CardTitle className="text-xs font-bold uppercase tracking-widest">Detected Financial Statements</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {statementTypes.map((st) => (
                        <button key={st} onClick={() => setActiveStatement(st)} className={cn("w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors", activeStatement === st ? "bg-primary/5 border-l-4 border-primary" : "")}>
                          <div className="flex items-center gap-3">
                            <FileSpreadsheet className={cn("h-4 w-4", activeStatement === st ? "text-primary" : "text-muted-foreground")} />
                            <span className={cn("text-xs font-bold", activeStatement === st ? "text-primary" : "text-muted-foreground")}>{st}</span>
                          </div>
                          {groupedData[st].every((i: any) => i.isVerified) && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                        </button>
                      ))}
                      {statementTypes.length === 0 && <div className="p-8 text-center text-xs text-muted-foreground">Run extraction to detect statements</div>}
                    </div>
                  </CardContent>
                </Card>

                <div className="lg:col-span-9 space-y-6">
                  <Card className="border-none shadow-sm overflow-hidden bg-white">
                    <CardHeader className="flex flex-row items-center justify-between border-b py-4 bg-muted/10">
                      <div>
                        <CardTitle className="text-sm font-bold uppercase tracking-widest">Financial Ledger: {activeStatement || "Select Statement"}</CardTitle>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button onClick={handleApprove} variant="outline" size="sm" className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100 text-[10px] font-bold uppercase h-9">
                          <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Approve Extraction
                        </Button>
                        <Button onClick={() => setIsEditingLedger(!isEditingLedger)} variant="outline" size="sm" className="text-[10px] font-bold uppercase h-9">
                          <Edit3 className="mr-2 h-3.5 w-3.5" /> {isEditingLedger ? "Exit Edit" : "Edit Data"}
                        </Button>
                        <Button variant="outline" size="sm" className="text-[10px] font-bold uppercase h-9">
                          <Download className="mr-2 h-3.5 w-3.5" /> Export to Excel
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader className="bg-muted/30">
                          <TableRow>
                            <TableHead className="text-[10px] uppercase font-bold tracking-widest">Line Item / Account</TableHead>
                            <TableHead className="text-[10px] uppercase font-bold tracking-widest">Year</TableHead>
                            <TableHead className="text-right text-[10px] uppercase font-bold tracking-widest">Value</TableHead>
                            {isEditingLedger && <TableHead className="w-[100px]"></TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {currentStatementData.map((item: any) => (
                            <TableRow key={item.id} className={cn(item.isVerified ? "bg-green-50/20" : "")}>
                              <TableCell className="font-medium">
                                {isEditingLedger ? <Input defaultValue={item.lineItem} className="h-8 text-xs" id={`li-${item.id}`} /> : item.lineItem}
                              </TableCell>
                              <TableCell className="text-xs font-bold">{item.year}</TableCell>
                              <TableCell className="text-right font-mono font-bold text-primary">
                                {isEditingLedger ? <Input type="number" defaultValue={item.value} className="h-8 text-xs text-right w-32 ml-auto" id={`val-${item.id}`} /> : item.value.toLocaleString(undefined, { style: 'currency', currency: item.currency })}
                              </TableCell>
                              {isEditingLedger && (
                                <TableCell className="text-right">
                                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => {
                                    const li = (document.getElementById(`li-${item.id}`) as HTMLInputElement).value;
                                    const val = parseFloat((document.getElementById(`val-${item.id}`) as HTMLInputElement).value);
                                    handleSaveEdit(item.id, val, li);
                                  }}>
                                    {savingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 text-primary" />}
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                    <CardFooter className="bg-muted/5 py-3 border-t">
                      <div className="flex items-center gap-2 text-[10px] font-bold text-green-600 uppercase tracking-widest">
                        <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                        Automatically Generated Ledger Sync Active
                      </div>
                    </CardFooter>
                  </Card>

                  <div className="grid gap-6 lg:grid-cols-2">
                    <Card className="border-none shadow-sm bg-white p-6 flex flex-col items-center text-center space-y-4">
                      <div className="bg-primary/10 p-4 rounded-full"><FileSpreadsheet className="h-8 w-8 text-primary" /></div>
                      <div>
                        <h4 className="font-bold text-sm">{caseData.name}_Financial_Model.xlsx</h4>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold mt-1">Ready for export • 12.4 MB</p>
                      </div>
                      <div className="flex gap-2 w-full">
                        <Button className="flex-1 text-[10px] font-bold uppercase h-10 px-0"><Download className="mr-2 h-3.5 w-3.5" /> Download</Button>
                        <Button variant="outline" className="flex-1 text-[10px] font-bold uppercase h-10 px-0"><Send className="mr-2 h-3.5 w-3.5" /> Send to Analyst</Button>
                      </div>
                      <Button variant="secondary" className="w-full text-[10px] font-bold uppercase h-10"><Database className="mr-2 h-3.5 w-3.5" /> Open in Spreadsheet</Button>
                    </Card>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="industry">
              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="border-none shadow-sm bg-white">
                  <CardHeader className="border-b py-6"><CardTitle className="text-lg font-bold font-headline">Classification Profiling</CardTitle></CardHeader>
                  <CardContent className="p-8">
                    {!caseData.industry ? (
                      <div className="text-center py-12">
                        <Button onClick={handleIndustryAnalysis} disabled={isAnalyzingIndustry} className="bg-accent font-bold uppercase text-xs">
                          {isAnalyzingIndustry ? <Loader2 className="mr-2 animate-spin" /> : "Suggest Industry Codes"}
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
                             <Badge>NAICS</Badge><span className="font-mono font-bold text-xl">{caseData.industry.naicsCode || 'Pending'}</span>
                          </div>
                          <div className="flex items-center justify-between p-5 border rounded-2xl">
                             <Badge>SIC</Badge><span className="font-mono font-bold text-xl">{caseData.industry.sicCode || 'Pending'}</span>
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
