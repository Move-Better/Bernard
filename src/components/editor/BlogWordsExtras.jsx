import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RotateCcw, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { getPatientPrototypesUi } from '@/lib/prompts'
import { LENGTH_PRESETS, resolveLengthPreset } from '@/lib/lengthPresets'
import { useRegenerateBlogStreamed, useSplitBlogIntoSeries } from '@/lib/queries'
import { toast } from '@/lib/toast'

// Blog-only generation controls that lived in the pre-#2107 AssetsPane
// (RegenerateButton / GenerationStyleSwitcher / SplitIntoSeriesButton) and
// had nowhere to mount once that per-channel console was retired in favor of
// the unified editor. Mounted only under WordsPanel when piece.platform ===
// 'blog' — every mutation here reuses the same hooks the deleted code used
// (useRegenerateBlogStreamed / useSplitBlogIntoSeries), just re-homed.
//
// Story-level context (generation_style, tone, prototype_id) lived on
// `story` in the old AssetsPane, which had the parent interview in scope.
// This editor only has the piece (via /publish/:pieceId → useContentItem),
// so it fetches the lightweight interview record itself.

const GENERATION_STYLE_LABELS = {
  blog_post: 'Full blog post',
  minimal_edits: 'Cleaned transcript',
}
const GENERATION_STYLE_DESCRIPTIONS = {
  blog_post: 'A structured blog post rewritten from your interview — headlines, sections, links.',
  minimal_edits: 'Your exact words, cleaned of filler and broken into paragraphs. No restructuring.',
}

// Rendered above the body textarea. `interview` is fetched once by the
// caller (WordsPanel) and shared with BlogGenerationActions below so the two
// halves of this panel don't each fetch it independently.
export function BlogStyleSwitcher({ piece, interview }) {
  const regenerate = useRegenerateBlogStreamed()
  const currentStyle = interview?.generation_style || 'blog_post'
  const [pending, setPending] = useState(null)

  // Style choice applies to the blog editorial summary — doesn't make sense
  // past part 1 of a series (parts 2+ derive from part 1's summary).
  if (piece.series_id && piece.series_part !== 1) return null

  const handleSwitch = async (nextStyle) => {
    setPending(null)
    try {
      await regenerate.mutateAsync({ id: piece.id, generationStyle: nextStyle })
      toast.success(
        `Switched to ${GENERATION_STYLE_LABELS[nextStyle]}`,
        { description: 'Draft regenerated and reset for review.' },
      )
    } catch (e) {
      toast.error('Switch failed', { description: e.message })
    }
  }

  if (regenerate.isPending) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-2xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        Regenerating in the new style — this can take 30–60 seconds…
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div role="radiogroup" aria-label="Draft style" className="inline-flex rounded-lg border bg-muted/20 p-0.5">
        {(['blog_post', 'minimal_edits']).map((style) => {
          const active = style === currentStyle
          return (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => { if (!active) setPending(style) }}
              disabled={active}
              className={`rounded-md px-2.5 py-1 text-2xs transition ${
                active
                  ? 'bg-background text-foreground shadow-sm font-medium cursor-default'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/60'
              }`}
              title={GENERATION_STYLE_DESCRIPTIONS[style]}
            >
              {GENERATION_STYLE_LABELS[style]}
            </button>
          )
        })}
      </div>
      <p className="text-3xs text-muted-foreground italic">{GENERATION_STYLE_DESCRIPTIONS[currentStyle]}</p>

      {pending && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-2xs space-y-2">
          <p className="text-warning">
            Switch to <span className="font-medium">{GENERATION_STYLE_LABELS[pending]}</span>?
            The current draft and approval state will be replaced with a fresh AI generation.
          </p>
          <p className="text-warning/80">{GENERATION_STYLE_DESCRIPTIONS[pending]}</p>
          <div className="flex gap-1.5 justify-end">
            <Button size="sm" variant="outline" className="h-6 text-2xs border-warning/40 text-warning hover:bg-warning/10" onClick={() => handleSwitch(pending)}>
              Switch &amp; regenerate
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-2xs" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function RegenerateSection({ piece, interview }) {
  const regenerate = useRegenerateBlogStreamed()
  const workspace = useWorkspace()
  const [confirming, setConfirming] = useState(false)

  const initialLengthPreset = resolveLengthPreset(piece.length_preset, null)
  const [lengthPreset, setLengthPreset] = useState(initialLengthPreset)

  const handleRegenerate = async () => {
    setConfirming(false)
    try {
      await regenerate.mutateAsync({ id: piece.id, lengthPreset })
      toast.success('Regenerated', { description: 'Content rewritten and reset to draft.' })
    } catch (e) {
      toast.error('Regeneration failed', { description: e.message })
    }
  }

  const contextBullets = (() => {
    const bullets = []
    if (piece.staff_id || interview?.staff_id) bullets.push('Voice notes')
    const echoCount = piece.provenance?.summary?.voice_phrase_echo_count ?? 0
    if (echoCount > 0) bullets.push(`${echoCount} exemplar${echoCount === 1 ? '' : 's'}`)
    if (interview?.prototype_id && workspace) {
      const proto = getPatientPrototypesUi(workspace).find((p) => p.id === interview.prototype_id)
      if (proto?.label) bullets.push(`'${proto.label}' prototype`)
    }
    if (interview?.tone) bullets.push(`${interview.tone} tone`)
    const preset = LENGTH_PRESETS.find((p) => p.id === lengthPreset)
    if (preset) bullets.push(`${preset.label} length`)
    return bullets
  })()

  if (regenerate.isPending) {
    return (
      <div role="status" className="flex items-center gap-2 text-2xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        Regenerating — this can take 30–60 seconds…
      </div>
    )
  }

  if (confirming) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-2xs space-y-2">
        <span className="text-warning">
          Replace this draft with a fresh AI generation? Current text and approval state will be lost.
          {piece.staff_name && (
            <span className="block mt-0.5 text-warning/80">
              Bernard will apply {piece.staff_name}&rsquo;s voice settings.
            </span>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-warning/30">
          <span className="text-warning font-medium mr-1">Length:</span>
          {LENGTH_PRESETS.map((p) => {
            const selected = p.id === lengthPreset
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setLengthPreset(p.id)}
                title={`${p.description} (${p.targetWords} words)`}
                className={`rounded-full border px-2 py-0.5 text-3xs transition ${
                  selected
                    ? 'border-warning/60 bg-warning/30 text-warning font-medium'
                    : 'border-warning/30 bg-card text-warning hover:bg-warning/10'
                }`}
              >
                {p.emoji} {p.label}
              </button>
            )
          })}
        </div>
        <div className="flex gap-1.5 justify-end">
          <Button size="sm" variant="outline" className="h-6 text-2xs border-warning/40 text-warning hover:bg-warning/10" onClick={handleRegenerate}>
            Regenerate
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-2xs" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {contextBullets.length > 0 && (
        <div className="text-3xs text-muted-foreground italic">{contextBullets.join(' · ')}</div>
      )}
      <Button size="sm" variant="outline" className="h-7 text-2xs gap-1.5" onClick={() => setConfirming(true)}>
        <RotateCcw className="h-3 w-3" />
        Regenerate
      </Button>
    </div>
  )
}

function SplitIntoSeriesSection({ piece }) {
  const split = useSplitBlogIntoSeries()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [parts, setParts] = useState(2)

  if (piece.series_id) return null

  const handleSplit = async () => {
    setConfirming(false)
    try {
      const result = await split.mutateAsync({ id: piece.id, parts })
      const n = result?.parts?.length ?? parts
      // The source piece is archived on split — the route still points at
      // its (now-stale) id, so jump to the new Part 1 explicitly.
      const part1 = result?.parts?.find?.((p) => p.series_part === 1)
      if (part1?.id) navigate(`/publish/${part1.id}`, { replace: true })
      toast.success(`Split into ${n}-part series`, { description: 'New drafts created. Original blog archived for rollback.' })
    } catch (e) {
      toast.error('Series generation failed', {
        description: e?.message || 'Try again — the planner sometimes needs a second pass.',
      })
    }
  }

  if (split.isPending) {
    return (
      <div role="status" className="flex items-center gap-2 text-2xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        Planning + writing — this can take 1–3 minutes (one Opus pass to plan, one per part).
      </div>
    )
  }

  if (confirming) {
    return (
      <div className="rounded-md border border-[hsl(var(--scheduled)/0.4)] bg-[hsl(var(--scheduled)/0.06)] px-2.5 py-2 text-2xs space-y-2">
        <div className="text-foreground">
          <div className="font-medium mb-0.5">Split this blog into a series?</div>
          <div className="text-scheduled/80">
            The full interview will be re-planned and written as multiple linked posts, each focused on one thread. Your current blog will be archived (kept for rollback). Each new part is a fresh draft and needs review before publish.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[hsl(var(--scheduled)/0.25)]">
          <span className="text-foreground font-medium mr-1">Parts:</span>
          {[2, 3, 4].map((n) => {
            const selected = n === parts
            return (
              <button
                key={n}
                type="button"
                onClick={() => setParts(n)}
                className={`rounded-full border px-2 py-0.5 text-3xs transition ${
                  selected
                    ? 'border-[hsl(var(--scheduled)/0.6)] bg-[hsl(var(--scheduled)/0.2)] text-foreground font-medium'
                    : 'border-[hsl(var(--scheduled)/0.4)] bg-card text-scheduled hover:bg-[hsl(var(--scheduled)/0.12)]'
                }`}
              >
                {n} parts
              </button>
            )
          })}
        </div>
        <p className="text-3xs text-scheduled/70 italic">The planner may return fewer parts if there isn&rsquo;t enough material.</p>
        <div className="flex gap-1.5 justify-end">
          <Button size="sm" variant="outline" className="h-6 text-2xs border-[hsl(var(--scheduled)/0.5)] text-scheduled hover:bg-[hsl(var(--scheduled)/0.12)]" onClick={handleSplit}>
            Split into {parts} parts
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-2xs" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Button size="sm" variant="outline" className="h-7 text-2xs gap-1.5" onClick={() => setConfirming(true)}>
      <Layers className="h-3 w-3" />
      Split into series
    </Button>
  )
}

// Rendered below the body textarea.
export function BlogGenerationActions({ piece, interview }) {
  return (
    <div className="space-y-2 border-t pt-3">
      <RegenerateSection piece={piece} interview={interview} />
      <SplitIntoSeriesSection piece={piece} />
    </div>
  )
}
