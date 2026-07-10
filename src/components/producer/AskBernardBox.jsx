import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { useRequestDraft } from '@/lib/queries'
import { PLATFORM_META } from '@/lib/contentMeta'

// F20 — "ask Bernard to draft something about X" box on /producer. LOCKED scope:
// draft-on-topic only, not a general intent router. Submits { topic, platform } to
// /api/producer/request, which enqueues one agent_inbox row the next agent-tick
// claims and dispatches to draftOnTopic.js. The draft (or an honest "nothing to
// ground this in" escalation) shows up in the workday feed / Needs You strip once
// the tick runs — this box only owns the optimistic "queued" confirmation.

const CHANNELS = ['instagram', 'facebook', 'linkedin', 'gbp']
const TOPIC_MAX_LEN = 300

export default function AskBernardBox() {
  const [topic, setTopic] = useState('')
  const [platform, setPlatform] = useState('instagram')
  const [queuedTopic, setQueuedTopic] = useState(null)
  const requestDraft = useRequestDraft()

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = topic.trim()
    if (!trimmed || requestDraft.isPending) return
    requestDraft.mutate(
      { topic: trimmed, platform },
      {
        onSuccess: () => {
          setQueuedTopic({ topic: trimmed, platform })
          setTopic('')
        },
      },
    )
  }

  return (
    <div className="rounded-xl border border-primary/25 bg-gradient-to-b from-accent/40 to-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-bold">Ask Bernard to draft something</h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Hand him a topic. He&rsquo;ll pull from a real interview and draft it for the channel you choose.
      </p>

      {queuedTopic ? (
        <div className="flex items-center gap-3 rounded-lg border border-primary/25 bg-accent/50 p-3">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p>
              <span className="font-semibold">Queued</span> — Bernard will draft &ldquo;{queuedTopic.topic}&rdquo; for{' '}
              {PLATFORM_META[queuedTopic.platform]?.label || queuedTopic.platform}.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              It&rsquo;ll appear on /week within a few minutes. Nothing publishes without you.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setQueuedTopic(null)}
            className="ml-auto shrink-0 text-xs font-semibold text-primary hover:underline"
          >
            Ask another
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value.slice(0, TOPIC_MAX_LEN))}
            placeholder="e.g. winter running injuries — and why rest isn't the fix"
            rows={2}
            maxLength={TOPIC_MAX_LEN}
            className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              aria-label="Channel"
            >
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>{PLATFORM_META[ch]?.label || ch}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={!topic.trim() || requestDraft.isPending}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {requestDraft.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              {requestDraft.isPending ? 'Queuing…' : 'Draft it'}
            </button>
          </div>
          <p className="mt-2 text-2xs text-muted-foreground">
            Channels: Instagram · Facebook · LinkedIn · Google Business. Counts against Bernard&rsquo;s daily draft cap.
          </p>
        </form>
      )}
    </div>
  )
}

// Exported for reuse/testing.
export { CHANNELS }
