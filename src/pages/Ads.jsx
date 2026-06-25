import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Download, Trash2, Film, Plus, Target, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppMutation } from '@/lib/useAppMutation'
import { listAdCreatives, deleteAdCreative } from '@/lib/ads'
import { downloadBlobFile } from '@/lib/download'
import { AD_ASPECTS } from '@/lib/adFormats'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { toast } from '@/lib/toast'
import AdCreateFlow from '@/components/AdCreateFlow'

// Order a creative's sizes by the canonical ad-format order for stable chips.
function orderedSizes(sizes) {
  const arr = Array.isArray(sizes) ? sizes : []
  return [...arr].sort((a, b) => AD_ASPECTS.indexOf(a.aspect) - AD_ASPECTS.indexOf(b.aspect))
}

function baseName(title) {
  const n = String(title || 'ad-creative')
  const dot = n.lastIndexOf('.')
  return (dot > 0 ? n.slice(0, dot) : n) || 'ad-creative'
}

function CreativeCard({ creative, onDelete, deleting }) {
  const isVideo = creative.media_type === 'video'
  const isCarousel = creative.media_type === 'carousel'
  const ext = isVideo ? 'mp4' : 'jpg'
  const base = baseName(creative.title)

  // Carousel: many slides at one aspect → order by slide, label per slide.
  // Photo/video: one image per aspect → order by aspect, label per aspect.
  const raw = Array.isArray(creative.sizes) ? creative.sizes : []
  const items = isCarousel
    ? [...raw].sort((a, b) => (a.slide ?? 0) - (b.slide ?? 0)).map((s, i) => ({
        key: `s${s.slide ?? i}`, url: s.url,
        label: `S${(s.slide ?? i) + 1}`,
        filename: `${base}-${(s.aspect || 'ad').replace(':', 'x')}-slide${(s.slide ?? i) + 1}.jpg`,
      }))
    : orderedSizes(raw).map((s) => ({
        key: s.aspect, url: s.url, label: s.aspect,
        filename: `${base}-${s.aspect.replace(':', 'x')}.${ext}`,
      }))
  const preview = items[0]?.url
  const subtitle = isCarousel ? `carousel · ${raw[0]?.aspect || ''} · ${items.length} slides` : null

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="relative aspect-[4/5] bg-muted">
        {isVideo ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <Film className="h-6 w-6" />
            <span className="text-3xs">video</span>
          </div>
        ) : preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : null}
        {isCarousel && (
          <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-3xs font-medium text-white">
            {items.length} slides
          </span>
        )}
        <button
          type="button"
          onClick={() => onDelete(creative.id)}
          disabled={deleting}
          aria-label="Remove from Ads"
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-white transition-colors hover:bg-destructive disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
      <div className="p-2">
        <p className="truncate text-2xs font-medium" title={creative.title || ''}>{creative.title || 'Untitled'}</p>
        {subtitle && <p className="truncate text-3xs text-muted-foreground">{subtitle}</p>}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => downloadBlobFile(it.url, it.filename)}
              aria-label={`Download ${it.label} version`}
              className="flex items-center gap-0.5 rounded border border-action/40 bg-action/10 px-1.5 py-0.5 text-3xs font-semibold text-action hover:bg-action/20"
            >
              <Download className="h-2.5 w-2.5" aria-hidden="true" /> {it.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Ads() {
  useDocumentTitle('Ads')
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)

  const { data: creatives = [], isLoading } = useQuery({
    queryKey: ['ad-creatives'],
    queryFn: listAdCreatives,
    staleTime: 30_000,
  })

  const del = useAppMutation({
    errorMessage: "Couldn't remove that ad creative",
    mutationFn: (id) => deleteAdCreative(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ad-creatives'] })
      toast.success('Removed from Ads')
    },
  })

  // Group by campaign; campaigns with creatives first (alpha), Ungrouped last.
  const groups = []
  const byKey = new Map()
  for (const c of creatives) {
    const key = c.campaign_id || 'none'
    let g = byKey.get(key)
    if (!g) {
      g = { key, campaign: c.campaigns || null, items: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.items.push(c)
  }
  groups.sort((a, b) => {
    if (a.key === 'none') return 1
    if (b.key === 'none') return -1
    return (a.campaign?.name || '').localeCompare(b.campaign?.name || '')
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="mt-1 flex items-end gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Megaphone className="h-6 w-6 text-action" /> Ads
        </h1>
        <span className="mb-0.5 text-sm text-muted-foreground">ad-ready creative, grouped by campaign</span>
        <Button size="sm" className="mb-0.5 ml-auto gap-1.5" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" /> New ad creative
        </Button>
      </div>

      <p className="-mt-2 text-xs text-muted-foreground">
        Export ad sizes from any photo in the <Link to="/library" className="text-primary">Library</Link> or any clip in <Link to="/moments" className="text-primary">Moment Miner</Link> — they collect here, ready to download for Meta, Google, and paid social.
      </p>

      {isLoading ? (
        <div role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading…</span>
          <span aria-hidden="true">Loading…</span>
        </div>
      ) : creatives.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Megaphone className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm font-medium">No ad creative yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Hit <span className="font-semibold text-action">New ad creative</span> to pick a photo or clip, or export from any photo in the Library or clip in Moment Miner.
          </p>
          <Button size="sm" className="mt-3 gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New ad creative
          </Button>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key}>
            <div className="mb-2 flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">{g.campaign?.name || 'Ungrouped'}</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-3xs text-muted-foreground">
                {g.items.length} creative{g.items.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {g.items.map((c) => (
                <CreativeCard key={c.id} creative={c} onDelete={del.mutate} deleting={del.isPending} />
              ))}
            </div>
          </section>
        ))
      )}

      {creating && (
        <AdCreateFlow
          onClose={() => {
            setCreating(false)
            // A new creative may have been saved mid-flow — refresh the grid.
            queryClient.invalidateQueries({ queryKey: ['ad-creatives'] })
          }}
        />
      )}
    </div>
  )
}
