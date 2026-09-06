'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Upload, Loader2 } from 'lucide-react'
import { uploadToRequestItem } from '@/app/actions/portal'

/**
 * Portal-side upload widget. Ships the file directly to
 * `uploadToRequestItem` — the server action re-verifies the raw token
 * on every call. There is no client-side "am I authorized?" state; the
 * token in the URL is the entire capability.
 */
export function PortalUploader({ rawToken, requestItemId }: { rawToken: string; requestItemId: string }) {
  const [busy, setBusy]     = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setMessage(null)
    try {
      await uploadToRequestItem({ rawToken, requestItemId, file })
      setMessage('Uploaded successfully')
      if (inputRef.current) inputRef.current.value = ''
      // Reload page-level RSC so the item's document list refreshes.
      // Falls back to full reload if `router` isn't available.
      window.location.reload()
    } catch (err: any) {
      setMessage(err?.message ?? 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input ref={inputRef} type="file" onChange={onChange} disabled={busy} className="max-w-md" />
      {busy && <Loader2 className="animate-spin h-4 w-4 text-muted-foreground" />}
      {!busy && <Upload className="h-4 w-4 text-muted-foreground" />}
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  )
}
