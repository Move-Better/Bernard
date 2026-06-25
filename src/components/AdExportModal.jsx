import { useState } from 'react'
import { X, Megaphone, ShieldAlert, Download, Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { useAppMutation } from '@/lib/useAppMutation'
import { renderAdPack, saveAdCreative } from '@/lib/ads'
import { useCampaigns } from '@/lib/queries'
import { downloadMany, downloadBlobFile } from '@/lib/download'
import { AD_FORMATS } from '@/lib/adFormats'
import { toast } from '@/lib/toast'

// Strip the extension off a filename to build per-size export names.
function baseName(filename) {
  const n = String(filename || 'ad-creative')
  const dot = n.lastIndexOf('.')
  return (dot > 0 ? n.slice(0, dot) : n) || 'ad-creative'
}

// Tailwind aspect-ratio helper per format (avoids dynamic class strings, which
// the JIT compiler can't see).
const ASPECT_BOX = {
  '1:1':  'aspect-square',
  '4:5':  'aspect-[4/5]',
  '9:16': 'aspect-[9/16]',
  '16:9': 'aspect-video',
}

/**
 * Ad-creative export modal. Re-renders a source photo into the selected ad
 * sizes and downloads the pack. Shared entry point — opened from the Library
 * item drawer, the Ads "New ad creative" flow, and the Storyboard compositor.
 *
 * When a `treatment` (+ optional WHOOP `templateId`) is supplied — as the
 * Storyboard "Export for ads" action does — the SAME editorial/WHOOP overlay
 * the piece was baked with is re-applied at each ad aspect, so the exported
 * sizes carry the baked headline. Without a treatment (the Library case) each
 * size is a clean subject-aware crop. `sourcePieceId` links the saved creative
 * back to the originating piece.
 *
 * @param {{ asset: any, onClose: () => void, treatment?: object, templateId?: string, sourcePieceId?: string }} props
 */
export default function AdExportModal({ asset, onClose, treatment, templateId, sourcePieceId }) {
  const sourceUrl = asset?.original_blob_url || asset?.blob_url || asset?.web_blob_url || ''
  const base = baseName(asset?.filename)

  // When a baked overlay is in play (an editorial headline or a non-default
  // template), 16:9 starts unchecked: the overlay is laid out for portrait/square
  // and a long headline overflows the short landscape canvas. Still selectable —
  // just not a broken default. A bare crop (Library export) keeps all four on.
  const hasBakedOverlay = !!String(treatment?.headline || '').trim()
    || (!!templateId && templateId !== 'editorial')
  const [selected, setSelected] = useState(() => new Set(
    AD_FORMATS.map((f) => f.aspect).filter((a) => !(hasBakedOverlay && a === '16:9')),
  ))
  const [complies, setComplies] = useState(false)
  const [campaignId, setCampaignId] = useState('')
  const [files, setFiles] = useState(/** @type {Array<{aspect:string,url:string}>|null} */ (null))
  const { data: campaigns = [] } = useCampaigns()

  const render = useAppMutation({
    errorMessage: "Couldn't render the ad pack",
    mutationFn: (aspects) => renderAdPack({ sourceUrl, aspects, treatment, templateId }),
    onSuccess: async (data) => {
      const out = data?.files || []
      setFiles(out)
      await downloadMany(out.map((f) => ({ url: f.url, filename: `${base}-${f.aspect.replace(':', 'x')}.jpg` })))
      toast.success(`Exported ${out.length} ad ${out.length === 1 ? 'size' : 'sizes'}`)
      // Persist to the /ads surface (non-fatal — the files already downloaded).
      try {
        await saveAdCreative({
          mediaType: 'photo',
          sizes: out,
          campaignId: campaignId || null,
          sourceAssetId: asset?.id || null,
          sourcePieceId: sourcePieceId || null,
          title: asset?.display_title || asset?.filename || null,
          treatment: treatment || null,
        })
      } catch { /* surfaced on the Ads page when it next loads; don't block download */ }
    },
  })

  function toggle(aspect) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(aspect)) next.delete(aspect)
      else next.add(aspect)
      return next
    })
    setFiles(null) // selection changed — prior render is stale
  }

  const canDownload = complies && selected.size > 0 && !render.isPending
  const fileFor = (aspect) => files?.find((f) => f.aspect === aspect)

  return (
    <div role="dialog" aria-modal="true" aria-label="Export photo for ads" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-5 py-3">
          <Megaphone className="h-4 w-4 text-action" />
          <span className="text-sm font-semibold">Export for ads</span>
          <span className="truncate text-2xs text-muted-foreground">· {asset?.display_title || asset?.filename}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close"><X className="h-4 w-4" aria-hidden="true" /></Button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {/* Campaign tag — optional grouping on the Ads surface */}
          {campaigns.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Group under campaign:</span>
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger className="flex-1 h-8 text-xs" aria-label="Group under campaign">
                  <SelectValue placeholder="— none —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— none —</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Healthcare guardrail */}
          <div className="mb-4 flex gap-2.5 rounded-lg border border-warning bg-warning/10 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="text-xs">
              <p className="font-semibold">Healthcare ad-policy check (Meta &amp; Google)</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-2xs text-muted-foreground">
                <li><b>No before/after photos</b> — Meta bans them for health &amp; wellness.</li>
                <li><b>No personal-attribute language</b> — &ldquo;your back pain&rdquo; → &ldquo;back pain is common.&rdquo;</li>
                <li>Health/wellness audiences have <b>restricted targeting</b>; some claims need substantiation.</li>
              </ul>
              <label className="mt-2 flex items-center gap-1.5 text-2xs font-medium">
                <input type="checkbox" checked={complies} onChange={(e) => setComplies(e.target.checked)} />
                This creative complies — enable download
              </label>
            </div>
          </div>

          {/* Size grid */}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Pick sizes</span>
            <span className="text-2xs text-muted-foreground">{selected.size} selected</span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {AD_FORMATS.map((f) => {
              const on = selected.has(f.aspect)
              const done = fileFor(f.aspect)
              return (
                <button
                  key={f.aspect}
                  type="button"
                  onClick={() => toggle(f.aspect)}
                  className={`rounded-lg border p-2 text-left transition-colors ${on ? 'border-primary' : 'border-border opacity-60'}`}
                >
                  <div className={`relative overflow-hidden rounded bg-muted ${ASPECT_BOX[f.aspect]}`}>
                    {done
                      ? <img src={done.url} alt="" className="h-full w-full object-cover" />
                      : sourceUrl
                        ? <img src={sourceUrl} alt="" className="h-full w-full object-cover" />
                        : null}
                    {on && (
                      <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-2xs font-semibold">{f.aspect} · {f.px}</p>
                  <p className="text-3xs text-muted-foreground">{f.platforms}</p>
                </button>
              )
            })}
          </div>

          <p className="mt-3 text-3xs text-muted-foreground">
            Each size is a subject-aware crop + brand grade of the original — your source piece is never changed.
          </p>
          {hasBakedOverlay && (
            <p className="mt-1 text-3xs text-muted-foreground">
              16:9 starts off — the headline is laid out for portrait/square and can overflow a wide frame. Turn it on if you need it.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t px-5 py-3">
          {files && (
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-success" /> Rendered — re-download any size above
            </span>
          )}
          <Button
            className="ml-auto gap-1.5 bg-action text-action-foreground hover:bg-action/90"
            disabled={!canDownload}
            onClick={() => render.mutate([...selected])}
            title={!complies ? 'Confirm the policy check first' : undefined}
          >
            {render.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Rendering…</>
              : <><Download className="h-4 w-4" /> Download ad pack ({selected.size})</>}
          </Button>
        </div>

        {/* Per-size re-download (after render) */}
        {files && files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t px-5 py-2">
            {files.map((f) => (
              <Button
                key={f.aspect}
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-2xs"
                onClick={() => downloadBlobFile(f.url, `${base}-${f.aspect.replace(':', 'x')}.jpg`)}
              >
                <Download className="h-3 w-3" /> {f.aspect}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
