import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Loader2, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StaffChip } from '@/components/StaffChip'
import { useStory, useUpdateInterview, useStaff } from '@/lib/queries'
import { useSmartBack } from '@/lib/useSmartBack'
import { toast } from '@/lib/toast'
import TranscriptDrawer from '@/components/story-detail/TranscriptDrawer'

// WordsApproval — the keystone gate, as a real screen (Phase 3 of the
// story-monitor redesign; see .claude/story-monitor-redesign-plan.md).
//
// Approval ① ("is this true to me?") happens here, once per story, judged
// from the words alone — interviews.summary_text, the channel-neutral
// editorial distillation every post is written from. Approval ② ("should
// this specific post go out?") stays in the editor, seeing the finished
// post. Editing the words after approval clears the approval server-side
// (api/_routes/db/interviews.js) — a stale approval must never silently
// cover different text.
//
// No computed voice-fidelity score here — that's a real audit pipeline
// (VoiceFidelityBadge) scoped to individual content_items, not interviews,
// and building an equivalent interview-level scorer is real new work outside
// this phase's scope. Shipping an honest, unscored screen beats faking one.
export default function WordsApproval() {
  const { storyId } = useParams()
  const goBack = useSmartBack(`/stories/${storyId}`)
  const { data: story, isLoading } = useStory(storyId)
  const { data: staff = [] } = useStaff()
  const updateInterview = useUpdateInterview()

  const initial = story?.summary_text || ''
  const [value, setValue] = useState(initial)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const taRef = useRef(null)

  // Re-sync when the saved row changes (initial load, or after our own save/
  // approve round-trips) — same pattern as the editor's ContentEditor.
  useEffect(() => {
    setValue(initial)
  }, [initial])

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 560)}px`
  }, [value])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      </div>
    )
  }

  if (!story) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        Story not found.
      </div>
    )
  }

  const dirty = value !== initial
  const isApproved = !!story.words_approved_at
  const approverStaff = staff.find((s) => s.user_id === story.words_approved_by)
  const approverName = approverStaff?.name || story.words_approved_by
  const saving = updateInterview.isPending

  const handleSave = async () => {
    try {
      await updateInterview.mutateAsync({ id: storyId, patch: { summaryText: value } })
      toast.success('Saved')
    } catch (e) {
      toast.error('Save failed', { description: e.message })
    }
  }

  const handleApprove = async () => {
    try {
      await updateInterview.mutateAsync({
        id: storyId,
        patch: { summaryText: value, approveWords: true },
      })
      toast.success('Words approved', { description: 'Every post below can now be published.' })
    } catch (e) {
      toast.error('Approve failed', { description: e.message })
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-5">
      <button
        type="button"
        onClick={goBack}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to story
      </button>

      <div>
        <p className="text-2xs font-semibold uppercase tracking-wide text-primary">
          Approve the words{story.topic ? ` · ${story.topic}` : ''}
        </p>
        <h1 className="mt-1 text-xl font-bold text-foreground">Does this sound like you?</h1>
        <p className="mt-1.5 max-w-[62ch] text-sm text-muted-foreground">
          This is the story in your own voice. Every post — LinkedIn, Facebook, the blog,
          all of it — is written from these words, so getting this right is the review that
          matters most. Edit anything that isn&rsquo;t how you&rsquo;d say it.
        </p>
      </div>

      {isApproved && (
        <div className="flex items-center gap-2.5 rounded-lg border border-success/30 bg-success/10 p-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <p className="text-sm text-success">
            <span className="font-semibold">Words approved</span>
            {' by '}
            {approverStaff ? <StaffChip name={approverName} id={approverStaff.id} size="sm" showName /> : approverName}
            {' on '}
            {new Date(story.words_approved_at).toLocaleDateString(undefined, {
              month: 'short', day: 'numeric', year: 'numeric',
            })}
          </p>
        </div>
      )}

      {!initial && !dirty ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          The story summary is still generating — check back in a moment.
        </div>
      ) : (
        <>
          <textarea
            ref={taRef}
            aria-label="The story, in your words"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck
            className="w-full min-h-[240px] max-h-[560px] resize-none rounded-lg border bg-card p-4 text-sm leading-relaxed text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />

          <button
            type="button"
            onClick={() => setTranscriptOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            Not sure it&rsquo;s faithful? Compare to what you said
          </button>

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <p className="max-w-[34ch] text-xs text-muted-foreground">
              Approving greenlights this story into posts. You still approve each post
              before it publishes.
            </p>
            <div className="ml-auto flex items-center gap-2">
              {dirty && (
                <Button size="sm" variant="outline" onClick={handleSave} disabled={saving} loading={saving}>
                  Save edits
                </Button>
              )}
              <Button size="sm" onClick={handleApprove} disabled={saving || !value.trim()} loading={saving}>
                {!saving && <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                Approve the words
              </Button>
            </div>
          </div>
        </>
      )}

      <TranscriptDrawer story={story} open={transcriptOpen} onOpenChange={setTranscriptOpen} />
    </div>
  )
}
