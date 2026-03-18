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
  Search,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Send,
  AlertCircle,
  FileSearch,
  History,
  FileBarChart,
  Grid3X3,
  ChevronRight,
  Copy
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { getCaseDetails } from "@/app/actions/cases"
import { addDocument } from "@/app/actions/documents"
import { runFinancialExtraction, runIndustryAnalysis, updateFinancialValue, approveFinancialValues, askBinder, runTtmNormalization } from "@/app/actions/ai-actions"
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
import { Progress } from "@/components/ui/progress"
import ExcelJS from 'exceljs';

export default function ProjectDetail() {
  const { id } = useParams()
  const [isExtracting, setIsExtracting] = React.useState(false)
  const [isAnalyzingIndustry, setIsAnalyzingIndustry] = React.useState(false)
  const [caseData, setCaseData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [isUploading, setIsUploading] = React.useState(false)
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [availableConnectors, setAvailableConnectors] = React.useState<any[]>([])
  
  const [isEditingLedger, setIsEditingLedger] = React.useState(false)
  const [activeStatementType, setActiveStatementType] = React.useState<string | null>(null)
  const [savingId, setSavingId] = React.useState<string | null>(null)

  const [chatQuery, setChatQuery] = React.useState("")
  const [chatAnswer, setChatAnswer] = React.useState<string | null>(null)
  const [isChatting, setIsChatting] = React.useState(false)

  const [isNormalizing, setIsNormalizing] = React.useState(false)
  const [ttmReport, setTtmReport] = React.useState<any>(null)

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

  const statementMetadata = React.useMemo(() => {
    const meta: Record<string, { years: string[]; yearRange: string; progress: number; total: number; verified: number; confidence: 'high' | 'medium' | 'low' }> = {};
    
    statementTypes.forEach(type => {
      const items = groupedData[type];
      const years = Array.from(new Set(items.map((i: any) => i.year))).sort() as string[];
      
      const total = items.length;
      const verified = items.filter((i: any) => i.isVerified).length;
      const progress = total > 0 ? (verified / total) * 100 : 0;
      
      const confidence = progress === 100 ? 'high' : total > 20 ? 'medium' : 'low';

      let range = "N/A";
      if (years.length > 0) {
        const min = years[0];
        const max = years[years.length - 1];
        range = min === max ? `${min}` : `${min}-${max}`;
      }

      meta[type] = { years, yearRange: range, progress, total, verified, confidence };
    });
    return meta;
  }, [statementTypes, groupedData]);

  const pivotData = React.useMemo(() => {
    if (!activeStatementType || !groupedData[activeStatementType]) return { years: [], rows: [] };
    
    const items = groupedData[activeStatementType];
    const years = Array.from(new Set(items.map((i: any) => i.year))).sort() as string[];
    const lineItemNames = Array.from(new Set(items.map((i: any) => i.lineItem))).sort() as string[];
    
    const rows = lineItemNames.map(name => {
      const row: any = { lineItem: name };
      years.forEach((year, idx) => {
        const found = items.find((i: any) => i.lineItem === name && i.year === year);
        row[year] = found; 
        
        if (idx > 0) {
          const prevYear = years[idx - 1];
          const prevFound = items.find((i: any) => i.lineItem === name && i.year === prevYear);
          if (found && prevFound && prevFound.value !== 0) {
            const pctChange = ((found.value - prevFound.value) / Math.abs(prevFound.value)) * 100;
            row[`${year}_var`] = pctChange;
          }
        }
      });
      return row;
    });

    return { years, rows };
  }, [activeStatementType, groupedData]);

  const ttmYears = React.useMemo(() => {
    if (!ttmReport) return [];
    return Array.from(new Set(ttmReport.standardizedReport.flatMap((c: any) => c.items.flatMap((i: any) => Object.keys(i.valuesByYear))))).sort() as string[];
  }, [ttmReport]);

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

  const handleTtmNormalization = async () => {
    setIsNormalizing(true);
    try {
      const res = await runTtmNormalization(id as string);
      setTtmReport(res);
      toast({ title: "TTM Report Generated", description: "Universal accounting mapping complete." });
    } catch (error: any) {
      toast({ title: "Normalization Error", description: error.message, variant: "destructive" });
    } finally {
      setIsNormalizing(false);
    }
  }

  const handleCopyTtmToClipboard = () => {
    if (!ttmReport || !caseData) return;
    
    const reportTitle = activeStatementType || "Universal TTM";
    let text = `Client: ${caseData.client}\tReport: ${reportTitle} Normalization Report\n\n`;
    const headers = ["Standardized Item", ...ttmYears, "Trailing 12m"];
    text += headers.join("\t") + "\n";

    ttmReport.standardizedReport.forEach((cat: any) => {
      text += `\n${cat.category.toUpperCase()}\n`;
      cat.items.forEach((item: any) => {
        const row = [
          item.standardizedLabel,
          ...ttmYears.map(year => item.valuesByYear[year] || 0),
          item.ttmValue || 0
        ];
        text += row.join("\t") + "\n";
      });
    });

    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied to Clipboard", description: "Data formatted for Excel (tab-separated)." });
    }).catch(err => {
      toast({ title: "Copy Failed", variant: "destructive" });
    });
  }

  const handleDownloadXlsx = async () => {
    if (!ttmReport || !caseData) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('TTM Analysis');

    // Professional Header Setup
    worksheet.addRow(['VALUVAULT AI | PROFESSIONAL FORENSIC VALUATION REPORT']);
    worksheet.addRow(['CLIENT:', caseData.client]);
    worksheet.addRow(['REPORT:', `${activeStatementType || "Universal TTM"} Normalization Report`]);
    worksheet.addRow(['DATE:', format(new Date(), 'MMM d, yyyy')]);
    worksheet.addRow([]); // Spacer Row

    // Main Header Row
    const headerRow = worksheet.addRow(["Standardized Item", ...ttmYears, "Trailing 12m"]);
    
    // Style the Header Row
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2563EB' } // Primary Blue
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Populate Data with Styling
    ttmReport.standardizedReport.forEach((cat: any) => {
      // Category Heading Row
      const catRow = worksheet.addRow([cat.category.toUpperCase()]);
      catRow.getCell(1).font = { bold: true, size: 11, color: { argb: 'FF1E40AF' } };
      catRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF3F4F6' } // Light Muted Gray
      };

      cat.items.forEach((item: any) => {
        const rowData = [
          item.standardizedLabel,
          ...ttmYears.map(year => item.valuesByYear[year] || 0),
          item.ttmValue || 0
        ];
        const row = worksheet.addRow(rowData);
        
        // Format Currency Cells
        for (let i = 2; i <= row.cellCount; i++) {
          row.getCell(i).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
          row.getCell(i).alignment = { horizontal: 'right' };
        }
        
        // Style Trailing 12m Column
        const ttmCell = row.getCell(row.cellCount);
        ttmCell.font = { bold: true };
        ttmCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFEFF6FF' } // Very Light Blue
        };
      });
      worksheet.addRow([]); // Spacer after each category
    });

    // Column Sizing
    worksheet.columns = [
      { width: 35 }, // Item label
      ...ttmYears.map(() => ({ width: 15 })), // Years
      { width: 20 } // TTM Column
    ];

    // Style the Report Title
    worksheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1D4ED8' } };
    
    // Generate and Trigger Download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${caseData.client.replace(/\s+/g, '_')}_Forensic_TTM_Report.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    toast({ title: "Download Started", description: "Styled Excel file generated successfully." });
  };

  const handleBinderChat = async () => {
    if (!chatQuery) return;
    setIsChatting(true);
    try {
      const res = await askBinder(id as string, chatQuery);
      setChatAnswer(res.answer);
    } catch (error) {
      toast({ title: "Discovery Error", variant: "destructive" });
    } finally {
      setIsChatting(false);
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
    toast({ title: "Export Started" });
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
      toast({ title: "Document Added to Binder", description: "Initial status set to VERIFIED." })
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
                  <DialogDescription>Attach documents to the matter binder. Initial status will be VERIFIED.</DialogDescription>
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
                      {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save to Binder"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <main className="flex-1 p-8 bg-background/30 max-w-7xl mx-auto w-full">
          <Tabs defaultValue="analysis" className="space-y-6">
            <TabsList className="bg-white/80 border w-full justify-start p-1 h-12 shadow-sm rounded-xl overflow-x-auto overflow-y-hidden">
              <TabsTrigger value="documents" className="data-[state=active]:bg-primary data-[state=active]:text-white px-8 font-bold text-xs uppercase tracking-widest rounded-lg h-full">
                <FileText className="mr-2 h-4 w-4" />
                Custody Binder
              </TabsTrigger>
              <TabsTrigger value="analysis" className="data-[state=active]:bg-primary data-[state=active]:text-white px-8 font-bold text-xs uppercase tracking-widest rounded-lg h-full">
                <TableIcon className="mr-2 h-4 w-4" />
                Forensic Ledger
              </TabsTrigger>
              <TabsTrigger value="ttm" className="data-[state=active]:bg-primary data-[state=active]:text-white px-8 font-bold text-xs uppercase tracking-widest rounded-lg h-full">
                <FileBarChart className="mr-2 h-4 w-4" />
                TTM Analysis
              </TabsTrigger>
              <TabsTrigger value="industry" className="data-[state=active]:bg-primary data-[state=active]:text-white px-8 font-bold text-xs uppercase tracking-widest rounded-lg h-full">
                <Globe className="mr-2 h-4 w-4" />
                Benchmarks
              </TabsTrigger>
              <TabsTrigger value="discovery" className="data-[state=active]:bg-primary data-[state=active]:text-white px-8 font-bold text-xs uppercase tracking-widest rounded-lg h-full">
                <Search className="mr-2 h-4 w-4" />
                Discovery Chat
              </TabsTrigger>
            </TabsList>

            <TabsContent value="documents">
              <div className="grid gap-6 lg:grid-cols-4">
                <div className="lg:col-span-3 space-y-6">
                  <Card className="border-none shadow-sm overflow-hidden bg-white">
                    <CardHeader className="border-b py-4">
                      <CardTitle className="text-lg font-bold font-headline">Source Evidence</CardTitle>
                      <CardDescription className="text-xs">Initial status: VERIFIED | Successful AI Run: EXTRACTED</CardDescription>
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
                                "text-[10px] uppercase font-bold tracking-widest px-3 py-1 rounded-full",
                                doc.status === "EXTRACTED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-blue-50 text-blue-700 border-blue-200"
                              )}
                            >
                              {doc.status || "VERIFIED"}
                            </Badge>
                          </div>
                        ))}
                        {caseData.documents.length === 0 && (
                          <div className="p-12 text-center text-muted-foreground text-sm font-medium">Binder is empty. Upload evidence to begin.</div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <div className="space-y-6">
                  <Card className="bg-primary text-white border-none shadow-xl relative overflow-hidden">
                    <CardHeader><CardTitle className="text-sm font-bold uppercase tracking-widest">AI Extraction</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-xs opacity-80">Transition matter files from VERIFIED to EXTRACTED status.</p>
                      <Button onClick={handleExtraction} disabled={isExtracting || caseData.documents.length === 0} className="w-full bg-accent hover:bg-accent/90 border-none font-bold uppercase text-[10px] tracking-widest h-11 shadow-lg">
                        {isExtracting ? "Extracting..." : "Run Extraction"}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="analysis">
              <div className="space-y-2 mb-6">
                <h2 className="text-2xl font-black text-primary tracking-tight">Forensic Financial Ledger</h2>
                <div className="flex items-center gap-4">
                  <p className="text-sm text-muted-foreground font-medium">AI normalization with multi-year comparison view.</p>
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-100 text-[9px] font-bold uppercase tracking-widest">
                    <Sparkles className="h-3 w-3 fill-orange-500" />
                    Variance Radar Active
                  </div>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-12 items-start">
                <Card className="lg:col-span-3 border-none shadow-sm overflow-hidden bg-white">
                  <CardHeader className="bg-muted/30 border-b py-4">
                    <CardTitle className="text-xs font-bold uppercase tracking-widest">Reports Catalog</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {statementTypes.map((type) => {
                        const meta = statementMetadata[type];
                        const isActive = activeStatementType === type;
                        
                        return (
                          <button 
                            key={type} 
                            onClick={() => setActiveStatementType(type)} 
                            className={cn(
                              "w-full p-4 text-left transition-all relative group",
                              isActive ? "bg-primary/5 border-l-4 border-primary" : "hover:bg-muted/50"
                            )}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-3">
                                <FileSpreadsheet className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                                <span className={cn("text-[11px] font-bold", isActive ? "text-primary" : "text-slate-700")}>
                                  {type}
                                </span>
                              </div>
                              <div className={cn(
                                "h-2 w-2 rounded-full",
                                meta.confidence === 'high' ? "bg-emerald-500" : meta.confidence === 'medium' ? "bg-amber-500" : "bg-rose-500"
                              )} title={`AI Confidence: ${meta.confidence}`} />
                            </div>

                            <div className="flex items-center justify-between mb-3 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                              <span>Range: {meta.yearRange}</span>
                              <span className={cn(meta.progress === 100 ? "text-emerald-600" : "")}>
                                {meta.verified} / {meta.total} Verified
                              </span>
                            </div>

                            <div className="space-y-1">
                              <Progress value={meta.progress} className="h-1 bg-muted" />
                              <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-tighter opacity-40">
                                <span>Audit Progress</span>
                                <span>{Math.round(meta.progress)}%</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                      {statementTypes.length === 0 && (
                        <div className="p-12 text-center">
                          <FileSearch className="h-8 w-8 mx-auto mb-4 text-muted-foreground/20" />
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                            No Statements Detected
                          </p>
                          <p className="text-[9px] text-muted-foreground mt-2">
                            Upload evidence to begin extraction
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="bg-muted/10 p-4 border-t">
                    <div className="space-y-2 w-full">
                      <p className="text-[8px] font-bold uppercase text-muted-foreground tracking-widest mb-2">AI Integrity Keys</p>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span className="text-[8px] font-medium text-muted-foreground uppercase">High Confidence (Verified PDF)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        <span className="text-[8px] font-medium text-muted-foreground uppercase">Manual Audit Required (Scan)</span>
                      </div>
                    </div>
                  </CardFooter>
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
                              {pivotData.years.map((year, yIdx) => {
                                const entry = row[year];
                                const variance = row[`${year}_var`];
                                const isFlagged = variance && Math.abs(variance) > 50;
                                
                                return (
                                  <TableCell key={year} className={cn("text-center", isFlagged ? "bg-orange-50/50" : "")}>
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
                                      <div className="flex flex-col items-center">
                                        <span className={cn("font-bold text-sm", entry ? "text-primary" : "text-muted-foreground italic")}>
                                          {entry ? entry.value.toLocaleString(undefined, { style: 'currency', currency: entry.currency || 'USD' }) : "-"}
                                        </span>
                                        {variance !== undefined && (
                                          <div className={cn(
                                            "flex items-center gap-0.5 text-[9px] font-black uppercase mt-1",
                                            variance > 0 ? "text-emerald-600" : "text-rose-600"
                                          )}>
                                            {variance > 0 ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                                            {Math.abs(variance).toFixed(1)}%
                                          </div>
                                        )}
                                      </div>
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

            <TabsContent value="ttm">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-primary tracking-tight">Normalized TTM Report</h2>
                    <p className="text-sm text-muted-foreground font-medium">Universal Trailing Twelve Months Analysis (Formatted for Valuation)</p>
                  </div>
                  <div className="flex gap-3">
                    <Button onClick={handleTtmNormalization} disabled={isNormalizing} className="bg-primary shadow-lg font-bold uppercase text-xs h-11 px-6">
                      {isNormalizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Grid3X3 className="mr-2 h-4 w-4" />}
                      Generate Structured TTM
                    </Button>
                    <Button 
                      onClick={handleDownloadXlsx}
                      disabled={!ttmReport}
                      variant="outline" 
                      className="h-11 px-6 font-bold uppercase text-xs bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download .xlsx
                    </Button>
                    <Button 
                      onClick={handleCopyTtmToClipboard}
                      disabled={!ttmReport}
                      variant="outline" 
                      className="h-11 px-6 font-bold uppercase text-xs"
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copy/Paste
                    </Button>
                  </div>
                </div>

                {!ttmReport ? (
                  <Card className="border-2 border-dashed border-primary/20 bg-primary/5 py-24 text-center">
                    <CardContent>
                      <FileBarChart className="h-12 w-12 mx-auto mb-6 text-primary/40" />
                      <h3 className="text-xl font-bold text-primary tracking-tight">Generate TTM Projection</h3>
                      <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto font-medium leading-relaxed">
                        The AI will map your raw forensic ledger entries to universal accounting categories and calculate trailing projections.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-8">
                    <div className="bg-primary/5 p-8 rounded-2xl border text-center shadow-inner">
                      <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-primary/60 mb-2">Internal Valuation Workpaper</h3>
                      <h2 className="text-3xl font-black text-primary tracking-tight">{caseData.client}</h2>
                      <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground mt-1">
                        {activeStatementType || "Universal TTM"} Normalization Report
                      </p>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <Card className="bg-white border-none shadow-sm">
                        <CardHeader className="pb-2"><CardTitle className="text-[10px] uppercase font-bold text-muted-foreground">EBITDA (TTM)</CardTitle></CardHeader>
                        <CardContent><p className="text-2xl font-black text-primary">${Object.values(ttmReport.summary.ebitda).pop()?.toLocaleString()}</p></CardContent>
                      </Card>
                      <Card className="bg-white border-none shadow-sm">
                        <CardHeader className="pb-2"><CardTitle className="text-[10px] uppercase font-bold text-muted-foreground">Net Income (TTM)</CardTitle></CardHeader>
                        <CardContent><p className="text-2xl font-black text-emerald-600">${Object.values(ttmReport.summary.netIncome).pop()?.toLocaleString()}</p></CardContent>
                      </Card>
                    </div>

                    <Card className="border-none shadow-sm overflow-hidden bg-white">
                      <Table>
                        <TableHeader className="bg-muted/30">
                          <TableRow>
                            <TableHead className="text-[10px] uppercase font-bold tracking-widest min-w-[250px]">Standardized Item</TableHead>
                            {ttmYears.map(year => (
                              <TableHead key={year} className="text-center text-[10px] uppercase font-bold tracking-widest">{year}</TableHead>
                            ))}
                            <TableHead className="text-center text-[10px] uppercase font-bold tracking-widest bg-primary/5 text-primary">Trailing 12m</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ttmReport.standardizedReport.map((cat: any) => (
                            <React.Fragment key={cat.category}>
                              <TableRow className="bg-muted/10">
                                <TableCell colSpan={ttmYears.length + 2} className="text-[10px] font-black uppercase text-primary tracking-[0.2em] py-2 bg-primary/5">
                                  {cat.category}
                                </TableCell>
                              </TableRow>
                              {cat.items.map((item: any, iIdx: number) => (
                                <TableRow key={iIdx} className="group hover:bg-muted/30">
                                  <TableCell className="pl-8">
                                    <div className="flex flex-col">
                                      <span className="font-bold text-sm">{item.standardizedLabel}</span>
                                      <span className="text-[9px] uppercase font-medium text-muted-foreground/60">{item.originalLabel}</span>
                                    </div>
                                  </TableCell>
                                  {ttmYears.map(year => (
                                    <TableCell key={year} className="text-center font-medium text-slate-700">
                                      {item.valuesByYear[year]?.toLocaleString(undefined, { style: 'currency', currency: 'USD' }) || "-"}
                                    </TableCell>
                                  ))}
                                  <TableCell className="text-center font-black text-primary bg-primary/5">
                                    {item.ttmValue?.toLocaleString(undefined, { style: 'currency', currency: 'USD' }) || "-"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </React.Fragment>
                          ))}
                        </TableBody>
                      </Table>
                    </Card>
                  </div>
                )}
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

            <TabsContent value="discovery">
              <div className="grid gap-6 lg:grid-cols-12">
                <Card className="lg:col-span-8 border-none shadow-sm bg-white overflow-hidden flex flex-col min-h-[500px]">
                  <CardHeader className="bg-primary text-white">
                    <CardTitle className="text-lg font-bold font-headline flex items-center gap-2">
                      <Sparkles className="h-5 w-5 fill-accent text-accent" />
                      Binder Intelligence Chat
                    </CardTitle>
                    <CardDescription className="text-white/60">Ask questions about your uploaded documents and forensic ledger.</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 p-6 flex flex-col">
                    <div className="flex-1 space-y-6 overflow-y-auto mb-6">
                      {chatAnswer ? (
                        <div className="space-y-4">
                          <div className="bg-muted p-4 rounded-2xl rounded-tl-none self-start max-w-[80%] border">
                            <p className="text-sm font-medium leading-relaxed">{chatAnswer}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-20 opacity-30">
                          <Search className="h-12 w-12 mx-auto mb-4" />
                          <p className="text-sm font-bold uppercase tracking-widest">Execute Discovery Query</p>
                        </div>
                      )}
                    </div>
                    <div className="relative mt-auto">
                      <Input 
                        value={chatQuery}
                        onChange={(e) => setChatQuery(e.target.value)}
                        placeholder="e.g., 'Summarize the 2022 revenue trends'..." 
                        className="pr-20 h-14 bg-muted/30 border-none shadow-inner"
                        onKeyDown={(e) => e.key === 'Enter' && handleBinderChat()}
                      />
                      <Button 
                        onClick={handleBinderChat}
                        disabled={isChatting || !chatQuery}
                        className="absolute right-1.5 top-1.5 h-11 bg-primary px-6"
                      >
                        {isChatting ? <Loader2 className="animate-spin h-4 w-4" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <div className="lg:col-span-4 space-y-6">
                  <Card className="border-none shadow-sm bg-accent text-white overflow-hidden">
                    <CardHeader><CardTitle className="text-sm font-bold uppercase tracking-widest">Sample Queries</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {[
                        "What is the largest expense in 2021?",
                        "Did EBITDA increase YOY?",
                        "Are there any missing statements?",
                        "Summarize the industry classification."
                      ].map(q => (
                        <button 
                          key={q} 
                          onClick={() => setChatQuery(q)}
                          className="w-full text-left p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-xs font-bold border border-white/10"
                        >
                          {q}
                        </button>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
