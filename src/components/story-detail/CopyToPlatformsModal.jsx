// CopyToPlatformsModal — "Copy this post to other platforms" (feedback
// 21331b1d). Carries the SOURCE photo verbatim to other platforms; the
// caption is either kept exact (clamped to the target's own cap server-side)
// or re-fit in the target platform's voice. Fills an existing empty sibling
// draft when one exists, creates a fresh draft otherwise, and never touches a
// platform that's already live. Everything lands as a draft — the modal
// never publishes anything itself.
//
// Mockup: https://claude.ai/code/artifact/ef96ae12-bef9-4e80-8694-93f7051aa866

import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { PLATFORM_META, CAPTION_LIMITS } from '@/lib/contentMeta'
import { useCopyToPlatformsPreview, useCopyToPlatforms } from '@/lib/queries'

const SKIP_REASON_LABEL = {
  already_live: 'Already live — nothing to copy',
  already_has_media: 'Already has its own photo',
  fill_failed: "Couldn't update — try again",
  create_failed: "Couldn't create — try again",
}

export default function CopyToPlatformsModal({ piece, open, onOpenChange }) {
  const { data: preview = [], isLoading } = useCopyToPlatformsPreview(piece?.id, { enabled: open })
  const copy = useCopyToPlatforms()

  const [selected, setSelected] = useState(() => new Set())
  const [captionMode, setCaptionMode] = useState({})

  // Seed selection + per-platform caption default the moment the preview
  // loads: eligible targets start checked; the caption mode defaults to
  // "keep exact" when the source caption already fits the cap, "re-fit"
  // when it doesn't (a re-fit is a better result than a mid-sentence clamp).
  useEffect(() => {
    if (!open || !preview.length) return
    const sourceLen = (piece?.content || '').length
    const nextSelected = new Set()
    const nextMode = {}
    for (const row of preview) {
      if (row.action === 'skipped') continue
      nextSelected.add(row.platform)
      const cap = CAPTION_LIMITS[row.platform] ?? Infinity
      nextMode[row.platform] = sourceLen <= cap ? 'keep' : 'refit'
    }
    setSelected(nextSelected)
    setCaptionMode(nextMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preview.length])

  if (!piece) return null

  const toggle = (platform) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(platform)) next.delete(platform)
      else next.add(platform)
      return next
    })
  }

  const setMode = (platform, mode) => setCaptionMode((prev) => ({ ...prev, [platform]: mode }))

  const confirm = () => {
    const targets = [...selected].map((platform) => ({ platform, captionMode: captionMode[platform] || 'keep' }))
    if (!targets.length) return
    copy.mutate(
      { sourceId: piece.id, targets },
      {
        onSuccess: (data) => {
          const filled = (data?.results || []).filter((r) => r.action === 'filled').length
          const created = (data?.results || []).filter((r) => r.action === 'created').length
          toast.success('Copied to other platforms', {
            description: [
              filled ? `${filled} draft${filled === 1 ? '' : 's'} filled` : null,
              created ? `${created} new draft${created === 1 ? '' : 's'}` : null,
            ].filter(Boolean).join(' · ') || 'Done',
          })
          onOpenChange(false)
        },
      },
    )
  }

  const sourceMeta = PLATFORM_META[piece.platform] || { label: piece.platform }
  const selectedCount = selected.size

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4 text-action" />
            Copy this post to other platforms
          </DialogTitle>
          <DialogDescription>
            Keeps the photo that worked. Each platform gets its own draft — nothing publishes without your yes.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Copying from <span className="font-medium text-foreground">{sourceMeta.label}</span>
        </div>

        {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Checking other platforms&hellip;</p>}

        <div className="max-h-96 space-y-2 overflow-y-auto">
          {preview.map((row) => {
            const meta = PLATFORM_META[row.platform] || { label: row.platform }
            const Icon = meta.icon
            const skipped = row.action === 'skipped'
            const isChecked = selected.has(row.platform)
            const mode = captionMode[row.platform] || 'keep'
            return (
              <div
                key={row.platform}
                className={`rounded-lg border p-3 ${skipped ? 'opacity-60' : isChecked ? 'border-primary/40 bg-primary/5' : 'border-border'}`}
              >
                <button
                  type="button"
                  onClick={() => !skipped && toggle(row.platform)}
                  disabled={skipped}
                  className="flex w-full items-start gap-2.5 text-left disabled:cursor-not-allowed"
                >
                  <span
                    className={
                      isChecked && !skipped
                        ? 'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-primary bg-primary text-primary-foreground'
                        : 'mt-0.5 h-4 w-4 shrink-0 rounded border border-border'
                    }
                  >
                    {isChecked && !skipped && <Check className="h-3 w-3" />}
                  </span>
                  {Icon && <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{meta.label}</span>
                      <span className={`text-2xs font-semibold rounded px-1.5 py-0.5 ${
                        skipped ? 'bg-muted text-muted-foreground'
                          : row.action === 'fill' ? 'bg-primary/10 text-primary'
                          : 'bg-success/10 text-success'
                      }`}>
                        {skipped ? 'Skip' : row.action === 'fill' ? 'Fills the empty draft' : 'New draft'}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {skipped ? (SKIP_REASON_LABEL[row.reason] || 'Not available') : null}
                    </span>
                  </span>
                </button>
                {!skipped && isChecked && (
                  <div className="mt-2 ml-7 inline-flex rounded-md border border-border text-2xs overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setMode(row.platform, 'keep')}
                      className={`px-2 py-1 font-medium ${mode === 'keep' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      Keep exact
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode(row.platform, 'refit')}
                      className={`px-2 py-1 font-medium ${mode === 'refit' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      Re-fit for {meta.label}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedCount} selected · lands as {selectedCount === 1 ? 'a draft' : 'drafts'}, waits for your approval.
          </span>
          <Button
            onClick={confirm}
            disabled={!selectedCount || copy.isPending}
            loading={copy.isPending}
            className="bg-action text-action-foreground hover:bg-action/90"
          >
            {!copy.isPending && <Copy className="h-3.5 w-3.5 mr-1.5" />}
            Create {selectedCount || ''} draft{selectedCount === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
