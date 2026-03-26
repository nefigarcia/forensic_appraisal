'use client'

import { login } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ShieldCheck, ArrowRight, Lock, FileSearch, BarChart3 } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

const features = [
  { icon: FileSearch, text: "AI-powered document extraction" },
  { icon: BarChart3, text: "Multi-method valuation engine" },
  { icon: Lock, text: "SOC 2 compliant audit trail" },
]

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await login(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left brand panel ── */}
      <div
        className="hidden lg:flex lg:w-[42%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #0B2046 0%, #070f24 100%)' }}
      >
        {/* grid pattern */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(240,168,14,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(240,168,14,0.045) 1px, transparent 1px)',
            backgroundSize: '52px 52px',
            maskImage: 'radial-gradient(ellipse 90% 90% at 50% 50%, black 30%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 90% 90% at 50% 50%, black 30%, transparent 100%)',
          }}
        />

        {/* top logo */}
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-[#F0A80E]" />
          </div>
          <div>
            <p className="font-bold text-white text-sm tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
              ValuVault <em style={{ color: '#F0A80E', fontStyle: 'italic' }}>AI</em>
            </p>
            <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold">Forensic Engine</p>
          </div>
        </div>

        {/* center copy */}
        <div className="relative space-y-8">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#F0A80E] mb-4">
              Forensic Business Valuation
            </p>
            <h2
              className="text-4xl font-black leading-tight text-white"
              style={{ fontFamily: "'Playfair Display', serif", letterSpacing: '-0.02em' }}
            >
              Precision analysis,
              <br />
              <span style={{ color: '#F0A80E' }}>court-ready</span> reports.
            </h2>
          </div>
          <div className="space-y-4">
            {features.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-white/8 border border-white/10 flex items-center justify-center shrink-0">
                  <Icon className="h-3.5 w-3.5 text-[#F0A80E]" />
                </div>
                <span className="text-sm text-white/60 font-medium">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* bottom trust */}
        <p className="relative text-[10px] text-white/25 uppercase tracking-[0.18em] font-bold">
          Trusted by forensic CPAs &amp; litigation analysts
        </p>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex items-center justify-center p-8 bg-[#F7F6F3]">
        <div className="w-full max-w-[400px] space-y-8">

          {/* mobile logo */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-primary text-base" style={{ fontFamily: "'Playfair Display', serif" }}>
              ValuVault AI
            </span>
          </div>

          <div>
            <h1 className="text-2xl font-black text-foreground tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
              Welcome back
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Sign in to your forensic workbench</p>
          </div>

          <form action={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-xs font-semibold text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Work Email</Label>
              <Input
                id="email" name="email" type="email"
                placeholder="sarah@firm.com"
                required
                className="h-11 bg-white border-border/60 shadow-sm focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Password</Label>
              </div>
              <Input
                id="password" name="password" type="password"
                required
                className="h-11 bg-white border-border/60 shadow-sm focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-primary hover:bg-primary/90 font-bold uppercase text-[11px] tracking-widest flex items-center justify-center gap-2 shadow-md"
            >
              {loading ? (
                <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              ) : (
                <>Sign In to Workbench <ArrowRight className="h-4 w-4" /></>
              )}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-primary font-bold hover:underline">
              Register your firm
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
