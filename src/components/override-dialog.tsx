'use client'

import * as React from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'

interface OverrideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  lineItem: string
  currentValue: number
  aiValue?: number | null
  onConfirm: (newValue: number, reason: string) => Promise<void>
}

export function OverrideDialog({
  open, onOpenChange, lineItem, currentValue, aiValue, onConfirm,
}: OverrideDialogProps) {
  const [value, setValue] = React.useState(String(currentValue))
  const [reason, setReason] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setValue(String(currentValue))
      setReason('')
      setError(null)
    }
  }, [open, currentValue])

  async function handleSubmit() {
    const num = parseFloat(value.replace(/,/g, ''))
    if (isNaN(num)) { setError('Enter a valid number.'); return }
    if (!reason.trim()) { setError('Override reason is required.'); return }
    setError(null)
    setLoading(true)
    try {
      await onConfirm(num, reason.trim())
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message ?? 'Override failed.')
    } finally {
      setLoading(false)
    }
  }

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Override Value</DialogTitle>
          <DialogDescription>
            Manually override the AI-suggested value for <span className="font-semibold">{lineItem}</span>.
            This action is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {aiValue != null && (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              AI suggested: <span className="font-mono font-medium">${fmt(aiValue)}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ov-value">Corrected Value ($)</Label>
            <Input
              id="ov-value"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="0"
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ov-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="ov-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Source document shows $X on page 4; AI OCR error on handwritten figure."
              rows={3}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
