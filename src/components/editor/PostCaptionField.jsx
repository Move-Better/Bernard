import { useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/toast'

// PostCaptionField — the one save-on-blur textarea bound to a content item's
// post caption (`content_items.content`, the text that publishes below the
// post). Extracted from UnifiedEditor's WordsPanel so the reel/video editor
// (VideoEditor's Post-caption inspector) and the unified shell editor share ONE
// implementation of the load-bearing behavior — draft state, save-on-blur, and
// the re-seed-without-clobbering-unsaved-edits guard — rather than two copies
// that drift. (There is no client↔server boundary here; both callers live under
// src/.)
//
// This owns ONLY the textarea + hint. Callers supply their own header/label
// chrome and any extras (blog switcher, regenerate button) as siblings.
//
// Props:
//   piece         : the content item; reads piece.content, patches piece.id
//   updateItem    : a useUpdateContentItem() mutation
//   ariaLabel     : accessible label for the textarea
//   placeholder   : empty-state placeholder text
//   hint          : the line shown under the textarea (accuracy matters — only
//                   claim a live preview updates if the host actually shows one)
//   minHeightClass: tailwind min-height for the textarea (default min-h-[200px])
export default function PostCaptionField({
  piece,
  updateItem,
  ariaLabel = 'Caption',
  placeholder = 'Caption visible to followers…',
  hint = 'Saves when you click away.',
  minHeightClass = 'min-h-[200px]',
}) {
  const [draft, setDraft] = useState(() => (typeof piece?.content === 'string' ? piece.content : ''))
  const savedRef = useRef(draft)

  // Re-seed on piece switch AND when the persisted content changes underneath
  // us — e.g. Regenerate replaces content in place (same id), or the live
  // content-item query resolves with fresher text than the initial prop. The
  // savedRef guard means unsaved local edits (which differ from savedRef while
  // the incoming prop still equals it) are never clobbered.
  useEffect(() => {
    const next = typeof piece?.content === 'string' ? piece.content : ''
    if (next !== savedRef.current) {
      setDraft(next)
      savedRef.current = next
    }
  }, [piece?.id, piece?.content])

  async function handleBlur() {
    if (draft === savedRef.current) return
    if (!piece?.id) return
    try {
      await updateItem.mutateAsync({ id: piece.id, patch: { content: draft } })
      savedRef.current = draft
    } catch (e) {
      toast.error('Caption save failed', { description: e?.message })
    }
  }

  return (
    <>
      <textarea
        aria-label={ariaLabel}
        spellCheck
        lang="en"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={`${minHeightClass} flex-1 w-full resize-none rounded-md border bg-muted/40 px-2 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:bg-background focus:border-primary focus:outline-none`}
      />
      <p className="shrink-0 text-3xs text-muted-foreground/70">{hint}</p>
    </>
  )
}
