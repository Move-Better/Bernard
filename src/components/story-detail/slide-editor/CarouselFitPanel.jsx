import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Crop } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { CAROUSEL_REFRAME_Y, clampReframeY, mayNeedCarouselRebake } from '@/lib/carouselCrop'

// Fit-to-carousel — the crop step for a video slide (mockup rev 2, screen 2).
//
// A 9:16 clip is below Instagram's 0.8 carousel floor, so it can only join a
// 4:5 deck as a real re-bake. Bernard proposes a downward nudge and the
// producer confirms or drags; the human is in this loop for exactly one thing,
// WHERE THE SUBJECT SITS, because captions re-place by formula but the crop
// cannot. Replaying the reel's own crop is what puts the caption on the
// subject's face (measured — see .claude/video-aspect-bake-design.md).
//
// Every confirm-vs-drag is override signal for the format-confidence loop, so
// this step should get quieter over time rather than being a permanent tax.

export default function CarouselFitPanel({ entry, onFitted }) {
  const existing = entry?.carouselVariant || null
  const [y, setY] = useState(() => {
    const prior = Number(existing?.reframe?.y)
    return Number.isFinite(prior) ? prior : CAROUSEL_REFRAME_Y
  })
  const [busy, setBusy] = useState(false)

  // A landscape or square master already sits inside Instagram's 0.8–1.91
  // window and needs nothing. But media entries only carry width/height when
  // they came through the Library picker — the suggestion path (clipSearch)
  // doesn't select those columns — so dimensions are frequently UNKNOWN, and a
  // strict check would hide this panel on almost every clip. mayNeedCarouselRebake
  // fails open for exactly that reason: a redundant render is recoverable, a
  // hidden control that would have prevented a rejected publish is not.
  const needsFit = mayNeedCarouselRebake(entry)
  if (!needsFit && !existing) return null

  async function runFit() {
    if (!entry?.mediaAssetId) return
    setBusy(true)
    try {
      const r = await apiFetch('/api/editorial/fit-carousel-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: entry.mediaAssetId, reframe: { y: clampReframeY(y) } }),
      })
      if (!r?.variant?.blobUrl) throw new Error('no variant returned')
      onFitted({
        url: r.variant.blobUrl,
        thumbnailUrl: r.variant.thumbnailUrl || null,
        assetId: r.variant.id,
        width: r.variant.width,
        height: r.variant.height,
        reframe: r.reframe,
      })
      toast.success('Fitted to the carousel', { description: '4:5 version saved — captions re-placed for the new frame.' })
    } catch (e) {
      // Fail loud with a way forward: a silent failure here means the piece
      // publishes the 9:16 master, which Instagram rejects outright.
      toast.error('Could not fit this clip', { description: e?.message || 'Try again in a moment.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Crop className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Fit to carousel · 4:5
        </p>
      </div>

      <p className="text-3xs leading-relaxed text-muted-foreground">
        This clip is taller than a carousel slot. Bernard re-bakes it at 4:5 and re-places the
        captions; you choose where the subject sits.
      </p>

      <label className="block space-y-1">
        <span className="flex items-center justify-between text-3xs font-medium text-muted-foreground">
          <span>Vertical position</span>
          <span className="tabular-nums">{Math.round(y * 100)}%</span>
        </span>
        <input
          type="range"
          min="0" max="1" step="0.02"
          value={y}
          onChange={(e) => setY(clampReframeY(e.target.value))}
          disabled={busy}
          aria-label="Vertical crop position"
          className="w-full accent-[hsl(var(--primary))]"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={runFit}
          disabled={busy || !entry?.mediaAssetId}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          {busy ? 'Baking…' : existing ? 'Re-fit' : 'Fit to carousel'}
        </button>
        {y !== CAROUSEL_REFRAME_Y && (
          <button
            type="button"
            onClick={() => setY(CAROUSEL_REFRAME_Y)}
            disabled={busy}
            className="text-3xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Reset to suggested
          </button>
        )}
      </div>

      {existing?.url && (
        <p className="text-3xs text-success">✓ 4:5 version ready — this is what publishes.</p>
      )}
      {!existing?.url && (
        <p className="text-3xs text-action">
          Not fitted yet — Instagram rejects a clip this shape in a carousel.
        </p>
      )}
    </div>
  )
}
