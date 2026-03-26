'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { createCheckoutSession } from '@/app/actions/billing-actions'
import { toast } from '@/hooks/use-toast'
import type { PlanId } from '@/lib/plans'

export function CheckoutButton({ planId, label }: { planId: PlanId; label: string }) {
  const [loading, setLoading] = React.useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      await createCheckoutSession(planId)
    } catch (e: any) {
      // redirect throws — only show toast for real errors
      if (!e?.message?.includes('NEXT_REDIRECT')) {
        toast({ title: e.message ?? 'Could not start checkout', variant: 'destructive' })
        setLoading(false)
      }
    }
  }

  return (
    <Button
      onClick={handleClick}
      disabled={loading}
      className="w-full bg-primary text-white text-[11px] font-bold h-9"
    >
      {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
      {label}
    </Button>
  )
}
