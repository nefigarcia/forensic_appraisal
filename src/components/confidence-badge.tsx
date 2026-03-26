'use client'

import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Lock, Bot } from 'lucide-react'

interface ConfidenceBadgeProps {
  confidence?: number | null
  reviewStatus?: string | null
  isLocked?: boolean
  sourceRef?: string | null
  className?: string
}

export function ConfidenceBadge({ confidence, reviewStatus, isLocked, sourceRef, className }: ConfidenceBadgeProps) {
  const pct = confidence != null ? Math.round(confidence * 100) : null

  const statusColor: Record<string, string> = {
    ACCEPTED:   'bg-emerald-100 text-emerald-800 border-emerald-200',
    OVERRIDDEN: 'bg-amber-100  text-amber-800  border-amber-200',
    REJECTED:   'bg-red-100    text-red-800    border-red-200',
    PENDING:    pct == null
      ? 'bg-slate-100 text-slate-600 border-slate-200'
      : pct >= 90
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : pct >= 70
          ? 'bg-amber-50   text-amber-700   border-amber-200'
          : 'bg-red-50     text-red-700     border-red-200',
  }

  const statusLabel: Record<string, string> = {
    ACCEPTED:   'Accepted',
    OVERRIDDEN: 'Overridden',
    REJECTED:   'Rejected',
    PENDING:    pct != null ? `${pct}%` : 'AI',
  }

  const key = reviewStatus ?? 'PENDING'
  const label = statusLabel[key] ?? key

  const tooltipText = [
    reviewStatus && reviewStatus !== 'PENDING' ? `Status: ${reviewStatus}` : null,
    pct != null ? `AI confidence: ${pct}%` : null,
    sourceRef ? `Source: ${sourceRef}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none select-none',
              statusColor[key] ?? 'bg-slate-100 text-slate-600 border-slate-200',
              className,
            )}
          >
            {isLocked ? <Lock className="h-2.5 w-2.5" /> : <Bot className="h-2.5 w-2.5" />}
            {label}
          </span>
        </TooltipTrigger>
        {tooltipText && (
          <TooltipContent side="top" className="text-xs max-w-[260px]">
            {tooltipText}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  )
}
