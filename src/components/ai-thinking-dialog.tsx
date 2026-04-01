'use client'

import * as React from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Sparkles } from 'lucide-react'

interface AIThinkingDialogProps {
  open: boolean
  title: string
  messages: string[]
}

export function AIThinkingDialog({ open, title, messages }: AIThinkingDialogProps) {
  const [msgIndex, setMsgIndex] = React.useState(0)
  const [fade, setFade] = React.useState(true)

  React.useEffect(() => {
    if (!open) {
      setMsgIndex(0)
      setFade(true)
      return
    }
    const interval = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setMsgIndex(i => (i + 1) % messages.length)
        setFade(true)
      }, 350)
    }, 2800)
    return () => clearInterval(interval)
  }, [open, messages.length])

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-sm text-center border-none shadow-2xl bg-white [&>button]:hidden"
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <div className="flex flex-col items-center gap-6 py-6 px-2">

          {/* Animated icon */}
          <div className="relative flex items-center justify-center">
            <div className="absolute h-20 w-20 rounded-full bg-primary/10 animate-ping" style={{ animationDuration: '1.8s' }} />
            <div className="absolute h-14 w-14 rounded-full bg-primary/15 animate-ping" style={{ animationDuration: '1.4s', animationDelay: '0.3s' }} />
            <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg">
              <Sparkles className="h-6 w-6 text-white fill-white" />
            </div>
          </div>

          {/* Title */}
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">AI Engine</p>
            <h2 className="text-lg font-black text-primary tracking-tight">{title}</h2>
          </div>

          {/* Cycling message */}
          <div className="h-8 flex items-center justify-center">
            <p
              className="text-sm font-medium text-slate-600 transition-opacity duration-350"
              style={{ opacity: fade ? 1 : 0 }}
            >
              {messages[msgIndex]}
            </p>
          </div>

          {/* Animated progress bar */}
          <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full animate-[shimmer_2s_ease-in-out_infinite]"
              style={{
                backgroundImage: 'linear-gradient(90deg, transparent 0%, hsl(var(--primary)) 50%, transparent 100%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 2s ease-in-out infinite',
              }}
            />
          </div>

          {/* Dots */}
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce"
                style={{ animationDelay: `${i * 0.2}s`, animationDuration: '1s' }}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────
// Per-operation message sets
// ─────────────────────────────────────────────────

export const AI_MESSAGES = {
  extraction: [
    'Parsing document structure...',
    'Locating financial statement tables...',
    'Reading line items and account names...',
    'Extracting numerical values...',
    'Resolving ambiguous figures...',
    'Cross-referencing multi-year data...',
    'Validating accounting entries...',
    'Persisting values to forensic ledger...',
  ],
  normalization: [
    'Reviewing extracted line items...',
    'Mapping to universal accounting categories...',
    'Grouping revenue streams...',
    'Identifying COGS components...',
    'Structuring operating expenses...',
    'Calculating trailing twelve months...',
    'Computing EBITDA by period...',
    'Finalizing normalization workpaper...',
  ],
  industry: [
    'Analyzing business description...',
    'Scanning NAICS classification codes...',
    'Identifying sector characteristics...',
    'Matching to comparable industries...',
    'Calibrating market risk profile...',
    'Benchmarking against peer companies...',
    'Finalizing industry classification...',
  ],
  anomalies: [
    'Loading financial time series...',
    "Running Benford's Law distribution test...",
    'Scanning for statistical outliers...',
    'Checking year-over-year variance ratios...',
    'Analyzing margin consistency...',
    'Flagging related-party patterns...',
    'Correlating duplicate entries...',
    'Generating anomaly report...',
  ],
  insights: [
    'Reviewing engagement context...',
    'Scanning for missing documentation...',
    'Analyzing data completeness...',
    'Identifying verification gaps...',
    'Generating strategic recommendations...',
    'Prioritizing action items...',
  ],
  report: [
    'Reviewing financial findings...',
    'Applying valuation standards...',
    'Structuring narrative language...',
    'Drafting professional commentary...',
    'Formatting for report delivery...',
  ],
  binder: [
    'Searching the evidence binder...',
    'Reading document context...',
    'Reasoning over extracted data...',
    'Formulating response...',
  ],
}
