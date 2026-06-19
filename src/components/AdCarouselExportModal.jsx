import { useState } from 'react'
import { X, Megaphone, ShieldAlert, Download, Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { renderCarouselAds } from '@/lib/renderSlides'
import { saveAdCreative } from '@/lib/ads'
import { useCampaigns } from '@/lib/queries'
import { downloadBlobFile } from '@/lib/download'
import { toast } from '@/lib/toast'

// Carousel ads use one aspect across all cards (Meta requirement), so this is a
// single-choice picker, not a multi-select pack.
const CAROUSEL_ASPECTS = [
  { aspect: '4:5',  label: '4:5',  px: '1080×1350', note: 'Meta feed (best)' },
  { aspect: '1:1',  label: '1:1',  px: '1080²',     note: 'Meta/IG feed' },
  { aspect: '9:16', label: '9:16', px: '1080×1920', note: 'Stories' },
]

const ASPECT_BOX = { '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '9:16': 'aspect-[9/16]' }

function baseName(title) {
  const n = String(title || 'carousel-ad')
  const dot = n.lastIndexOf('.')
  return (dot > 0 ? n.slice(0, dot) : n) || 'carousel-ad'
}

/**
 * Export a whole carousel as ad creative at one chosen aspect (all slides
 * uniform). Renders each slide from the source via the shared slide renderer,
 * downloads them, and saves the set to the Ads surface.
 *
 * @param {{ piece: any, slides: any[], mediaUrls: any[], brandStyle: object, theme: any, themeId: any, customThemes: any[], onClose: () => void }} props
 */
export default function AdCarouselExportModal({ piece, slides, mediaUrls, brandStyle, theme, themeId, customThemes, onClose }) {
  const base = baseName(piece?.display_title || piece?.title)
  const [aspect, setAspect] = useState('4:5')
  const [complies, setComplies] = useState(false)
  const [campaignId, setCampaignId] = useState('')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState(/** @type {Array<{slide:number,url:string}>|null} */ (null))
  const { data: campaigns = [] } = useCampaigns()

  // Drop empty text blocks the same way handleSave does, so the export matches
  // what would publish.
  const cleaned = (slides || []).map((s) => ({
    photo_idx: typeof s.photo_idx === 'number' ? s.photo_idx : null,
    template: s.template,
    template_id: s.template_id,
    blocks: (s.blocks || []).filter((b) => (b.text || '').trim() !== ''),
  }))

  async function run() {
    setRunning(true)
    setResults(null)
    try {
      const out = await renderCarouselAds({
        slides: cleaned, mediaUrls, brandStyle, theme, themeId, customThemes, pieceId: piece.id, aspect,
      })
      setResults(out)
      for (const r of out) {
        await downloadBlobFile(r.url, `${base}-${aspect.replace(':', 'x')}-slide${r.slide + 1}.jpg`)
        await new Promise((res) => setTimeout(res, 300))
      }
      toast.success(`Exported ${out.length}-slide carousel (${aspect})`)
      try {
        await saveAdCreative({
          mediaType: 'carousel',
          sizes: out.map((r) => ({ aspect, url: r.url, slide: r.slide })),
          campaignId: campaignId || null,
          sourcePieceId: piece.id,
          title: piece?.display_title || piece?.title || null,
        })
      } catch { /* don't block the download path */ }
    } catch (e) {
      toast.error("Couldn't export the carousel", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRunning(false)
    }
  }

  const canRun = complies && !running && cleaned.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl">
        <div className="flex items-center gap-2 border-b px-5 py-3">
          <Megaphone className="h-4 w-4 text-action" />
          <span className="text-sm font-semibold">Export carousel for ads</span>
          <span className="text-2xs text-muted-foreground">· {cleaned.length} slide{cleaned.length !== 1 ? 's' : ''}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {campaigns.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Group under campaign:</span>
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                disabled={running}
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50"
              >
                <option value="">— none —</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div className="mb-4 flex gap-2.5 rounded-lg border border-warning bg-warning/10 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="text-xs">
              <p className="font-semibold">Healthcare ad-policy check (Meta &amp; Google)</p>
              <p className="mt-0.5 text-2xs text-muted-foreground">No before/after photos, and no personal-attribute language in the on-slide text.</p>
              <label className="mt-2 flex items-center gap-1.5 text-2xs font-medium">
                <input type="checkbox" checked={complies} onChange={(e) => setComplies(e.target.checked)} />
                This creative complies — enable export
              </label>
            </div>
          </div>

          <div className="mb-2 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
            Aspect — all slides export at this size
          </div>
          <div className="grid grid-cols-3 gap-3">
            {CAROUSEL_ASPECTS.map((f) => (
              <button
                key={f.aspect}
                type="button"
                onClick={() => !running && setAspect(f.aspect)}
                disabled={running}
                className={`rounded-lg border p-2 text-left transition-colors disabled:cursor-not-allowed ${aspect === f.aspect ? 'border-primary' : 'border-border opacity-60'}`}
              >
                <div className={`relative mx-auto overflow-hidden rounded bg-muted ${ASPECT_BOX[f.aspect]} ${f.aspect === '9:16' ? 'w-3/4' : 'w-full'}`}>
                  {aspect === f.aspect && (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-2xs font-semibold">{f.label} · {f.px}</p>
                <p className="text-3xs text-muted-foreground">{f.note}</p>
              </button>
            ))}
          </div>

          <p className="mt-3 text-3xs text-muted-foreground">
            All {cleaned.length} slides render at {aspect} (carousel ads require one aspect across cards). On-slide text re-flows to fit.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-3">
          {results && (
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-success" /> {results.length} slides exported
            </span>
          )}
          <Button
            className="ml-auto gap-1.5 bg-action text-action-foreground hover:bg-action/90"
            disabled={!canRun}
            onClick={run}
            title={!complies ? 'Confirm the policy check first' : undefined}
          >
            {running
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Rendering…</>
              : <><Download className="h-4 w-4" /> Render &amp; download ({aspect})</>}
          </Button>
        </div>

        {results && results.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t px-5 py-2">
            {results.map((r) => (
              <Button
                key={r.slide}
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-2xs"
                onClick={() => downloadBlobFile(r.url, `${base}-${aspect.replace(':', 'x')}-slide${r.slide + 1}.jpg`)}
              >
                <Download className="h-3 w-3" /> Slide {r.slide + 1}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
