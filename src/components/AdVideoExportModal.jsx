import { useState } from 'react'
import { X, Megaphone, ShieldAlert, Download, Loader2, Check, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { renderAdVideo, saveAdCreative } from '@/lib/ads'
import { useCampaigns } from '@/lib/queries'
import { downloadBlobFile } from '@/lib/download'
import { AD_FORMATS } from '@/lib/adFormats'
import { toast } from '@/lib/toast'

// Default to the two highest-value video sizes; 4:5 and 16:9 are opt-in because
// each aspect is a full ffmpeg re-encode (slow, one at a time).
const DEFAULT_VIDEO_ASPECTS = ['9:16', '1:1']

const ASPECT_BOX = {
  '1:1':  'aspect-square',
  '4:5':  'aspect-[4/5]',
  '9:16': 'aspect-[9/16]',
  '16:9': 'aspect-video',
}

function baseName(name) {
  const n = String(name || 'clip-ad')
  const dot = n.lastIndexOf('.')
  return (dot > 0 ? n.slice(0, dot) : n) || 'clip-ad'
}

/**
 * Ad-creative export for a video clip. Renders the selected ad aspects from the
 * SOURCE video using the clip window — one ffmpeg re-encode per aspect, in
 * sequence, downloading each as it completes.
 *
 * @param {{ clip: { assetId: string, startSec?: number, durationSec?: number, captionText?: string, overlayPosition?: string, overlaySize?: string, title?: string }, onClose: () => void }} props
 */
export default function AdVideoExportModal({ clip, onClose }) {
  const base = baseName(clip?.title)
  const [selected, setSelected] = useState(() => new Set(DEFAULT_VIDEO_ASPECTS))
  const [complies, setComplies] = useState(false)
  const [campaignId, setCampaignId] = useState('')
  const [running, setRunning] = useState(false)
  // { [aspect]: { status: 'rendering'|'done'|'error', url?, error? } }
  const [results, setResults] = useState({})
  const { data: campaigns = [] } = useCampaigns()

  function toggle(aspect) {
    if (running) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(aspect)) next.delete(aspect)
      else next.add(aspect)
      return next
    })
  }

  async function renderSelected() {
    setRunning(true)
    const aspects = AD_FORMATS.map((f) => f.aspect).filter((a) => selected.has(a))
    const done = []
    for (const aspect of aspects) {
      setResults((r) => ({ ...r, [aspect]: { status: 'rendering' } }))
      try {
        const out = await renderAdVideo({
          assetId: clip.assetId,
          aspect,
          startSec: clip.startSec,
          durationSec: clip.durationSec,
          captionText: clip.captionText,
          overlayPosition: clip.overlayPosition,
          overlaySize: clip.overlaySize,
        })
        setResults((r) => ({ ...r, [aspect]: { status: 'done', url: out.url } }))
        await downloadBlobFile(out.url, `${base}-${aspect.replace(':', 'x')}.mp4`)
        done.push({ aspect, url: out.url, width: out.width, height: out.height })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setResults((r) => ({ ...r, [aspect]: { status: 'error', error: message } }))
        toast.error(`Couldn't render ${aspect}`, { description: message })
      }
    }
    setRunning(false)
    if (done.length > 0) {
      toast.success(`Exported ${done.length} video ${done.length === 1 ? 'size' : 'sizes'}`)
      // Persist to the /ads surface (non-fatal — the files already downloaded).
      try {
        await saveAdCreative({
          mediaType: 'video',
          sizes: done,
          campaignId: campaignId || null,
          sourceAssetId: clip.assetId || null,
          title: clip.title || null,
          caption: clip.captionText || null,
        })
      } catch { /* don't block the download path */ }
    }
  }

  const canRender = complies && selected.size > 0 && !running

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl">
        <div className="flex items-center gap-2 border-b px-5 py-3">
          <Megaphone className="h-4 w-4 text-action" />
          <span className="text-sm font-semibold">Export clip for ads</span>
          {clip?.title && <span className="truncate text-2xs text-muted-foreground">· {clip.title}</span>}
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {/* Campaign tag — optional grouping on the Ads surface */}
          {campaigns.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Group under campaign:</span>
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                disabled={running}
                aria-label="Group under campaign"
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50"
              >
                <option value="">— none —</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Healthcare guardrail */}
          <div className="mb-4 flex gap-2.5 rounded-lg border border-warning bg-warning/10 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="text-xs">
              <p className="font-semibold">Healthcare ad-policy check (Meta &amp; Google)</p>
              <p className="mt-0.5 text-2xs text-muted-foreground">
                No before/after demos, and no personal-attribute language in the caption or burned-in text.
              </p>
              <label className="mt-2 flex items-center gap-1.5 text-2xs font-medium">
                <input type="checkbox" checked={complies} onChange={(e) => setComplies(e.target.checked)} />
                This creative complies — enable render
              </label>
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Pick sizes</span>
            <span className="text-2xs text-muted-foreground">{selected.size} selected · rendered one at a time</span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {AD_FORMATS.map((f) => {
              const on = selected.has(f.aspect)
              const r = results[f.aspect]
              return (
                <button
                  key={f.aspect}
                  type="button"
                  onClick={() => toggle(f.aspect)}
                  disabled={running}
                  className={`rounded-lg border p-2 text-left transition-colors disabled:cursor-not-allowed ${on ? 'border-primary' : 'border-border opacity-60'}`}
                >
                  <div className={`relative flex items-center justify-center overflow-hidden rounded bg-muted ${ASPECT_BOX[f.aspect]}`}>
                    {r?.status === 'rendering' && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                    {r?.status === 'done' && <Check className="h-6 w-6 text-success" />}
                    {r?.status === 'error' && <AlertCircle className="h-6 w-6 text-destructive" />}
                    {on && !r && (
                      <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-2xs font-semibold">
                    {f.aspect}{f.aspect === '9:16' ? ' · native' : ''}
                  </p>
                  <p className="text-3xs text-muted-foreground">{f.platforms}</p>
                </button>
              )
            })}
          </div>

          <p className="mt-3 text-3xs text-muted-foreground">
            Each size is a fresh crop of the clip window from the source video — captions re-burned to fit. Renders one at a time and downloads as each finishes.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-3">
          <Button
            className="ml-auto gap-1.5 bg-action text-action-foreground hover:bg-action/90"
            disabled={!canRender}
            onClick={renderSelected}
            title={!complies ? 'Confirm the policy check first' : undefined}
          >
            {running
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Rendering…</>
              : <><Download className="h-4 w-4" /> Render &amp; download selected ({selected.size})</>}
          </Button>
        </div>

        {/* Per-size re-download for completed renders */}
        {Object.values(results).some((r) => r.status === 'done') && (
          <div className="flex flex-wrap gap-1.5 border-t px-5 py-2">
            {AD_FORMATS.filter((f) => results[f.aspect]?.status === 'done').map((f) => (
              <Button
                key={f.aspect}
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-2xs"
                onClick={() => downloadBlobFile(results[f.aspect].url, `${base}-${f.aspect.replace(':', 'x')}.mp4`)}
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
