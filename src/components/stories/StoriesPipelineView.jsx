import { Link } from 'react-router-dom'
import { Loader2, Mic } from 'lucide-react'
import { useUser } from '@clerk/react'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/EmptyState'
import PipelineKanban from '@/components/PipelineKanban'
import { useUpdateContentItemStatus } from '@/lib/queries'

/**
 * StoriesPipelineView — wraps PipelineKanban with story-shaped data.
 *
 * PipelineKanban expects flat content_item rows with `topic`, `platform`,
 * `status`, etc. Stories have those fields rolled up under `pieces` (lean
 * summarized shape). We annotate each piece with the parent story's topic
 * so the kanban cards render correctly.
 *
 * Cards can be dragged between the REVIEW lanes (draft / in review / approved)
 * — each drop writes the same audit stamp the story-detail actions do
 * (reviewedBy / approvedBy+approvedAt). Scheduling and publishing are NOT
 * drag targets: those carry Buffer side-effects and stay in the story detail.
 * Clicking a card still navigates to the story.
 */
export default function StoriesPipelineView({ stories, isLoading }) {
  const { user } = useUser()
  const updateStatus = useUpdateContentItemStatus()
  const email = user?.primaryEmailAddress?.emailAddress || user?.id || ''

  const items = (stories ?? []).flatMap((story) =>
    (story.pieces ?? []).map((piece) => ({
      ...piece,
      topic: story.topic,
      staff_name: story.staff_name,
    })),
  )

  // Map a lane move to the status mutation, mirroring AssetsPane's handlers so
  // the audit trail matches a real review action (not a bare status flip).
  const handleMove = ({ id, from, to }) => {
    const payload = { id, status: to }
    if (to === 'approved') {
      payload.approvedBy = email
      payload.approvedAt = new Date().toISOString()
    } else if (to === 'in_review') {
      payload.reviewedBy = email
      if (from === 'approved') { payload.approvedBy = null; payload.approvedAt = null } // unapprove
    } else if (to === 'draft' && from === 'approved') {
      payload.approvedBy = null
      payload.approvedAt = null
    }
    return updateStatus.mutateAsync(payload)
  }

  if (isLoading) {
    return (
      <div role="status" className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading…</span>
      </div>
    )
  }

  if ((stories ?? []).length === 0) {
    return (
      <EmptyState
        icon={<Mic className="h-5 w-5" />}
        title="Pipeline is empty"
        description="The pipeline tracks every draft from capture through to published. Run an interview to put the first card in motion."
        action={
          <Button asChild size="sm">
            <Link to="/new/live-interview">Start an interview</Link>
          </Button>
        }
      />
    )
  }

  return <PipelineKanban items={items} onMove={handleMove} />
}
