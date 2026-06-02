import { useState } from 'react'
import { Loader2, Film, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { renderWholeVideo } from '@/lib/clipsLib'

// Keep-whole long-form lane (increment ②). Sibling to <ClipFinder> in the
// MediaDetail drawer for video sources. Where "Find clips" SEGMENTS the source
// into many short vertical moments, this renders the WHOLE source as one
// landscape, keep-whole (letterboxed, full-frame — no speaker-cropping) story
// package. Both are explicit, opt-in choices; neither is automatic.

export default function WholeVideoAction({ asset, canEdit }) {
  const assetId = asset.id
  const [rendering, setRendering] = useState(false)

  async function handleUseWhole() {
    setRendering(true)
    try {
      await renderWholeVideo(assetId)
      toast('Rendering full-length video — track it in Slate.', {
        action: { label: 'Open Slate', onClick: () => { window.location.href = '/slate' } },
      })
    } catch (e) {
      toast.error(e?.message || 'Could not start the full-length render.')
    } finally {
      setRendering(false)
    }
  }

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-xs font-medium flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5 text-primary" />
            Use the whole video
          </div>
          <div className="text-2xs text-muted-foreground">
            Keep the full source as one landscape video — letterboxed, full-frame, never cropped.
          </div>
        </div>
        {canEdit && (
          <Button
            size="sm" variant="outline" onClick={handleUseWhole}
            disabled={rendering}
            className="h-7 gap-1.5 text-2xs"
            title="Render this entire source as one keep-whole, landscape long-form package"
          >
            {rendering
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <ArrowRight className="h-3.5 w-3.5" />}
            Use whole video
          </Button>
        )}
      </div>
    </div>
  )
}
