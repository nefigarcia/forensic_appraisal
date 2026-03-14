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
  Plus,
  ArrowLeft,
  Loader2,
  Globe,
  Calculator,
  UploadCloud,
  FileCheck,
  ImageIcon,
  CheckCircle2,
  Save,
  Download,
  FileSpreadsheet,
  Edit3,
  Database
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { getCaseDetails } from "@/app/actions/cases"
import { addDocument } from "@/app/actions/documents"
import { runFinancialExtraction, runIndustryAnalysis, updateFinancialValue, approveFinancialValues } from "@/app/actions/ai-actions"
import { getExternalConnections } from "@/app/actions/connectors"
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
  const [availableConnectors, setAvailableConnectors] = React.useState<any[]>([])
  
  // Ledger State
  const [isEditingLedger, setIsEditingLedger] = React.useState(false)
  const [activeStatementType, setActiveStatementType] = React.useState<string | null>(null)
  const [savingId, setSavingId] = React.useState<string | null>(null)

  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const loadData = React.useCallback(async () => {
    try {
      const [data, connectors] = await Promise.all([
        getCaseDetails(id as string),
        getExternalConnections()
      ]);
      
      setCaseData(data);
      setAvailableConnectors(connectors);
      
      if (data?.financialData?.length > 0 && !activeStatementType) {
        setActiveStatementType(data.financialData[0].statementType);
      }
    } catch (e) {
      toast({ title: "Error", description: "Could not load case details", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [id, activeStatementType])

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const groupedData = React.useMemo(() => {
    if (!caseData?.financialData) return {};
    return caseData.financialData.reduce((acc: any, item: any) => {
      const key = item.statementType;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
  }, [caseData]);

  const statementTypes = React.useMemo(() => {
    return Object.keys(groupedData).sort();
  }, [groupedData]);

  const statementYearRanges = React.useMemo(() => {
    const ranges: Record<string, string> = {};
    statementTypes.forEach(type => {
      const years = groupedData[type]
        .map((i: any) => parseInt(i.year))
        .filter((y: any) => !isNaN(y))
        .sort((a: number, b: number) => a - b);
      if (years.length > 0) {
        const min = years[0];
        const max = years[years.length - 1];
        ranges[type] = min === max ? `${min}` : `${min}-${max}`;
      }
    });
    return ranges;
  }, [statementTypes, groupedData]);

  const pivotData = React.useMemo(() => {
    if (!activeStatementType || !groupedData[activeStatementType]) return { years: [], rows: [] };
    
    const items = groupedData[activeStatementType];
    const years = Array.from(new Set(items.map((i: any) => i.year))).sort() as string[];
    const lineItemNames = Array.from(new Set(items.map((i: any) => i.lineItem))).sort() as string[];
    
    const rows = lineItemNames.map(name => {
      const row: any = { lineItem: name };
      years.forEach(year => {
        const found = items.find((i: any) => i.lineItem === name && i.year === year);
        row[year] = found; 
      });
      return row;
    });

    return { years, rows };
  }, [activeStatementType, groupedData]);

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
    if (!activeStatementType || !pivotData.years.length) return
    try {
      for (const year of pivotData.years) {
        await approveFinancialValues(id as string, activeStatementType, year)
      }
      toast({ title: "Statement Approved", description: "All entries for this report marked as verified." })
      await loadData()
    } catch (error) {
      toast({ title: "Approval Error", variant: "destructive" })
    }
  }

  const handleExport = () => {
    if (!pivotData.rows.length) return;
    const headers = ["Line Item / Account", ...pivotData.years];
    const csvRows = pivotData.rows.map((row: any) => {
      const lineValues = pivotData.years.map(year => row[year]?.value || 0);
      return [`"${row.lineItem}"`, ...lineValues];
    });
    
    const csvContent = [headers, ...csvRows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${activeStatementType?.replace(/\s+/g, '_')}_Forensic_Ledger.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Export Started", description: "Multi-year CSV file is downloading." });
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
              <DialogContent className="sm:max-w-[550px]">
                <DialogHeader>
                  <DialogTitle>Add Forensic Evidence</DialogTitle>
                  <DialogDescription>Attach documents to the matter binder. If mirrored storage is connected, you can sync files to your firm's external cloud.</DialogDescription>
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
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 col-span-2">
                      <Label htmlFor="name" className="text-[10px] font-bold uppercase tracking-wider">Display Name</Label>
                      <Input id="name" name="name" defaultValue={selectedFile?.name || ""} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="type" className="text-[10px] font-bold uppercase tracking-wider">Doc Type</Label>
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
                    <div className="space-y-2">
                      <Label htmlFor="storageProvider" className="text-[10px] font-bold uppercase tracking-wider">Storage Vault</Label>
                      <Select name="storageProvider" defaultValue="s3">
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="s3">S3 Forensic Vault (Primary)</SelectItem>
                          {availableConnectors.map(conn => (
                            <SelectItem key={conn.id} value={conn.provider}>
                              {conn.provider === 'microsoft' ? 'SharePoint / OneDrive' : conn.provider.toUpperCase()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={isUploading || !selectedFile} className="w-full bg-primary font-bold uppercase text-xs h-11">
                      {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save & Synchronize"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <main className="flex-1 p-8 bg-background/30 max-w-7xl mx-auto w-full">
          <Tabs defaultValue="analysis" className="space-y-6">
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
                            <Badge 
                              variant='outline' 
                              className={cn(
                                "text-[10px] uppercase font-bold tracking-widest",
                                doc.status === "EXTRACTED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-blue-50 text-blue-700 border-blue-200"
                              )}
                            >
                              {doc.status || "VERIFIED"}
                            </Badge>
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
                <h2 className="text-2xl font-black text-primary tracking-tight">Forensic Financial Ledger</h2>
                <p className="text-sm text-muted-foreground font-medium">AI normalization with multi-year comparison view.</p>
              </div>

              <div className="grid gap-6 lg:grid-cols-12 items-start">
                <Card className="lg:col-span-3 border-none shadow-sm overflow-hidden bg-white">
                  <CardHeader className="bg-muted/30 border-b py-4">
                    <CardTitle className="text-xs font-bold uppercase tracking-widest">Reports Detected</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {statementTypes.map((type) => {
                        const isAllVerified = groupedData[type].every((i: any) => i.isVerified);
                        const range = statementYearRanges[type];
                        return (
                          <button 
                            key={type} 
                            onClick={() => setActiveStatementType(type)} 
                            className={cn("w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors", activeStatementType === type ? "bg-primary/5 border-l-4 border-primary" : "")}
                          >
                            <div className="flex items-center gap-3">
                              <FileSpreadsheet className={cn("h-4 w-4", activeStatementType === type ? "text-primary" : "text-muted-foreground")} />
                              <div className="flex flex-col">
                                <span className={cn("text-[11px] font-bold", activeStatementType === type ? "text-primary" : "text-muted-foreground")}>
                                  {type} {range ? `(${range})` : ''}
                                </span>
                                <span className="text-[9px] font-bold text-muted-foreground opacity-60 uppercase">Multi-Year Audit View</span>
                              </div>
                            </div>
                            {isAllVerified && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                          </button>
                        );
                      })}
                      {statementTypes.length === 0 && <div className="p-8 text-center text-xs text-muted-foreground">Run extraction to detect statements</div>}
                    </div>
                  </CardContent>
                </Card>

                <div className="lg:col-span-9 space-y-6">
                  <Card className="border-none shadow-sm overflow-hidden bg-white">
                    <CardHeader className="flex flex-row items-center justify-between border-b py-4 bg-muted/10">
                      <div>
                        <CardTitle className="text-sm font-bold uppercase tracking-widest">{activeStatementType || "Select Audit Target"}</CardTitle>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button onClick={handleApprove} variant="outline" size="sm" className="bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 text-[10px] font-bold uppercase h-9">
                          <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Approve Report
                        </Button>
                        <Button onClick={() => setIsEditingLedger(!isEditingLedger)} variant="outline" size="sm" className="text-[10px] font-bold uppercase h-9">
                          <Edit3 className="mr-2 h-3.5 w-3.5" /> {isEditingLedger ? "Exit Edit" : "Edit Values"}
                        </Button>
                        <Button onClick={handleExport} variant="outline" size="sm" className="text-[10px] font-bold uppercase h-9">
                          <Download className="mr-2 h-3.5 w-3.5" /> Export Catalog
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0 overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-muted/30">
                          <TableRow>
                            <TableHead className="text-[10px] uppercase font-bold tracking-widest min-w-[250px]">Line Item / Account</TableHead>
                            {pivotData.years.map(year => (
                              <TableHead key={year} className="text-center text-[10px] uppercase font-bold tracking-widest min-w-[150px]">{year}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pivotData.rows.map((row: any, idx: number) => (
                            <TableRow key={idx}>
                              <TableCell className="font-medium text-slate-700">
                                {row.lineItem}
                              </TableCell>
                              {pivotData.years.map(year => {
                                const entry = row[year];
                                return (
                                  <TableCell key={year} className="text-center">
                                    {isEditingLedger && entry ? (
                                      <div className="flex items-center gap-1 justify-center">
                                        <Input 
                                          type="number" 
                                          defaultValue={entry.value} 
                                          className="h-8 text-xs text-center w-28 font-bold text-primary" 
                                          id={`val-${entry.id}`} 
                                        />
                                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => {
                                          const el = document.getElementById(`val-${entry.id}`) as HTMLInputElement;
                                          if (el) {
                                            const val = parseFloat(el.value);
                                            handleSaveEdit(entry.id, val, row.lineItem);
                                          }
                                        }}>
                                          {savingId === entry.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 text-primary" />}
                                        </Button>
                                      </div>
                                    ) : (
                                      <span className={cn("font-bold text-sm", entry ? "text-primary" : "text-muted-foreground italic")}>
                                        {entry ? entry.value.toLocaleString(undefined, { style: 'currency', currency: entry.currency || 'USD' }) : "-"}
                                      </span>
                                    )}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                    <CardFooter className="bg-muted/5 py-3 border-t">
                      <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                        <CheckCircle2 className="h-3 w-3" />
                        Multi-Year Comparison Integrity Verified
                      </div>
                    </CardFooter>
                  </Card>
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
