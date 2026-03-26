'use client'

import * as React from 'react'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  ArrowLeft, Calculator, TrendingUp, Download, Save, Loader2,
  Scale, BarChart2, DollarSign, Percent, Plus, Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { getCaseDetails, saveValuation } from '@/app/actions/cases'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtM(v: number) { return `$${(v / 1_000_000).toFixed(2)}M` }
function fmtK(v: number) { return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}` }
function pv(cashflow: number, rate: number, year: number) { return cashflow / Math.pow(1 + rate / 100, year) }

interface GpcmRow { company: string; ebitdaMultiple: number; revenueMultiple: number; weight: number }

// ─────────────────────────────────────────────────────────────────────────────
export default function ValuationEngine() {
  const { id } = useParams<{ id: string }>()
  const [caseData, setCaseData] = React.useState<any>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState('gpcm')

  // ── GPCM / Market Approach ────────────────────────────────────────────────
  const [ebitda, setEbitda]     = React.useState(1_250_000)
  const [multiplier, setMultiplier] = React.useState(6.5)
  const [gpcmWeight, setGpcmWeight] = React.useState(60)
  const [gpcmRows, setGpcmRows] = React.useState<GpcmRow[]>([
    { company: 'Guideline Co. A', ebitdaMultiple: 6.2, revenueMultiple: 1.1, weight: 33 },
    { company: 'Guideline Co. B', ebitdaMultiple: 7.1, revenueMultiple: 1.3, weight: 33 },
    { company: 'Guideline Co. C', ebitdaMultiple: 6.8, revenueMultiple: 1.0, weight: 34 },
  ])

  // ── DCF ───────────────────────────────────────────────────────────────────
  const [dcfYear1, setDcfYear1] = React.useState(300_000)
  const [dcfYear2, setDcfYear2] = React.useState(330_000)
  const [dcfYear3, setDcfYear3] = React.useState(360_000)
  const [dcfYear4, setDcfYear4] = React.useState(395_000)
  const [dcfYear5, setDcfYear5] = React.useState(430_000)
  const [terminalGrowth, setTerminalGrowth] = React.useState(3)
  const [discountRate, setDiscountRate]     = React.useState(18)
  const [riskFreeRate, setRiskFreeRate]     = React.useState(4.5)
  const [equityRiskPremium, setEquityRiskPremium] = React.useState(6.5)
  const [sizePremium, setSizePremium]       = React.useState(4.0)
  const [specificRisk, setSpecificRisk]     = React.useState(3.0)
  const [dcfWeight, setDcfWeight]           = React.useState(40)

  // ── Reconciliation ────────────────────────────────────────────────────────
  const [reconciliationNote, setReconciliationNote] = React.useState('')

  // ── Load saved model ──────────────────────────────────────────────────────
  React.useEffect(() => {
    async function load() {
      const data = await getCaseDetails(id)
      setCaseData(data)
      const last = data?.valuationModels?.[0]
      if (last) {
        if (last.ebitda)           setEbitda(last.ebitda)
        if (last.multiplier)       setMultiplier(last.multiplier)
        if (last.dcfYear1)         setDcfYear1(last.dcfYear1)
        if (last.dcfYear2)         setDcfYear2(last.dcfYear2)
        if (last.dcfYear3)         setDcfYear3(last.dcfYear3)
        if (last.dcfYear4)         setDcfYear4(last.dcfYear4)
        if (last.dcfYear5)         setDcfYear5(last.dcfYear5)
        if (last.terminalGrowth != null) setTerminalGrowth(last.terminalGrowth)
        if (last.discountRate != null)   setDiscountRate(last.discountRate)
        if (last.riskFreeRate != null)   setRiskFreeRate(last.riskFreeRate)
        if (last.equityRiskPremium != null) setEquityRiskPremium(last.equityRiskPremium)
        if (last.sizePremium != null)    setSizePremium(last.sizePremium)
        if (last.specificRisk != null)   setSpecificRisk(last.specificRisk)
        if (last.reconciliationNote)     setReconciliationNote(last.reconciliationNote)
      }
    }
    load()
  }, [id])

  // ── Calculations ──────────────────────────────────────────────────────────
  const wacc = riskFreeRate + equityRiskPremium + sizePremium + specificRisk

  const gpcmWeightedMultiple = gpcmRows.reduce((sum, r) => sum + r.ebitdaMultiple * (r.weight / 100), 0)
  const gpcmIndicated = ebitda * gpcmWeightedMultiple

  const dcfCashflows = [dcfYear1, dcfYear2, dcfYear3, dcfYear4, dcfYear5]
  const pvCashflows  = dcfCashflows.map((cf, i) => pv(cf, discountRate, i + 1))
  const pvSum        = pvCashflows.reduce((s, v) => s + v, 0)
  const terminalValue = dcfCashflows[4] * (1 + terminalGrowth / 100) / ((discountRate - terminalGrowth) / 100)
  const pvTerminal   = pv(terminalValue, discountRate, 5)
  const dcfIndicated = pvSum + pvTerminal

  const totalWeight = gpcmWeight + dcfWeight
  const concludedValue = totalWeight > 0
    ? (gpcmIndicated * (gpcmWeight / totalWeight)) + (dcfIndicated * (dcfWeight / totalWeight))
    : gpcmIndicated

  // ── GPCM row helpers ──────────────────────────────────────────────────────
  function updateGpcmRow(idx: number, field: keyof GpcmRow, value: string | number) {
    setGpcmRows(rows => rows.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }
  function addGpcmRow() {
    setGpcmRows(rows => [...rows, { company: '', ebitdaMultiple: 6.0, revenueMultiple: 1.0, weight: 0 }])
  }
  function removeGpcmRow(idx: number) {
    setGpcmRows(rows => rows.filter((_, i) => i !== idx))
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    setIsSaving(true)
    try {
      await saveValuation(id, {
        valuationType: 'HYBRID',
        label: 'Market + DCF Reconciliation',
        ebitda, multiplier: gpcmWeightedMultiple,
        indicatedValue: concludedValue,
        weight: gpcmWeight,
        dcfYear1, dcfYear2, dcfYear3, dcfYear4, dcfYear5,
        terminalGrowth, discountRate,
        riskFreeRate, equityRiskPremium, sizePremium, specificRisk,
        reconciliationNote,
      })
      toast({ title: 'Valuation saved', description: `Concluded: ${fmtM(concludedValue)}` })
    } catch (e: any) {
      toast({ title: e.message ?? 'Could not save', variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }

  const numInput = (label: string, value: number, onChange: (v: number) => void, prefix = '$', step = 1000) => (
    <div className="space-y-1.5">
      <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{prefix}</span>
        <Input
          type="number" value={value} step={step}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className={cn('h-10 font-mono text-sm', prefix ? 'pl-7' : '')}
        />
      </div>
    </div>
  )

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-white shadow-sm">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <Link href={`/projects/${id}`} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </Link>
            <div className="h-5 w-px bg-border/60" />
            <div>
              <h1 className="text-base font-black text-primary tracking-tight leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>Valuation Engine</h1>
              {caseData && <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{caseData.client}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSave} disabled={isSaving} className="font-bold uppercase text-xs h-10">
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Model
            </Button>
            <Button className="bg-primary font-bold uppercase text-xs h-10 shadow-lg">
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </header>

        {/* Concluded Value Banner */}
        <div className="bg-primary text-white px-8 py-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-60">Concluded Equity Value</p>
            <p className="text-4xl font-black font-headline tracking-tighter">{fmtM(concludedValue)}</p>
          </div>
          <div className="flex gap-8 text-sm">
            <div className="text-center">
              <p className="text-[10px] uppercase opacity-60 font-bold tracking-widest">Market Approach</p>
              <p className="text-xl font-bold">{fmtM(gpcmIndicated)}</p>
              <p className="text-[10px] opacity-50">{gpcmWeight}% weight</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase opacity-60 font-bold tracking-widest">Income Approach (DCF)</p>
              <p className="text-xl font-bold">{fmtM(dcfIndicated)}</p>
              <p className="text-[10px] opacity-50">{dcfWeight}% weight</p>
            </div>
          </div>
        </div>

        <main className="flex-1 p-8 max-w-7xl mx-auto w-full space-y-6 bg-background/30">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-white border h-11 shadow-sm rounded-xl">
              <TabsTrigger value="gpcm" className="data-[state=active]:bg-primary data-[state=active]:text-white px-6 font-bold text-xs uppercase tracking-widest">
                <BarChart2 className="mr-2 h-4 w-4" />
                Market Approach (GPCM)
              </TabsTrigger>
              <TabsTrigger value="dcf" className="data-[state=active]:bg-primary data-[state=active]:text-white px-6 font-bold text-xs uppercase tracking-widest">
                <TrendingUp className="mr-2 h-4 w-4" />
                Income Approach (DCF)
              </TabsTrigger>
              <TabsTrigger value="reconciliation" className="data-[state=active]:bg-primary data-[state=active]:text-white px-6 font-bold text-xs uppercase tracking-widest">
                <Scale className="mr-2 h-4 w-4" />
                Reconciliation
              </TabsTrigger>
            </TabsList>

            {/* ─── GPCM TAB ─────────────────────────────────────────────────── */}
            <TabsContent value="gpcm">
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7 space-y-6">
                  <Card className="border-none shadow-sm bg-white">
                    <CardHeader className="border-b py-4">
                      <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                        <Calculator className="h-4 w-4 text-primary" />
                        Subject Company Inputs
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                      {numInput('Normalized EBITDA (LTM)', ebitda, setEbitda, '$', 10000)}
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Applied EBITDA Multiple</Label>
                          <span className="text-xl font-black text-primary">{gpcmWeightedMultiple.toFixed(2)}x</span>
                        </div>
                        <Slider value={[multiplier]} min={1} max={20} step={0.1} onValueChange={v => setMultiplier(v[0])} />
                        <p className="text-[10px] text-muted-foreground">Weighted average from guideline companies: {gpcmWeightedMultiple.toFixed(2)}x</p>
                      </div>
                      <div className="rounded-lg bg-primary/5 border border-primary/10 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Indicated Value (Market)</p>
                        <p className="text-3xl font-black text-primary">{fmtM(gpcmIndicated)}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-none shadow-sm bg-white">
                    <CardHeader className="border-b py-4 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm font-bold uppercase tracking-widest">Guideline Public Companies</CardTitle>
                      <Button size="sm" variant="outline" onClick={addGpcmRow} className="text-[10px] font-bold h-8">
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add Company
                      </Button>
                    </CardHeader>
                    <CardContent className="p-0 overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-muted/30">
                          <TableRow>
                            <TableHead className="text-[10px] font-bold uppercase tracking-widest">Company</TableHead>
                            <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest">EV/EBITDA</TableHead>
                            <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest">EV/Revenue</TableHead>
                            <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest">Weight %</TableHead>
                            <TableHead className="w-10" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {gpcmRows.map((row, i) => (
                            <TableRow key={i}>
                              <TableCell>
                                <Input value={row.company} onChange={e => updateGpcmRow(i, 'company', e.target.value)} className="h-8 text-xs border-none bg-transparent p-0 focus:bg-white focus:border focus:px-2" />
                              </TableCell>
                              <TableCell className="text-right">
                                <Input type="number" value={row.ebitdaMultiple} step={0.1} onChange={e => updateGpcmRow(i, 'ebitdaMultiple', parseFloat(e.target.value) || 0)} className="h-8 text-xs text-right w-20 ml-auto font-mono" />
                              </TableCell>
                              <TableCell className="text-right">
                                <Input type="number" value={row.revenueMultiple} step={0.1} onChange={e => updateGpcmRow(i, 'revenueMultiple', parseFloat(e.target.value) || 0)} className="h-8 text-xs text-right w-20 ml-auto font-mono" />
                              </TableCell>
                              <TableCell className="text-right">
                                <Input type="number" value={row.weight} step={1} onChange={e => updateGpcmRow(i, 'weight', parseFloat(e.target.value) || 0)} className="h-8 text-xs text-right w-16 ml-auto font-mono" />
                              </TableCell>
                              <TableCell>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeGpcmRow(i)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="border-t-2 bg-muted/20 font-semibold">
                            <TableCell className="text-xs font-bold">Weighted Average</TableCell>
                            <TableCell className="text-right font-mono text-sm font-bold text-primary">{gpcmWeightedMultiple.toFixed(2)}x</TableCell>
                            <TableCell />
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">{gpcmRows.reduce((s, r) => s + r.weight, 0)}%</TableCell>
                            <TableCell />
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>

                <div className="lg:col-span-5 space-y-6">
                  <Card className="bg-primary text-white border-none shadow-xl overflow-hidden">
                    <CardContent className="p-8 text-center space-y-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-60">Market Approach Indicated Value</p>
                      <p className="text-5xl font-black font-headline">{fmtM(gpcmIndicated)}</p>
                      <Separator className="opacity-20" />
                      <div className="grid grid-cols-2 gap-4 text-left">
                        <div>
                          <p className="text-[10px] opacity-60 uppercase font-bold">EBITDA</p>
                          <p className="text-lg font-bold">{fmtK(ebitda)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] opacity-60 uppercase font-bold">Multiple</p>
                          <p className="text-lg font-bold">{gpcmWeightedMultiple.toFixed(2)}x</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-none shadow-sm bg-white">
                    <CardHeader className="border-b py-3">
                      <CardTitle className="text-xs font-bold uppercase tracking-widest">Approach Weight in Reconciliation</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                      <div className="flex justify-between">
                        <Label className="text-sm font-medium">Market Weight</Label>
                        <span className="font-bold text-primary">{gpcmWeight}%</span>
                      </div>
                      <Slider value={[gpcmWeight]} min={0} max={100} step={5} onValueChange={v => { setGpcmWeight(v[0]); setDcfWeight(100 - v[0]) }} />
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* ─── DCF TAB ───────────────────────────────────────────────────── */}
            <TabsContent value="dcf">
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7 space-y-6">
                  <Card className="border-none shadow-sm bg-white">
                    <CardHeader className="border-b py-4">
                      <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-primary" />
                        Projected Free Cash Flows
                      </CardTitle>
                      <CardDescription>Enter projected FCFF for each of the 5 discrete years</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 grid grid-cols-2 md:grid-cols-3 gap-4">
                      {numInput('Year 1', dcfYear1, setDcfYear1)}
                      {numInput('Year 2', dcfYear2, setDcfYear2)}
                      {numInput('Year 3', dcfYear3, setDcfYear3)}
                      {numInput('Year 4', dcfYear4, setDcfYear4)}
                      {numInput('Year 5', dcfYear5, setDcfYear5)}
                    </CardContent>
                  </Card>

                  <Card className="border-none shadow-sm bg-white">
                    <CardHeader className="border-b py-4">
                      <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                        <Percent className="h-4 w-4 text-primary" />
                        Build-Up Discount Rate (WACC)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        {numInput('Risk-Free Rate (%)', riskFreeRate, setRiskFreeRate, '', 0.1)}
                        {numInput('Equity Risk Premium (%)', equityRiskPremium, setEquityRiskPremium, '', 0.1)}
                        {numInput('Size Premium (%)', sizePremium, setSizePremium, '', 0.1)}
                        {numInput('Specific Risk (%)', specificRisk, setSpecificRisk, '', 0.1)}
                      </div>
                      <div className="rounded-lg bg-accent/10 border border-accent/20 p-4 flex justify-between items-center">
                        <p className="text-sm font-bold text-accent">Total Discount Rate (WACC)</p>
                        <p className="text-2xl font-black text-accent">{wacc.toFixed(2)}%</p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Terminal Growth Rate</Label>
                          <span className="font-bold text-primary">{terminalGrowth}%</span>
                        </div>
                        <Slider value={[terminalGrowth]} min={0} max={8} step={0.5} onValueChange={v => setTerminalGrowth(v[0])} />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="lg:col-span-5 space-y-6">
                  <Card className="bg-primary text-white border-none shadow-xl">
                    <CardContent className="p-8 space-y-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-60">DCF Indicated Value</p>
                      <p className="text-5xl font-black font-headline">{fmtM(dcfIndicated)}</p>
                      <Separator className="opacity-20" />
                      <Table>
                        <TableHeader>
                          <TableRow className="border-white/20">
                            <TableHead className="text-white/60 text-[10px] font-bold uppercase">Year</TableHead>
                            <TableHead className="text-white/60 text-right text-[10px] font-bold uppercase">FCF</TableHead>
                            <TableHead className="text-white/60 text-right text-[10px] font-bold uppercase">PV</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dcfCashflows.map((cf, i) => (
                            <TableRow key={i} className="border-white/10">
                              <TableCell className="text-white/80 text-sm">{i + 1}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-white/80">{fmtK(cf)}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-white">{fmtK(pvCashflows[i])}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="border-white/20">
                            <TableCell className="text-white/80 text-sm">Terminal</TableCell>
                            <TableCell className="text-right font-mono text-sm text-white/80">{fmtK(terminalValue)}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-white">{fmtK(pvTerminal)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  <Card className="border-none shadow-sm bg-white">
                    <CardHeader className="border-b py-3">
                      <CardTitle className="text-xs font-bold uppercase tracking-widest">Approach Weight in Reconciliation</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                      <div className="flex justify-between">
                        <Label className="text-sm font-medium">DCF Weight</Label>
                        <span className="font-bold text-primary">{dcfWeight}%</span>
                      </div>
                      <Slider value={[dcfWeight]} min={0} max={100} step={5} onValueChange={v => { setDcfWeight(v[0]); setGpcmWeight(100 - v[0]) }} />
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* ─── RECONCILIATION TAB ───────────────────────────────────────── */}
            <TabsContent value="reconciliation">
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-8 space-y-6">
                  <Card className="border-none shadow-sm bg-white overflow-hidden">
                    <CardHeader className="border-b py-4 bg-muted/10">
                      <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                        <Scale className="h-4 w-4 text-primary" />
                        Value Reconciliation Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-muted/20">
                          <TableRow>
                            <TableHead className="text-[10px] font-bold uppercase tracking-widest">Approach</TableHead>
                            <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest">Indicated Value</TableHead>
                            <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest">Weight</TableHead>
                            <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest">Weighted Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow>
                            <TableCell className="font-medium">Market Approach (GPCM / EBITDA Multiple)</TableCell>
                            <TableCell className="text-right font-mono font-semibold">{fmtM(gpcmIndicated)}</TableCell>
                            <TableCell className="text-right font-mono">{gpcmWeight}%</TableCell>
                            <TableCell className="text-right font-mono">{fmtM(gpcmIndicated * gpcmWeight / 100)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Income Approach (DCF)</TableCell>
                            <TableCell className="text-right font-mono font-semibold">{fmtM(dcfIndicated)}</TableCell>
                            <TableCell className="text-right font-mono">{dcfWeight}%</TableCell>
                            <TableCell className="text-right font-mono">{fmtM(dcfIndicated * dcfWeight / 100)}</TableCell>
                          </TableRow>
                          <TableRow className="border-t-2 bg-primary/5 font-bold">
                            <TableCell className="font-black text-primary text-base">Concluded Value</TableCell>
                            <TableCell />
                            <TableCell className="text-right font-mono">{gpcmWeight + dcfWeight}%</TableCell>
                            <TableCell className="text-right font-mono text-primary text-lg font-black">{fmtM(concludedValue)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  <Card className="border-none shadow-sm bg-white">
                    <CardHeader className="border-b py-4">
                      <CardTitle className="text-sm font-bold uppercase tracking-widest">Reconciliation Narrative</CardTitle>
                      <CardDescription className="text-xs">Describe the rationale for weighting assignments. This text appears in the final report.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4">
                      <textarea
                        className="w-full min-h-[160px] text-sm leading-relaxed text-slate-700 border rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="The Appraiser assigned primary weight to the Market Approach given the availability of comparable transaction data..."
                        value={reconciliationNote}
                        onChange={e => setReconciliationNote(e.target.value)}
                      />
                    </CardContent>
                  </Card>
                </div>

                <div className="lg:col-span-4 space-y-6">
                  <Card className="bg-primary text-white border-none shadow-2xl overflow-hidden">
                    <CardContent className="p-8 text-center space-y-6">
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-60">Concluded Equity Value</p>
                      <p className="text-6xl font-black font-headline">{fmtM(concludedValue)}</p>
                      <div className="space-y-3 text-left">
                        <div className="flex justify-between text-sm">
                          <span className="opacity-70">Market ({gpcmWeight}%)</span>
                          <span className="font-bold">{fmtM(gpcmIndicated * gpcmWeight / 100)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="opacity-70">DCF ({dcfWeight}%)</span>
                          <span className="font-bold">{fmtM(dcfIndicated * dcfWeight / 100)}</span>
                        </div>
                        <Separator className="opacity-20" />
                        <div className="flex justify-between text-sm font-black">
                          <span>Concluded</span>
                          <span>{fmtM(concludedValue)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Button onClick={handleSave} disabled={isSaving} className="w-full bg-accent hover:bg-accent/90 font-bold uppercase text-xs h-12 shadow-lg text-white">
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Reconciled Model
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
