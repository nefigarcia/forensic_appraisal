'use client'

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { History, Download, Archive, Loader2, ShieldAlert, ShieldCheck, Clock } from 'lucide-react'
import { getDocumentVersions, getVersionDownloadUrl, archiveDocumentVersion } from '@/app/actions/document-versions'
import { useToast } from '@/hooks/use-toast'

interface VersionRow {
  id: string
  versionNumber: number
  sha256Hash: string
  sizeBytes: number
  mimeType: string
  originalName: string
  uploadedBy: string
  uploadedAt: string | Date
  scanStatus: string
  isArchived: boolean
  archivedAt?: string | Date | null
  archiveReason?: string | null
}

export function DocumentVersionHistory({ documentId, documentName }: { documentId: string; documentName: string }) {
  const [open, setOpen] = React.useState(false)
  const [rows, setRows] = React.useState<VersionRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const { toast } = useToast()

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await getDocumentVersions(documentId)
      setRows(data as VersionRow[])
    } catch (e: any) {
      toast({ title: 'Could not load versions', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [documentId, toast])

  React.useEffect(() => {
    if (open) load()
  }, [open, load])

  async function download(v: VersionRow) {
    setBusyId(v.id)
    try {
      const { url } = await getVersionDownloadUrl(v.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e: any) {
      toast({ title: 'Download blocked', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  async function archive(v: VersionRow) {
    setBusyId(v.id)
    try {
      const reason = window.prompt('Reason for archiving this version?')
      if (reason == null) return
      await archiveDocumentVersion(v.id, reason)
      await load()
      toast({ title: `Version ${v.versionNumber} archived` })
    } catch (e: any) {
      toast({ title: 'Archive failed', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs uppercase tracking-widest font-bold">
          <History className="mr-2 h-3 w-3" /> History
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-headline">Version history · {documentName}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">No versions recorded yet.</div>
        ) : (
          <div className="divide-y max-h-[60vh] overflow-y-auto">
            {rows.map((v) => (
              <div key={v.id} className="py-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={v.isArchived ? 'outline' : 'default'} className="uppercase font-bold tracking-widest text-[9px]">
                      v{v.versionNumber}
                    </Badge>
                    {v.isArchived && <Badge variant="outline" className="uppercase font-bold tracking-widest text-[9px]">Archived</Badge>}
                    {v.scanStatus === 'CLEAN'    && <Badge className="uppercase font-bold tracking-widest text-[9px] bg-green-100 text-green-800 hover:bg-green-100"><ShieldCheck className="h-3 w-3 mr-1" />Clean</Badge>}
                    {v.scanStatus === 'PENDING'  && <Badge className="uppercase font-bold tracking-widest text-[9px] bg-yellow-100 text-yellow-800 hover:bg-yellow-100"><Clock className="h-3 w-3 mr-1" />Scanning</Badge>}
                    {v.scanStatus === 'INFECTED' && <Badge className="uppercase font-bold tracking-widest text-[9px] bg-red-100 text-red-800 hover:bg-red-100"><ShieldAlert className="h-3 w-3 mr-1" />Infected</Badge>}
                  </div>
                  <div className="text-sm font-mono truncate">{v.originalName}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5 break-all">
                    SHA-256 · {v.sha256Hash}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {new Date(v.uploadedAt).toLocaleString()} · {(v.sizeBytes / 1024).toFixed(1)} KB · {v.mimeType}
                  </div>
                  {v.isArchived && v.archiveReason && (
                    <div className="text-[11px] text-muted-foreground mt-1 italic">
                      Archived: {v.archiveReason}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => download(v)}
                    disabled={busyId === v.id || v.isArchived || v.scanStatus !== 'CLEAN'}
                    title={v.scanStatus !== 'CLEAN' ? `Blocked — scan status ${v.scanStatus}` : 'Download'}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  {!v.isArchived && (
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => archive(v)}
                      disabled={busyId === v.id}
                      title="Archive this version"
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
