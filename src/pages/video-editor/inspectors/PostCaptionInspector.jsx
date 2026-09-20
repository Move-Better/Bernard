import { InspectorShell } from '../shared'
import PostCaptionField from '@/components/editor/PostCaptionField'
import RegenerateCaptionButton, { canRegenerateCaption } from '@/components/editor/RegenerateCaptionButton'
import { MessageSquareText } from 'lucide-react'

// Post caption — the text that publishes BELOW the video (content_items.content),
// as opposed to the Karaoke inspector's on-screen words burned into the frame.
// The two were indistinguishable before: the reel editor had no post-caption
// field at all, so a reel's caption was frozen at draft time (feedback: "not
// seeing a place to edit the actual caption… it just put the script in the
// caption"). Shares PostCaptionField with UnifiedEditor's WordsPanel so the two
// caption surfaces can't drift. Only rendered when a post exists (ctx.captionPiece).
export function PostCaptionInspector({ ctx }) {
  const { captionPiece, updateItem } = ctx
  if (!captionPiece) return null
  return (
    <InspectorShell icon={MessageSquareText} title="Post caption" right="below the video">
      <p className="mb-2 rounded-md px-2 py-1 text-3xs bg-muted text-muted-foreground">
        The text that publishes below your video — <span className="font-semibold text-foreground">not</span> the on-screen words. Those live under <span className="font-semibold text-foreground">Karaoke</span>.
      </p>
      <div className="flex min-h-0 flex-col gap-2">
        <PostCaptionField
          piece={captionPiece}
          updateItem={updateItem}
          ariaLabel="Post caption"
          placeholder="Caption visible to followers…"
          hint="Saves when you click away."
          minHeightClass="min-h-[200px]"
        />
        {canRegenerateCaption(captionPiece) && (
          <div className="shrink-0 border-t pt-3">
            <RegenerateCaptionButton piece={captionPiece} />
          </div>
        )}
      </div>
    </InspectorShell>
  )
}
