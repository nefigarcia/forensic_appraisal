'use client'

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileWarning, FileSearch, ExternalLink, Loader2, HelpCircle } from 'lucide-react'
import { getCitationsForFinancialValue, getCitationSourceUrl } from '@/app/actions/citations'
import { useToast } from '@/hooks/use-toast'

interface CitationRow {
  id:               string
  documentName:     string
  versionNumber:    number
  pageNumber:       number | null
  sourceLabel:      string | null
  tableName:        string | null
  rowLabel:         string | null
  columnLabel:      string | null
  boundingBox:      unknown | null
  rawText:          string | null
  extractor:        string | null
  extractorVersion: string | null
  confidence:       number | null
  isConfident:      boolean
  createdAt:        string | Date
}

/**
 * Small indicator that sits beside a FinancialValue. Three surface states:
 *
 *   1. Loading — grey spinner.
 *   2. No citations — a distinct "No source" badge (Rule 8). Analysts see
 *      at a glance which values lack traceable evidence.
 *   3. Cited — a link icon that opens a dialog listing every citation
 *      (an AI value can be extracted from multiple pages). Each citation
 *      shows page/table/row + raw text, plus a "View source" button that
 *      opens a signed URL with #page=N when the location is confident.
 *      Low-confidence citations are visually flagged so they are not
 *      mistaken for pinpoint evidence.
 */
export function CitationIndicator({ financialValueId }: { financialValueId: string }) {
  const [open, setOpen]           = React.useState(false)
  const [loading, setLoading]     = React.useState(false)
  const [rows, setRows]           = React.useState<CitationRow[] | null>(null)
  const [openingId, setOpeningId] = React.useState<string | null>(null)
  const { toast } = useToast()

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await getCitationsForFinancialValue(financialValueId)
      setRows(data as CitationRow[])
    } catch (e: any) {
      toast({ title: 'Could not load citations', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [financialValueId, toast])

  // Fetch once on first mount so the badge can render "cited / uncited"
  // without waiting for the user to open the dialog.
  React.useEffect(() => { load() }, [load])

  async function viewSource(row: CitationRow) {
    setOpeningId(row.id)
    try {
      const { url } = await getCitationSourceUrl(row.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e: any) {
      toast({ title: 'Source unavailable', description: e?.message ?? 'unknown', variant: 'destructive' })
    } finally {
      setOpeningId(null)
    }
  }

  // ── 1. Loading ──────────────────────────────────────────────────
  if (rows === null) {
    return <Loader2 className="animate-spin h-3.5 w-3.5 text-muted-foreground" />
  }

  // ── 2. No citations ────────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <Badge
        variant="outline"
        className="uppercase font-bold tracking-widest text-[9px] text-amber-800 border-amber-300 bg-amber-50"
        title="This value has no traceable source citation."
      >
        <FileWarning className="h-3 w-3 mr-1" /> No source
      </Badge>
    )
  }

  // Summary badge — the primary shown before opening.
  const anyConfident = rows.some(r => r.isConfident)
  const summary = anyConfident
    ? { text: `${rows.length} source${rows.length === 1 ? '' : 's'}`, cls: 'text-green-800 border-green-300 bg-green-50' }
    : { text: 'Unlocated',                                                cls: 'text-orange-800 border-orange-300 bg-orange-50' }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost" size="sm"
          className={`h-6 px-2 uppercase font-bold tracking-widest text-[9px] border ${summary.cls}`}
          title="Show source citations"
        >
          <FileSearch className="h-3 w-3 mr-1" /> {summary.text}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-headline">Evidence citations</DialogTitle>
        </DialogHeader>
        {loading && <div className="flex justify-center py-6"><Loader2 className="animate-spin h-5 w-5 text-muted-foreground" /></div>}
        <div className="divide-y max-h-[60vh] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="py-4 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge className="uppercase font-bold tracking-widest text-[9px]">
                    v{r.versionNumber}
                  </Badge>
                  {r.isConfident ? (
                    r.pageNumber != null ? (
                      <Badge className="uppercase font-bold tracking-widest text-[9px] bg-green-100 text-green-800 hover:bg-green-100">
                        Page {r.pageNumber}
                      </Badge>
                    ) : null
                  ) : (
                    <Badge
                      className="uppercase font-bold tracking-widest text-[9px] bg-orange-100 text-orange-800 hover:bg-orange-100"
                      title="The extractor could not confidently locate this value — coordinates are not fabricated."
                    >
                      <HelpCircle className="h-3 w-3 mr-1" /> AI unsure
                    </Badge>
                  )}
                </div>
                <div className="text-sm font-medium truncate">{r.documentName}</div>
                {r.sourceLabel && <div className="text-xs text-muted-foreground mt-0.5">{r.sourceLabel}</div>}
                <div className="text-[11px] text-muted-foreground mt-1 font-mono space-x-3">
                  {r.tableName && <span>table · {r.tableName}</span>}
                  {r.rowLabel  && <span>row · {r.rowLabel}</span>}
                  {r.columnLabel && <span>col · {r.columnLabel}</span>}
                </div>
                {r.rawText && (
                  <div className="text-[11px] text-muted-foreground italic mt-2 line-clamp-2">
                    “{r.rawText}”
                  </div>
                )}
                {r.extractor && (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Extracted by {r.extractor}
                    {r.extractorVersion ? ` · ${r.extractorVersion}` : ''}
                    {typeof r.confidence === 'number' ? ` · conf ${(r.confidence * 100).toFixed(0)}%` : ''}
                  </div>
                )}
              </div>
              <Button
                variant="outline" size="sm"
                onClick={() => viewSource(r)}
                disabled={openingId === r.id}
                title={r.isConfident && r.pageNumber ? `Open source at page ${r.pageNumber}` : 'Open source document'}
              >
                {openingId === r.id ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
