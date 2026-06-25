import { useState, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Loader2, ClipboardList, ImagePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { apiFetch } from '@/lib/api'
import { OUTPUT_CHANNELS } from '@/lib/outputChannels'
import { uploadMedia } from '@/lib/mediaLib'

// Channels that Brief generation supports. Other channels (blog, email,
// youtube, etc.) require richer source material than a brief provides.
const BRIEF_SUPPORTED = new Set([
  'instagram_post', 'instagram_story', 'facebook', 'linkedin',
  'gbp', 'twitter', 'threads',
])

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
  useDocumentTitle('New Brief')
  const navigate  = useNavigate()
  const workspace = useWorkspace()

  // Form state
  const [title,    setTitle]    = useState('')
  const [body,     setBody]     = useState('')
  const [eventAt,  setEventAt]  = useState('')
  const [location, setLocation] = useState('')
  const [ctaUrl,   setCtaUrl]   = useState('')
  const [ctaLabel, setCtaLabel] = useState('')
  const [mediaUrl,     setMediaUrl]     = useState('')
  const [mediaPreview, setMediaPreview] = useState(null)
  const [uploading,    setUploading]    = useState(false)
  const [selected, setSelected] = useState(new Set())
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
      setMediaPreview(URL.createObjectURL(file))
    } catch {
      setError('Photo upload failed — please try again.')
    } finally {
      setUploading(false)
    }
  }

  function removeMedia() {
    setMediaUrl('')
    setMediaPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const canSubmit = title.trim() && body.trim() && selected.size > 0 && !generating && !uploading

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setGenerating(true)
    setError(null)
    try {
      await apiFetch('/api/briefs/generate', {
        method: 'POST',
        body: JSON.stringify({
          title:           title.trim(),
          body:            body.trim(),
          eventAt:         eventAt   || null,
          location:        location  || null,
          ctaUrl:          ctaUrl    || null,
          ctaLabel:        ctaLabel  || null,
          mediaUrl:        mediaUrl  || null,
          selectedOutputs: [...selected],
        }),
      })
      navigate('/stories?source=brief')
    } catch (e_) {
      setError(e_?.message || 'Generation failed — please try again.')
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back" asChild>
          <Link to="/new"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Brief</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Write your message once — Bernard adapts it for each channel.
          </p>
        </div>
      </div>

      {generating ? (
        <GeneratingView channels={[...selected].map((id) => OUTPUT_CHANNELS[id]).filter(Boolean)} />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">

            {/* ── Left: brief form ── */}
            <div className="space-y-5">

              <div className="space-y-1.5">
                <Label htmlFor="brief-title">
                  Title <span className="text-destructive">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">Internal label — not published.</p>
                <Input
                  id="brief-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Summer Wellness Workshop — June 20"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="brief-body">
                  Your message <span className="text-destructive">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  Write your core message in plain language. Bernard adapts tone and length for each channel.
                </p>
                <textarea
                  id="brief-body"
                  className="w-full min-h-[140px] rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 resize-y"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Describe the event, promotion, or update in your own words. Include the key details — who it's for, what happens, when, where, and any cost or registration info."
                  required
                />
              </div>

              {/* Optional structured fields */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                  Optional details
                </p>
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
                      Used as the Instagram Story link sticker
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
                <Label>🖼️ Attach photo <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <p className="text-xs text-muted-foreground">
                  Attached to all channels that support media. Instagram Story uses it instead of a text card.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleMediaFile(e.target.files?.[0])}
                />
                {mediaPreview ? (
                  <div className="relative w-32 h-32 rounded-lg overflow-hidden border border-border">
                    <img src={mediaPreview} alt="" className="w-full h-full object-cover" />
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
                    {uploading ? 'Uploading…' : 'Attach a photo'}
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
                      Bernard generates a separate post for each one.
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
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className="pt-2 border-t border-border space-y-3">
                    {selected.size > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {selected.size} channel{selected.size !== 1 ? 's' : ''} selected
                      </p>
                    )}
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={!canSubmit}
                    >
                      Generate content →
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    ✦ Bernard will use <strong>{workspace?.display_name || 'your workspace'}&apos;s voice</strong> — warm, direct, human — across all channels.
                  </p>
                </CardContent>
              </Card>
            </div>

          </div>
        </form>
      )}
    </div>
  )
}

function GeneratingView({ channels }) {
  return (
    <div className="max-w-md mx-auto py-12 space-y-6">
      <div className="text-center space-y-2">
        <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
          <ClipboardList className="h-6 w-6" />
        </div>
        <h2 className="text-xl font-semibold">Generating your posts</h2>
        <p className="text-sm text-muted-foreground">
          Bernard is adapting your brief for each channel. This takes about 15 seconds.
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
