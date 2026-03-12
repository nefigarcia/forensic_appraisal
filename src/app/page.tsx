
import { Button } from "@/components/ui/button"
import { CheckCircle2, ShieldCheck, Zap, BarChart3, Search, FileText, ArrowRight, Globe } from "lucide-react"
import Link from "next/link"
import Image from "next/image"

export default function LandingPage() {
  const pricingTiers = [
    {
      name: "Solo Appraiser",
      price: "$199",
      description: "Perfect for independent forensic accountants.",
      features: [
        "Up to 5 active cases",
        "AI Document Extraction",
        "Standard Valuation Models",
        "Email Support",
      ],
      buttonText: "Start Free Trial",
      accent: false,
    },
    {
      name: "Valuation Firm",
      price: "$599",
      description: "Full suite for growing appraisal teams.",
      features: [
        "Unlimited active cases",
        "Advanced Forensic Ledger",
        "Multi-tenant Team Access",
        "Custom Report Branding",
        "Priority Support",
      ],
      buttonText: "Get Started",
      accent: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      description: "Industrial strength for large-scale audit firms.",
      features: [
        "White-label Reporting",
        "API Data Access",
        "Dedicated Account Manager",
        "SSO & Custom Security",
        "On-premise deployment options",
      ],
      buttonText: "Contact Sales",
      accent: false,
    },
  ]

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Header */}
      <header className="flex h-20 items-center justify-between px-6 lg:px-12 border-b sticky top-0 bg-white/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-2">
          <div className="bg-primary p-1.5 rounded-lg">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-bold font-headline tracking-tighter text-primary">ValuVault AI</span>
        </div>
        <nav className="hidden md:flex items-center gap-8 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          <a href="#features" className="hover:text-primary transition-colors">Features</a>
          <a href="#pricing" className="hover:text-primary transition-colors">Pricing</a>
          <a href="#docs" className="hover:text-primary transition-colors">Docs</a>
        </nav>
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" className="font-bold uppercase text-xs tracking-widest">Sign In</Button>
          </Link>
          <Link href="/dashboard">
            <Button className="bg-primary font-bold uppercase text-xs tracking-widest shadow-lg px-6">Book Demo</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-24 px-6 lg:px-12 max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold uppercase tracking-widest mb-8">
            <Zap className="h-3.5 w-3.5 fill-accent" />
            The Future of Forensic Appraisal
          </div>
          <h1 className="text-5xl lg:text-7xl font-extrabold font-headline tracking-tighter text-primary leading-[1.1] mb-8">
            Professional AI Engine for <br />
            <span className="text-accent italic">Forensic Accountants</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto font-medium mb-12">
            Automate document extraction, generate audit-ready ledgers, and access real-time market multiples in one secure, enterprise-grade vault.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/dashboard">
              <Button className="h-16 px-10 text-lg font-bold uppercase tracking-widest bg-primary hover:bg-primary/90 shadow-2xl">
                Launch Workbench
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Button variant="outline" className="h-16 px-10 text-lg font-bold uppercase tracking-widest border-2">
              Watch Preview
            </Button>
          </div>
          <div className="mt-20 relative rounded-3xl overflow-hidden border-8 border-muted shadow-2xl">
             <Image 
              src="https://picsum.photos/seed/valuvault-hero/1200/600" 
              alt="Forensic Dashboard" 
              width={1200} 
              height={600}
              className="w-full object-cover"
              data-ai-hint="dashboard professional"
            />
          </div>
        </section>

        {/* Features Grid */}
        <section id="features" className="py-24 bg-muted/30 px-6 lg:px-12">
          <div className="max-w-7xl mx-auto text-center mb-16">
            <h2 className="text-3xl font-bold font-headline text-primary uppercase tracking-widest mb-4">Core Modules</h2>
            <p className="text-muted-foreground font-medium">Built for the high-stakes requirements of court-ready valuations.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
            {[
              { icon: FileText, title: "AI Extraction", desc: "Instantly convert PDFs, tax returns, and messy Excels into structured forensic data." },
              { icon: BarChart3, title: "Forensic Ledger", desc: "Automated YOY financial comparisons with real-time anomaly detection and variance tracking." },
              { icon: Globe, title: "Industry Benchmarking", desc: "AI-suggested NAICS/SIC codes integrated with BVR, DealStats, and IbisWorld subscriptions." },
              { icon: Search, title: "Discovery Intelligence", desc: "Natural language search across all matter binders to find patterns, distributions, or fraud markers." },
              { icon: ShieldCheck, title: "Chain of Custody", desc: "Matter-level encryption with full audit logging for document ingestion and AI processing." },
              { icon: Zap, title: "Valuation Modeler", desc: "Built-in EBITDA Multipliers, DCF, and Asset Approach calculators for rapid modeling." },
            ].map((f, i) => (
              <div key={i} className="p-10 rounded-3xl bg-white border border-border/50 shadow-sm hover:shadow-xl transition-all group">
                <div className="bg-primary/5 p-4 rounded-2xl w-fit mb-6 group-hover:bg-primary transition-colors">
                  <f.icon className="h-6 w-6 text-primary group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-xl font-bold text-primary mb-3">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed font-medium">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-32 px-6 lg:px-12 max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-4xl font-bold font-headline text-primary tracking-tight mb-4 text-center">Transparent Value</h2>
            <p className="text-muted-foreground font-medium">Choose the engagement level that matches your practice.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {pricingTiers.map((tier) => (
              <div key={tier.name} className={`relative p-10 rounded-3xl border transition-all ${
                tier.accent ? 'bg-primary text-white border-primary shadow-2xl scale-105 z-10' : 'bg-white border-border shadow-sm hover:border-primary/30'
              }`}>
                {tier.accent && (
                  <div className="absolute top-0 right-0 m-6 bg-accent text-white text-[10px] font-black uppercase px-4 py-1 rounded-full shadow-lg">
                    Most Popular
                  </div>
                )}
                <h3 className="text-xl font-bold uppercase tracking-widest mb-2">{tier.name}</h3>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-5xl font-black">{tier.price}</span>
                  {tier.price !== 'Custom' && <span className="text-sm font-bold opacity-70 uppercase tracking-widest">/mo</span>}
                </div>
                <p className={`text-sm mb-8 font-medium ${tier.accent ? 'text-white/70' : 'text-muted-foreground'}`}>
                  {tier.description}
                </p>
                <div className="space-y-4 mb-10">
                  {tier.features.map((f) => (
                    <div key={f} className="flex items-center gap-3">
                      <CheckCircle2 className={`h-5 w-5 ${tier.accent ? 'text-accent' : 'text-primary'}`} />
                      <span className="text-sm font-bold tracking-tight">{f}</span>
                    </div>
                  ))}
                </div>
                <Link href="/dashboard" className="block">
                  <Button className={`w-full h-14 font-black uppercase tracking-widest text-xs rounded-xl ${
                    tier.accent ? 'bg-accent hover:bg-accent/90 text-white shadow-xl' : 'bg-primary text-white shadow-md'
                  }`}>
                    {tier.buttonText}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-primary py-20 px-6 lg:px-12 text-white border-t border-white/10">
        <div className="max-w-7xl mx-auto grid md:grid-cols-4 gap-12">
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-accent" />
              <span className="text-xl font-bold uppercase tracking-tighter">ValuVault AI</span>
            </div>
            <p className="text-sm text-white/50 leading-relaxed font-medium">
              Enterprise security and AI precision for the most demanding valuation professional. 
              Protected by matter-level encryption.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-black uppercase tracking-widest mb-6 opacity-40">Software</h4>
            <ul className="space-y-4 text-sm font-bold">
              <li><Link href="/dashboard" className="hover:text-accent transition-colors">Forensic Workbench</Link></li>
              <li><Link href="/dashboard" className="hover:text-accent transition-colors">Valuation Engine</Link></li>
              <li><Link href="/dashboard" className="hover:text-accent transition-colors">Case Discovery</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-black uppercase tracking-widest mb-6 opacity-40">Resources</h4>
            <ul className="space-y-4 text-sm font-bold">
              <li><a href="#" className="hover:text-accent transition-colors">API Docs</a></li>
              <li><a href="#" className="hover:text-accent transition-colors">Industry Reports</a></li>
              <li><a href="#" className="hover:text-accent transition-colors">Knowledge Base</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-black uppercase tracking-widest mb-6 opacity-40">Contact</h4>
            <ul className="space-y-4 text-sm font-bold">
              <li>support@valuvault.ai</li>
              <li>1-800-VALU-AI</li>
              <li>New York, NY</li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-20 pt-10 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-6 text-[10px] font-black uppercase tracking-[0.2em] opacity-40">
          <span>© 2024 ValuVault Technologies Inc.</span>
          <div className="flex gap-8">
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
            <a href="#">Security Protocol</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
