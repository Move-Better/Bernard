import { useState } from 'react'
import { Link as LinkIcon, Plus, Trash2, ExternalLink, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useReferences,
  useCreateReference,
  useUpdateReference,
  useDeleteReference,
} from '@/lib/queries'
import { toast } from '@/lib/toast'
import { useConfirm } from '@/lib/useConfirm'

/**
 * ReferencesPanel — attach external article URLs to either a topic_backlog row
 * (pre-interview reading) or an interview (post-interview source list).
 *
 * Display-only by default. `use_as_source` is a per-reference flag staged for
 * a future AI-ingestion path; today it has no runtime effect, but surfacing it
 * in the UI lets users mark intent now so the flag is populated when ingestion
 * lands.
 *
 * Pass exactly one of { topicId, interviewId }.
 */
export default function ReferencesPanel({ topicId, interviewId, compact = false }) {
  const { data: refs = [], isLoading } = useReferences({ topicId, interviewId })
  const createMutation = useCreateReference()
  const updateMutation = useUpdateReference()
  const deleteMutation = useDeleteReference()

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const confirm = useConfirm()

  async function handleAdd(e) {
    e?.preventDefault?.()
    const u = url.trim()
    if (!u) return
    try {
      await createMutation.mutateAsync({
        topicId: topicId || undefined,
        interviewId: interviewId || undefined,
        url: u,
        title: title.trim() || undefined,
      })
      setUrl('')
      setTitle('')
    } catch (err) {
      toast.error(err.message || 'Could not add reference')
    }
  }

  async function handleDelete(ref) {
    if (!(await confirm({ title: `Remove reference "${ref.title || ref.url}"?`, confirmLabel: 'Remove' }))) return
    deleteMutation.mutate(ref.id, {
      onError: (e) => toast.error(e.message || 'Could not delete'),
    })
  }

  function handleToggleSource(ref) {
    updateMutation.mutate(
      { id: ref.id, patch: { useAsSource: !ref.use_as_source } },
      { onError: (e) => toast.error(e.message || 'Could not update') },
    )
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
        <Input
          type="url"
          aria-label="Reference URL"
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="text-sm flex-1"
        />
        <Input
          type="text"
          aria-label="Reference title (optional)"
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-sm sm:max-w-[200px]"
        />
        <Button
          size="sm"
          type="submit"
          disabled={!url.trim() || createMutation.isPending}
        >
          {createMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5 mr-1.5" />
          )}
          Add
        </Button>
      </form>

      {isLoading ? (
        <div role="status" className="flex items-center justify-center py-3">
          <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading…</span>
        </div>
      ) : refs.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-1">
          No references attached yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {refs.map((ref) => (
            <li
              key={ref.id}
              className="flex items-start gap-2 text-sm rounded-md border bg-card px-2.5 py-2"
            >
              <LinkIcon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium hover:underline"
                  title={ref.url}
                >
                  <span className="truncate">{ref.title || ref.url}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                </a>
                {ref.title && (
                  <div className="text-xs text-muted-foreground truncate">{ref.url}</div>
                )}
                {ref.notes && (
                  <div className="text-xs text-muted-foreground mt-0.5">{ref.notes}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleToggleSource(ref)}
                title={
                  ref.use_as_source
                    ? 'Marked to feed as source (AI ingestion not yet active)'
                    : 'Mark to feed as source (AI ingestion not yet active)'
                }
                className={`shrink-0 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border transition-colors ${
                  ref.use_as_source
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-transparent text-muted-foreground hover:bg-muted'
                }`}
              >
                <Sparkles className="h-3 w-3" />
                Source
              </button>
              <button
                type="button"
                onClick={() => handleDelete(ref)}
                className="shrink-0 p-1 text-muted-foreground hover:text-destructive"
                aria-label="Remove reference"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
