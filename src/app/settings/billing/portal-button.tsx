'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, ExternalLink } from 'lucide-react'
import { createPortalSession } from '@/app/actions/billing-actions'
import { toast } from '@/hooks/use-toast'

export function PortalButton() {
  const [loading, setLoading] = React.useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      await createPortalSession()
    } catch (e: any) {
      if (!e?.message?.includes('NEXT_REDIRECT')) {
        toast({ title: e.message ?? 'Could not open billing portal', variant: 'destructive' })
        setLoading(false)
      }
    }
  }

  return (
    <Button variant="outline" onClick={handleClick} disabled={loading} className="font-bold text-xs uppercase h-9">
      {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="mr-2 h-3.5 w-3.5" />}
      Manage Subscription
    </Button>
  )
}
