import { useState, useMemo, useRef } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useSmartBack } from '@/lib/useSmartBack'
import { ArrowLeft, Loader2, ClipboardList, ImagePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { apiFetch } from '@/lib/api'
import { OUTPUT_CHANNELS } from '@/lib/outputChannels'
import { CAPTION_LIMITS } from '@/lib/contentMeta'
import { uploadMedia } from '@/lib/mediaLib'
import { useUser } from '@clerk/react'
import { publishPieceToBuffer } from '@/lib/publishPiece'
import { updateContentItem } from '@/lib/publish'
import { toast } from '@/lib/toast'

// Channels that Brief generation supports. Other channels (blog, email,
// youtube, etc.) require richer source material than a brief provides.
const BRIEF_SUPPORTED = new Set([
  'instagram_post', 'instagram_story', 'facebook', 'linkedin',
  'gbp', 'twitter', 'threads',
])

// Per-channel hard caption caps (only channels that realistically hit one).
// instagram_post/reel map to the 'instagram' cap; others match 1:1. Used for
// the live character counts shown in "post as written" mode.
const IG_OUTPUTS = new Set(['instagram_post', 'instagram_reel'])
function limitForOutput(id) {
  const key = IG_OUTPUTS.has(id) ? 'instagram' : id
  return CAPTION_LIMITS[key] ?? null
}

// Group channels for the picker UI.
const CHANNEL_GROUPS = [
  {
    label: 'Social',
    ids: ['instagram_post', 'instagram_story', 'facebook', 'linkedin', 'twitter', 'threads'],
  },
  {
    label: 'Local',
    ids: ['gbp'],
  },
]

// Emoji decoration per channel for the picker.
const CHANNEL_ICON = {
  instagram_post:  '📸',
  instagram_story: '◻️',
  facebook:        '🔵',
  linkedin:        '💼',
  twitter:         '𝕏',
  threads:         '🧵',
  gbp:             '🗺️',
}

export default function NewBrief() {
  useDocumentTitle('New Post')
  const navigate  = useNavigate()
  const goBack = useSmartBack('/new')
  const workspace = useWorkspace()
  const { user } = useUser()
  const [searchParams] = useSearchParams()

  // Form state. `?topic=` seeds the internal title — used by the SEO
  // Opportunities feed's "Draft content" action (and any other deep link).
  const [title,    setTitle]    = useState(() => searchParams.get('topic') || '')
  const [body,     setBody]     = useState('')
  const [eventAt,  setEventAt]  = useState('')
  const [location, setLocation] = useState('')
  const [ctaUrl,   setCtaUrl]   = useState('')
  const [ctaLabel, setCtaLabel] = useState('')
  const [mediaUrl,     setMediaUrl]     = useState('')
  const [mediaPreview, setMediaPreview] = useState(null)
  const [mediaType,    setMediaType]    = useState('photo') // 'photo' | 'video'
  const [uploading,    setUploading]    = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [mode, setMode] = useState('as_written') // 'as_written' | 'adapt'
  const [scheduledAt, setScheduledAt] = useState('')
  const [showSchedule, setShowSchedule] = useState(false)
  const fileInputRef = useRef(null)

  // Submission state
  const [generating, setGenerating] = useState(false)
  const [error,      setError]      = useState(null)

  // Channels this workspace has enabled, filtered to Brief-supported ones.
  const availableChannels = useMemo(() => {
    const enabled = new Set(workspace?.enabled_outputs || [])
    return Object.values(OUTPUT_CHANNELS).filter(
      (ch) => enabled.has(ch.id) && BRIEF_SUPPORTED.has(ch.id)
    )
  }, [workspace])

  function toggleChannel(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleMediaFile(file) {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const result = await uploadMedia(file, { assetPurpose: 'broll' })
      setMediaUrl(result.url)
      setMediaType(file.type.startsWith('video/') ? 'video' : 'photo')
      setMediaPreview(URL.createObjectURL(file))
    } catch {
      setError('Upload failed — please try again.')
    } finally {
      setUploading(false)
    }
  }

  function removeMedia() {
    setMediaUrl('')
    setMediaPreview(null)
    setMediaType('photo')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const bodyLen = body.trim().length
  const userEmail = user?.primaryEmailAddress?.emailAddress || user?.id || ''
  // As-written channels whose verbatim text exceeds the platform's hard cap —
  // blocks Post now / Schedule (no silent truncation); Save as draft still works.
  const anyOverLimit = mode === 'as_written' && [...selected].some((id) => {
    const lim = limitForOutput(id)
    return lim && bodyLen > lim
  })
  const canSubmit = body.trim() && selected.size > 0 && !generating && !uploading

  // action: 'post_now' | 'schedule' | 'draft'. Adapt mode always yields drafts.
  async function runSubmit(action) {
    if (!canSubmit) return
    const effective = mode === 'adapt' ? 'draft' : action
    setGenerating(true)
    setError(null)
    try {
      const resp = await apiFetch('/api/briefs/generate', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          title:           title.trim(),
          body:            body.trim(),
          eventAt:         eventAt   || null,
          location:        location  || null,
          ctaUrl:          ctaUrl    || null,
          ctaLabel:        ctaLabel  || null,
          mediaUrl:        mediaUrl  || null,
          mediaType:       mediaType,
          selectedOutputs: [...selected],
        }),
      })

      const items = resp?.contentItems || []
      if (effective === 'draft' || items.length === 0) {
        navigate('/stories?tab=posts')
        return
      }

      // Post now / schedule: dispatch each created row through the canonical
      // social publish path (the same helper the Review Inbox bulk scheduler
      // uses), so this can never diverge from the rest of the app.
      const scheduledISO = effective === 'schedule' && scheduledAt
        ? new Date(scheduledAt).toISOString()
        : null
      const results = await Promise.allSettled(
        items.map(async (it) => {
          const r = await publishPieceToBuffer(it, {
            scheduledAt: scheduledISO, useQueue: false, userEmail, workspace, themes: [],
          })
          // publishAndTrack sets status but persists scheduled_at only in queue
          // mode; for a specific slot, write it (+ approver) ourselves.
          if (scheduledISO) {
            await updateContentItem(it.id, { scheduledAt: scheduledISO, approvedBy: userEmail })
          }
          return r
        }),
      )
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.length - ok
      if (failed === 0) {
        toast.success(scheduledISO
          ? `Scheduled ${ok} post${ok !== 1 ? 's' : ''}`
          : `Posted ${ok} post${ok !== 1 ? 's' : ''}`)
      } else {
        toast.warning(`${ok} sent, ${failed} failed`, {
          description: 'Anything that failed is saved as a draft in Stories.',
        })
      }
      navigate('/stories?tab=posts')
    } catch (e_) {
      setError(e_?.message || 'Something went wrong — please try again.')
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={goBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Post</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            One post → the channels you pick. Your exact words, or let Bernard adapt each one.
          </p>
        </div>
      </div>

      {generating ? (
        <GeneratingView mode={mode} channels={[...selected].map((id) => OUTPUT_CHANNELS[id]).filter(Boolean)} />
      ) : (
        <form onSubmit={(e) => e.preventDefault()}>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">

            {/* ── Left: brief form ── */}
            <div className="space-y-5">

              <div className="space-y-1.5">
                <Label htmlFor="brief-title">
                  Title <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <p className="text-xs text-muted-foreground">Internal label — not published. Leave blank and we&apos;ll name it from your post.</p>
                <Input
                  id="brief-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Thanksgiving hours"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="brief-body">
                  Your post <span className="text-destructive">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  {mode === 'as_written'
                    ? 'Type it exactly how you want it — this is what publishes.'
                    : 'Write your core message in plain language. Bernard adapts tone and length for each channel.'}
                </p>
                <textarea
                  id="brief-body"
                  className="w-full min-h-[140px] rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 resize-y"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your post — an announcement, promotion, or quick update in your own words."
                  required
                />
              </div>

              {/* Post mode — manual (as written) vs Bernard adapt per channel */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  How should it post?
                </p>
                <div className="inline-flex w-full rounded-lg border border-border bg-muted p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setMode('as_written')}
                    aria-pressed={mode === 'as_written'}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${mode === 'as_written' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Post as written
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('adapt')}
                    aria-pressed={mode === 'adapt'}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${mode === 'adapt' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Adapt per channel
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {mode === 'as_written'
                    ? 'Your exact words go to every selected channel, unchanged.'
                    : 'Bernard rewrites your message to fit each channel — in your workspace voice.'}
                </p>
              </div>

              {/* Optional structured fields */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                  Optional details
                </p>
                {mode === 'as_written' && (
                  <p className="text-xs text-muted-foreground mb-3 -mt-1">
                    Used when Bernard adapts — your written text posts exactly as-is.
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="brief-event-at">📅 Event date &amp; time</Label>
                    <Input
                      id="brief-event-at"
                      type="datetime-local"
                      value={eventAt}
                      onChange={(e) => setEventAt(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="brief-location">📍 Location</Label>
                    <Input
                      id="brief-location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Address or venue name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="brief-cta-url">🔗 CTA URL</Label>
                    <Input
                      id="brief-cta-url"
                      type="url"
                      value={ctaUrl}
                      onChange={(e) => setCtaUrl(e.target.value)}
                      placeholder="https://…"
                    />
                    <p className="text-xs text-muted-foreground">
                      Woven into captions as the call-to-action link (not supported as an Instagram Story sticker link — Meta/bundle.social do not expose that)
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="brief-cta-label">🏷️ CTA label</Label>
                    <Input
                      id="brief-cta-label"
                      value={ctaLabel}
                      onChange={(e) => setCtaLabel(e.target.value)}
                      placeholder="e.g. Reserve your spot"
                    />
                  </div>
                </div>
              </div>

              {/* Media attach */}
              <div className="space-y-1.5">
                <Label>🖼️ Attach photo or video <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <p className="text-xs text-muted-foreground">
                  Attached to all channels that support media. Instagram Story uses it instead of a text card.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => handleMediaFile(e.target.files?.[0])}
                />
                {mediaPreview ? (
                  <div className="relative w-32 h-32 rounded-lg overflow-hidden border border-border">
                    {mediaType === 'video' ? (
                      <video src={mediaPreview} className="w-full h-full object-cover" muted playsInline />
                    ) : (
                      <img src={mediaPreview} alt="" className="w-full h-full object-cover" />
                    )}
                    <button
                      type="button"
                      onClick={removeMedia}
                      aria-label="Remove attached media"
                      className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 text-sm text-muted-foreground transition-colors disabled:opacity-50"
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    {uploading ? 'Uploading…' : 'Attach photo or video'}
                  </button>
                )}
              </div>

              {error && (
                <p className="text-sm text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                  {error}
                </p>
              )}
            </div>

            {/* ── Right: channel picker ── */}
            <div className="lg:sticky lg:top-20">
              <Card>
                <CardContent className="p-5 space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                      Channels
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {mode === 'as_written'
                        ? 'Your post goes to each one you pick.'
                        : 'Bernard generates a separate post for each one.'}
                    </p>
                  </div>

                  {availableChannels.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No compatible channels enabled.{' '}
                      <Link to="/settings/channels" className="underline text-primary">
                        Enable channels →
                      </Link>
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {CHANNEL_GROUPS.map((group) => {
                        const groupChannels = group.ids
                          .map((id) => availableChannels.find((ch) => ch.id === id))
                          .filter(Boolean)
                        if (!groupChannels.length) return null
                        return (
                          <div key={group.label}>
                            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                              {group.label}
                            </p>
                            <div className="space-y-1">
                              {groupChannels.map((ch) => {
                                const isSelected = selected.has(ch.id)
                                return (
                                  <label
                                    key={ch.id}
                                    className="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-muted transition-colors"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleChannel(ch.id)}
                                      className="h-4 w-4 accent-primary"
                                    />
                                    <span className="text-sm">
                                      {CHANNEL_ICON[ch.id] || '📄'} {ch.label}
                                    </span>
                                    {mode === 'as_written' && isSelected && limitForOutput(ch.id) && (
                                      <span className={`ml-auto text-2xs tabular-nums rounded px-1.5 py-0.5 ${bodyLen > limitForOutput(ch.id) ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'}`}>
                                        {bodyLen > limitForOutput(ch.id) ? `over ${bodyLen - limitForOutput(ch.id)}` : `${bodyLen}/${limitForOutput(ch.id)}`}
                                      </span>
                                    )}
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className="pt-2 border-t border-border space-y-2.5">
                    {selected.size > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {selected.size} channel{selected.size !== 1 ? 's' : ''} selected
                      </p>
                    )}
                    {anyOverLimit && (
                      <p className="text-xs text-warning">
                        A selected channel is over its character limit. Shorten your post, or Save as draft to fix it later.
                      </p>
                    )}

                    {mode === 'as_written' ? (
                      <>
                        <Button
                          type="button"
                          className="w-full"
                          disabled={!canSubmit || anyOverLimit}
                          onClick={() => runSubmit('post_now')}
                        >
                          Post now →
                        </Button>

                        {showSchedule ? (
                          <div className="flex gap-2">
                            <Input
                              type="datetime-local"
                              value={scheduledAt}
                              onChange={(e) => setScheduledAt(e.target.value)}
                              className="text-sm"
                              aria-label="Schedule date and time"
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={!canSubmit || anyOverLimit || !scheduledAt}
                              onClick={() => runSubmit('schedule')}
                            >
                              Set
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            disabled={!canSubmit}
                            onClick={() => setShowSchedule(true)}
                          >
                            Schedule for later
                          </Button>
                        )}

                        <Button
                          type="button"
                          variant="ghost"
                          className="w-full"
                          disabled={!canSubmit}
                          onClick={() => runSubmit('draft')}
                        >
                          Save as draft
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        className="w-full"
                        disabled={!canSubmit}
                        onClick={() => runSubmit('draft')}
                      >
                        Generate drafts →
                      </Button>
                    )}
                  </div>

                  {mode === 'adapt' && (
                    <p className="text-xs text-muted-foreground">
                      ✦ Bernard will use <strong>{workspace?.display_name || 'your workspace'}&apos;s voice</strong> — warm, direct, human — across all channels.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

          </div>
        </form>
      )}
    </div>
  )
}

function GeneratingView({ channels, mode }) {
  const asWritten = mode === 'as_written'
  return (
    <div className="max-w-md mx-auto py-12 space-y-6">
      <div className="text-center space-y-2">
        <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
          <ClipboardList className="h-6 w-6" />
        </div>
        <h2 className="text-xl font-semibold">{asWritten ? 'Creating your posts' : 'Generating your posts'}</h2>
        <p className="text-sm text-muted-foreground">
          {asWritten
            ? 'Adding your post to each channel — just a moment.'
            : 'Bernard is adapting your post for each channel. This takes about 15 seconds.'}
        </p>
      </div>

      <Card>
        <CardContent role="status" className="p-5 divide-y divide-border">
          {channels.map((ch) => (
            <div key={ch.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" aria-hidden="true" />
              <span className="text-sm">
                {CHANNEL_ICON[ch.id] || '📄'} {ch.label}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Posts will land in Stories as drafts — review, edit, then approve or schedule.
      </p>
    </div>
  )
}
