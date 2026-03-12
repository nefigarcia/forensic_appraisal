
"use client"

import * as React from "react"
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { 
  ArrowLeft, 
  Calculator, 
  BarChart2, 
  TrendingUp, 
  Zap, 
  Download,
  Info,
  Save,
  Loader2
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { getCaseDetails, saveValuation } from "@/app/actions/cases"
import { toast } from "@/hooks/use-toast"

export default function ValuationEngine() {
  const { id } = useParams()
  const [ebitda, setEbitda] = React.useState(1250000)
  const [multiplier, setMultiplier] = React.useState(6.5)
  const [growthRate, setGrowthRate] = React.useState(5)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    async function load() {
      const data = await getCaseDetails(id as string)
      if (data?.valuationModels?.[0]) {
        const last = data.valuationModels[0]
        setEbitda(last.ebitda)
        setMultiplier(last.multiplier)
        setGrowthRate(last.growthRate)
      }
    }
    load()
  }, [id])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await saveValuation(id as string, { ebitda, multiplier, growthRate })
      toast({ title: "Valuation Saved", description: "Model parameters persisted to database." })
    } catch (e) {
      toast({ title: "Error", description: "Could not save valuation.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }
  
  const valuationResult = ebitda * multiplier
  const projectedValuation = valuationResult * (1 + growthRate / 100)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white shadow-sm z-10">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <Link href={`/projects/${id}`} className="p-2 hover:bg-muted rounded-full transition-colors">
              <ArrowLeft className="h-4 w-4 text-primary" />
            </Link>
            <h1 className="text-xl font-bold font-headline text-primary tracking-tight">Valuation Engine</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleSave} disabled={isSaving} className="font-bold uppercase text-xs h-10">
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Model
            </Button>
            <Button className="bg-primary shadow-lg font-bold uppercase text-xs tracking-widest h-10">
              <Download className="mr-2 h-4 w-4" />
              Export Calc Sheet
            </Button>
          </div>
        </header>

        <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
          <div className="grid gap-8 lg:grid-cols-12">
            <div className="lg:col-span-5 space-y-6">
              <Card className="border-none shadow-sm bg-white">
                <CardHeader>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <Calculator className="h-5 w-5 text-primary" />
                    Market Approach (Multiples)
                  </CardTitle>
                  <CardDescription>Adjust variables to calculate implied equity value</CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                  <div className="space-y-4">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Normalized EBITDA (LTM)</Label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-primary">$</span>
                      <Input 
                        type="number" 
                        value={ebitda} 
                        onChange={(e) => setEbitda(Number(e.target.value))}
                        className="pl-8 h-12 text-lg font-bold border-muted bg-muted/20 focus:bg-white" 
                      />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">EBITDA Multiplier</Label>
                      <span className="text-xl font-bold text-primary">{multiplier}x</span>
                    </div>
                    <Slider 
                      value={[multiplier]} 
                      min={1} 
                      max={20} 
                      step={0.1} 
                      onValueChange={(val) => setMultiplier(val[0])} 
                    />
                  </div>

                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Projected Annual Growth</Label>
                      <span className="text-xl font-bold text-accent">{growthRate}%</span>
                    </div>
                    <Slider 
                      value={[growthRate]} 
                      min={-20} 
                      max={50} 
                      step={1} 
                      onValueChange={(val) => setGrowthRate(val[0])} 
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="p-6 rounded-2xl bg-muted/40 border border-muted flex gap-4">
                <div className="bg-white p-3 rounded-xl h-fit shadow-sm">
                  <Info className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-primary mb-1">Model Precision</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                    Persisting this model ensures consistency across forensic reports.
                  </p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 space-y-6">
              <Card className="bg-primary text-white border-none shadow-2xl overflow-hidden relative min-h-[400px] flex flex-col justify-center text-center p-12">
                <div className="absolute top-0 right-0 p-8 opacity-10">
                  <TrendingUp className="h-64 w-64" />
                </div>
                <div className="space-y-8 relative">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-[0.3em] opacity-60 mb-4">Current Implied Equity Value</h3>
                    <div className="text-6xl lg:text-8xl font-black font-headline tracking-tighter">
                      ${(valuationResult / 1000000).toFixed(2)}M
                    </div>
                  </div>
                </div>
              </Card>

              <div className="grid grid-cols-2 gap-6">
                <Card className="border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer group">
                  <CardContent className="p-6 flex items-center gap-4">
                    <div className="bg-accent/10 p-3 rounded-xl group-hover:bg-accent group-hover:text-white transition-all">
                      <Zap className="h-5 w-5 text-accent group-hover:text-white" />
                    </div>
                    <div>
                      <h5 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Asset Approach</h5>
                      <p className="text-sm font-bold text-primary">Switch to Asset-Based</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer group">
                  <CardContent className="p-6 flex items-center gap-4">
                    <div className="bg-green-100 p-3 rounded-xl group-hover:bg-green-600 group-hover:text-white transition-all">
                      <BarChart2 className="h-5 w-5 text-green-600 group-hover:text-white" />
                    </div>
                    <div>
                      <h5 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Income Approach</h5>
                      <p className="text-sm font-bold text-primary">DCF Analysis Flow</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
