import { useState, useEffect } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '@clerk/react'
import {
  Loader2, FileText, Mail, MapPin, Instagram, Facebook, Linkedin,
  Youtube, Twitter, Music2, MessageCircle, Cloud, Megaphone,
  LayoutTemplate, Radio, Film, Puzzle,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useUserRole } from '@/lib/useUserRole'
import { usePermission } from '@/lib/usePermission'
import { CAP_SETTINGS_EDIT } from '@/lib/capabilities'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { OUTPUT_CHANNELS, EXPORT_SHAPES } from '@/lib/outputChannels'
import { SaveBar } from '@/components/settings/helpers'
import { apiFetch } from '@/lib/api'

// Icon per channel id. Falls back to Radio for any new channel we forget to map.
const CHANNEL_ICONS = {
  blog:           FileText,
  email:          Mail,
  gbp:            MapPin,
  instagram_post: Instagram,
  instagram_reel: Film,
  facebook:       Facebook,
  linkedin:       Linkedin,
  tiktok:         Music2,
  youtube_short:  Youtube,
  youtube:        Youtube,
  twitter:        Twitter,
  threads:        MessageCircle,
  bluesky:        Cloud,
  mastodon:       MessageCircle,
  google_ads:     Megaphone,
  ig_ads:         Megaphone,
  landing_page:   LayoutTemplate,
}

// Friendlier labels for export-shape / publish-mode badges.
const SHAPE_LABEL = {
  [EXPORT_SHAPES.MARKDOWN]:        'Markdown export',
  [EXPORT_SHAPES.SOCIAL_COMPOSE]:  'Caption + image',
  [EXPORT_SHAPES.HTML_EMAIL]:      'HTML email',
}
// Channels are grouped for visual scanning; order within each group is
// preserved from OUTPUT_CHANNELS.
const GROUPS = [
  { id: 'long',   label: 'Long-form', members: ['blog', 'email'] },
  { id: 'local',  label: 'Local',     members: ['gbp'] },
  { id: 'social', label: 'Social',    members: ['instagram_post', 'instagram_story', 'facebook', 'linkedin', 'twitter', 'threads', 'bluesky', 'mastodon'] },
  { id: 'video',  label: 'Video',     members: ['instagram_reel', 'tiktok', 'youtube_short', 'youtube'] },
  { id: 'paid',   label: 'Paid',      members: ['google_ads', 'ig_ads'] },
  { id: 'web',    label: 'Web',       members: ['landing_page'] },
]

// --- Posting cadence + publish intent ---

// Label/icon registry keyed by ATOM PLATFORM (the real capacity buckets the
// Strategist allocates against), in display order. Instagram feed + reels share
// the single `instagram` bucket; Story is its own. The rows actually shown are
// derived from the workspace's enabled_outputs (see deriveCadenceRows) so the
// list always matches what the tenant enabled.
const CADENCE_PLATFORM_META = [
  { id: 'instagram',       label: 'Instagram (feed + reels)', Icon: Instagram },
  { id: 'instagram_story', label: 'Instagram Story',          Icon: Instagram },
  { id: 'linkedin',        label: 'LinkedIn',                 Icon: Linkedin },
  { id: 'gbp',             label: 'Google Business',          Icon: MapPin },
  { id: 'facebook',        label: 'Facebook',                 Icon: Facebook },
  { id: 'tiktok',          label: 'TikTok',                   Icon: Music2 },
  { id: 'twitter',         label: 'Twitter / X',              Icon: Twitter },
  { id: 'threads',         label: 'Threads',                  Icon: MessageCircle },
  { id: 'bluesky',         label: 'Bluesky',                  Icon: Cloud },
  { id: 'mastodon',        label: 'Mastodon',                 Icon: MessageCircle },
]

// enabled_outputs (registry ids) → atom-platform set. MUST stay in sync with
// atomPlatformsFromEnabledOutputs in api/_lib/atomPlan.js: instagram_post and
// instagram_reel share the `instagram` bucket; instagram_story is standalone.
function atomPlatformsOf(enabledOutputs) {
  const set = new Set()
  for (const id of enabledOutputs || []) {
    if (id === 'instagram_post' || id === 'instagram_reel') set.add('instagram')
    else if (id === 'instagram_story') set.add('instagram_story')
    else set.add(id)
  }
  return set
}

// Client-side safety net for the cold-start prior — only used if the server
// didn't send cadence_defaults (app_config.cadence_defaults, migration 142).
// The server value is the source of truth; this mirrors the migration seed.
const FALLBACK_CADENCE_PRIOR = {
  instagram: 4, instagram_story: 5, linkedin: 3, facebook: 3,
  gbp: 2, tiktok: 3, twitter: 4, threads: 4, bluesky: 3, mastodon: 3,
}

// PURE: compute Auto cadence channels from enabled_outputs × prior. Mirrors
// computeAutoCadenceChannels in api/_lib/cadenceDefaults.js.
function computeAutoChannels(enabledOutputs, prior) {
  const out = {}
  for (const p of atomPlatformsOf(enabledOutputs)) {
    if (prior?.[p] == null) continue
    out[p] = { target_per_week: prior[p], enabled: true }
  }
  return out
}

const WEEK_DAYS = [
  { id: 'sun', label: 'Su' }, { id: 'mon', label: 'Mo' },
  { id: 'tue', label: 'Tu' }, { id: 'wed', label: 'We' },
  { id: 'thu', label: 'Th' }, { id: 'fri', label: 'Fr' },
  { id: 'sat', label: 'Sa' },
]

const TIMEZONE_OPTIONS = [
  { value: 'America/Los_Angeles', label: 'Pacific (LA / Vancouver)' },
  { value: 'America/Denver',      label: 'Mountain (Denver / Calgary)' },
  { value: 'America/Chicago',     label: 'Central (Chicago / Winnipeg)' },
  { value: 'America/New_York',    label: 'Eastern (New York / Toronto)' },
  { value: 'America/Phoenix',     label: 'Mountain no-DST (Phoenix)' },
  { value: 'America/Anchorage',   label: 'Alaska' },
  { value: 'Pacific/Honolulu',    label: 'Hawaii' },
]

// Auto by default; channels are COMPUTED from enabled_outputs × the prior, so
// the static map is empty here (no hardcoded trio).
const DEFAULT_CADENCE_POLICY = {
  version: 1, provenance: 'bernard', trust_stage: 'approve_all',
  quiet_days: ['sat', 'sun'],
  channels: {},
  digests: [], goals: [],
}

const DEFAULT_PUBLISH_INTENT = { website: 'none', social: 'bundle', newsletter: 'other' }

const BLOG_OPTIONS = [
  { value: 'wordpress', label: 'WordPress',      desc: 'Direct publish via WP REST API' },
  { value: 'astro',     label: 'Astro / static', desc: 'Markdown export to your repo' },
  { value: 'none',      label: 'No blog',        desc: 'Skip blog output entirely' },
]
const SOCIAL_OPTIONS = [
  { value: 'bundle', label: 'bundle.social',  desc: 'Bernard connects — no extra tool' },
  { value: 'buffer', label: 'Buffer',          desc: 'Bring your existing Buffer account' },
  { value: 'manual', label: 'Copy & paste',   desc: 'Export captions, post manually' },
]
const NEWSLETTER_OPTIONS = [
  { value: 'beehiiv', label: 'beehiiv',           desc: 'Direct publish to beehiiv' },
  { value: 'other',   label: 'Other',             desc: 'Mailchimp, ConvertKit, HTML export' },
  { value: 'skip',    label: 'No newsletter',     desc: 'Hides the email channel' },
]

function CadenceCard({ cadence, onChange, enabledOutputs, prior }) {
  const isAuto = (cadence?.provenance ?? 'bernard') !== 'user'
  const channels = cadence?.channels || {}
  const quietDays = Array.isArray(cadence?.quiet_days) ? cadence.quiet_days : ['sat', 'sun']
  const timezone = cadence?.timezone || 'America/Los_Angeles'

  // Rows = the cadence-bearing atom platforms the workspace has enabled, in
  // registry order. In Auto, values are COMPUTED from the prior (read-only). In
  // Manual, values come from the stored policy (seeded from the prior).
  const enabledPlatforms = atomPlatformsOf(enabledOutputs)
  const rows = CADENCE_PLATFORM_META.filter(m => enabledPlatforms.has(m.id))

  function setChannel(platform, patch) {
    onChange({
      ...(cadence || DEFAULT_CADENCE_POLICY),
      provenance: 'user',
      channels: {
        ...channels,
        [platform]: { ...(channels[platform] || { target_per_week: prior?.[platform] ?? 0, enabled: true }), ...patch },
      },
    })
  }

  function toggleAuto() {
    if (isAuto) {
      // → Manual: seed editable targets from the current computed Auto values so
      // the operator starts from the recommendation, not zeros.
      const seeded = Object.keys(channels).length ? channels : computeAutoChannels(enabledOutputs, prior)
      onChange({ ...(cadence || DEFAULT_CADENCE_POLICY), provenance: 'user', channels: seeded })
    } else {
      onChange({ ...(cadence || DEFAULT_CADENCE_POLICY), provenance: 'bernard' })
    }
  }

  function toggleQuietDay(day) {
    const next = quietDays.includes(day)
      ? quietDays.filter(d => d !== day)
      : [...quietDays, day]
    onChange({ ...(cadence || DEFAULT_CADENCE_POLICY), quiet_days: next, provenance: 'user' })
  }

  return (
    <Card className="rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold">Posting cadence</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Target posts per week per channel. The weekly plan uses these as capacity ceilings.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">{isAuto ? 'Auto' : 'Manual'}</span>
            <button
              type="button"
              role="switch"
              aria-checked={isAuto}
              aria-label="Let Bernard manage cadence automatically"
              onClick={toggleAuto}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isAuto ? 'border-primary bg-primary' : 'border-input bg-input'
              }`}
            >
              <span className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                isAuto ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>
        </div>
        {isAuto && (
          <p className="text-xs text-muted-foreground pt-1">
            Bernard manages cadence automatically. Turn off to edit targets.
          </p>
        )}
      </CardHeader>

      <CardContent className={`space-y-5 pt-0 ${isAuto ? 'pointer-events-none opacity-60' : ''}`}>
        {isAuto && (
          <p className="text-2xs text-muted-foreground px-1">Computed from your enabled channels — turn off Auto to edit</p>
        )}
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1 py-2">
            No social channels enabled yet. Turn on channels above and Bernard will set a cadence for each.
          </p>
        ) : (
        <div className="rounded-lg border border-border divide-y divide-border">
          {rows.map(({ id, label: platformLabel, Icon }) => {
            // Auto: computed from the prior, always enabled. Manual: stored value
            // (seeded from the prior when the operator first switches to Manual).
            const ch = isAuto
              ? { target_per_week: prior?.[id] ?? 0, enabled: true }
              : (channels[id] || { target_per_week: prior?.[id] ?? 0, enabled: true })
            return (
              <div key={id} className="flex items-center gap-3 px-3 py-2.5">
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm flex-1 truncate">{platformLabel}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-2xs text-muted-foreground hidden sm:block">posts/wk</span>
                  <input
                    type="number"
                    min={0}
                    max={14}
                    value={ch.target_per_week}
                    disabled={!ch.enabled || isAuto}
                    readOnly={isAuto}
                    onChange={e => !isAuto && setChannel(id, { target_per_week: Math.max(0, Math.min(14, parseInt(e.target.value, 10) || 0)) })}
                    className="w-12 text-center text-sm border border-input rounded-md px-1 py-0.5 bg-background disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    role="switch"
                    aria-checked={ch.enabled}
                    aria-label={`Enable ${platformLabel}`}
                    onClick={() => !isAuto && setChannel(id, { enabled: !ch.enabled })}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      ch.enabled ? 'border-primary bg-primary' : 'border-input bg-input'
                    } ${isAuto ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    <span className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-md ring-0 transition-transform ${
                      ch.enabled ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Quiet days — no posts scheduled</p>
          <div className="flex gap-1.5 flex-wrap">
            {WEEK_DAYS.map(({ id: dayId, label: dayLabel }) => {
              const isPosting = !quietDays.includes(dayId)
              return (
                <button
                  key={dayId}
                  type="button"
                  onClick={() => !isAuto && toggleQuietDay(dayId)}
                  className={`w-9 h-9 rounded-full text-2xs font-semibold border transition-colors ${
                    isPosting
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-border'
                  } ${isAuto ? 'cursor-default' : ''}`}
                >
                  {dayLabel}
                </button>
              )
            })}
          </div>
          <p className="text-2xs text-muted-foreground">Filled = posting day · Grey = quiet</p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Timezone for scheduling</p>
          <select
            value={timezone}
            disabled={isAuto}
            onChange={e => onChange({ ...(cadence || DEFAULT_CADENCE_POLICY), timezone: e.target.value, provenance: 'user' })}
            className="w-full max-w-xs text-sm border border-input rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
          >
            {TIMEZONE_OPTIONS.map(tz => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>
      </CardContent>
    </Card>
  )
}

function PublishIntentCard({ intent, onChange }) {
  const blog       = intent?.website    || 'none'
  const social     = intent?.social     || 'bundle'
  const newsletter = intent?.newsletter || 'other'

  function setField(key, value) {
    onChange({ ...intent, [key]: value })
  }

  return (
    <Card className="rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">How you publish</CardTitle>
        <CardDescription className="text-xs">
          Set at onboarding — update here if your setup changes. Affects which integrations are highlighted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Blog</p>
          <div className="space-y-1.5">
            {BLOG_OPTIONS.map(opt => (
              <button key={opt.value} type="button" onClick={() => setField('website', opt.value)}
                className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                  blog === opt.value ? 'border-primary/40 bg-primary/10' : 'border-border hover:bg-accent/30'
                }`}
              >
                <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors ${
                  blog === opt.value ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                }`} />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-2xs text-muted-foreground mt-0.5">{opt.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Social</p>
          <div className="space-y-1.5">
            {SOCIAL_OPTIONS.map(opt => (
              <button key={opt.value} type="button" onClick={() => setField('social', opt.value)}
                className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                  social === opt.value ? 'border-primary/40 bg-primary/10' : 'border-border hover:bg-accent/30'
                }`}
              >
                <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors ${
                  social === opt.value ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                }`} />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-2xs text-muted-foreground mt-0.5">{opt.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Newsletter</p>
          <div className="space-y-1.5">
            {NEWSLETTER_OPTIONS.map(opt => (
              <button key={opt.value} type="button" onClick={() => setField('newsletter', opt.value)}
                className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                  newsletter === opt.value ? 'border-primary/40 bg-primary/10' : 'border-border hover:bg-accent/30'
                }`}
              >
                <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors ${
                  newsletter === opt.value ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                }`} />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-2xs text-muted-foreground mt-0.5">{opt.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function groupedChannels() {
  const all = Object.values(OUTPUT_CHANNELS)
  const assigned = new Set(GROUPS.flatMap((g) => g.members))
  const grouped = GROUPS.map((g) => ({
    label: g.label,
    channels: g.members.map((id) => all.find((c) => c.id === id)).filter(Boolean),
  })).filter((g) => g.channels.length > 0)
  const leftovers = all.filter((c) => !assigned.has(c.id))
  if (leftovers.length > 0) grouped.push({ label: 'Other', channels: leftovers })
  return grouped
}

export default function ChannelsSettings() {
  useDocumentTitle('Settings — Presence')
  const { getToken } = useAuth()
  const { role, isLoading: roleLoading } = useUserRole()
  const { has } = usePermission()
  const [ws, setWs]           = useState(undefined)
  const [form, setForm]       = useState(null)
  const [pristine, setPristine] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    // Authenticated load: apiFetch attaches the Clerk bearer token so the
    // server returns the FULL workspace row. A tokenless fetch gets the slim
    // public-branding shape (me.js), which omits enabled_outputs — that made
    // saved channels reappear unchecked on every reload. See WorkspaceContext.
    apiFetch('/api/workspace/me')
      .then(data => {
        setWs(data)
        if (data) {
          const initial = {
            enabled_outputs: Array.isArray(data.enabled_outputs) ? data.enabled_outputs : [],
            cadence_policy:  data.cadence_policy  || DEFAULT_CADENCE_POLICY,
            publish_intent:  data.publish_intent  || DEFAULT_PUBLISH_INTENT,
          }
          setForm(initial)
          setPristine(initial)
        }
      })
      .catch(() => setWs(null))
  }, [])

  const isDirty = !!form && !!pristine && JSON.stringify(form) !== JSON.stringify(pristine)
  useUnsavedChanges(isDirty)
  useSaveShortcut(() => { if (isDirty && !saving) handleSave() }, { disabled: !isDirty || saving })

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const token = await getToken()
      // When Auto, materialize the computed channels into the stored policy so
      // every consumer that reads cadence_policy.channels (week summary, Your
      // Week) sees the same values the Strategist computes live. Manual keeps
      // the operator's edits verbatim.
      const prior = ws?.cadence_defaults || FALLBACK_CADENCE_PRIOR
      const policy = form.cadence_policy || DEFAULT_CADENCE_POLICY
      const isAutoPolicy = (policy.provenance ?? 'bernard') !== 'user'
      const cadenceToSave = isAutoPolicy
        ? { ...policy, channels: computeAutoChannels(form.enabled_outputs, prior) }
        : policy
      const r = await fetch('/api/workspace/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          enabled_outputs: form.enabled_outputs,
          cadence_policy:  cadenceToSave,
          publish_intent:  form.publish_intent,
        }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setError(err.error || 'save-failed')
      } else {
        const updated = await r.json()
        const refreshed = {
          enabled_outputs: Array.isArray(updated.enabled_outputs) ? updated.enabled_outputs : [],
          cadence_policy:  updated.cadence_policy  || DEFAULT_CADENCE_POLICY,
          publish_intent:  updated.publish_intent  || DEFAULT_PUBLISH_INTENT,
        }
        setForm(refreshed); setPristine(refreshed)
        setSaved(true); setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  function setCadence(cadence) {
    setForm(f => ({ ...f, cadence_policy: cadence }))
  }
  function setPublishIntent(intent) {
    setForm(f => ({ ...f, publish_intent: intent }))
  }

  function toggle(channelId, on) {
    setForm((f) => {
      const cur = Array.isArray(f.enabled_outputs) ? f.enabled_outputs : []
      const next = on
        ? (cur.includes(channelId) ? cur : [...cur, channelId])
        : cur.filter((id) => id !== channelId)
      return { ...f, enabled_outputs: next }
    })
  }

  if (roleLoading || ws === undefined) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  // Phase 4 PR 2: capability gate. Producer (no CAP_SETTINGS_EDIT) is bounced.
  if (role !== 'admin' || !has(CAP_SETTINGS_EDIT)) return <Navigate to="/" replace />
  if (!ws) return (
    <div className="py-16 text-center text-sm text-muted-foreground">
      Workspace settings are only available on a <code className="font-mono text-xs">*.withbernard.ai</code> deployment.
    </div>
  )

  const enabled = new Set(form.enabled_outputs)
  const groups = groupedChannels()

  return (
    <div className="space-y-6 pb-16">
      {/* Sticky header / save bar */}
      <div className="md:sticky md:top-0 z-20 py-4 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b border-border/60 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center">
            <span
              className="inline-block w-1 h-6 rounded-full shrink-0 mr-2.5"
              style={{ background: 'hsl(var(--primary))' }}
              aria-hidden="true"
            />
            Presence
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Toggle the channels this workspace generates content for. Each interview lets the author pick a subset.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-1">
          {saved && <span className="text-xs text-success">Saved</span>}
          {error && <span className="text-xs text-destructive">{error}</span>}
          <Button size="sm" onClick={handleSave} disabled={saving || !isDirty}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Save changes
          </Button>
        </div>
      </div>

      {groups.map((group) => (
        <Card key={group.label} className="rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-1 h-5 rounded-full shrink-0"
                style={{ background: 'hsl(var(--primary))' }}
                aria-hidden="true"
              />
              <CardTitle className="text-lg font-bold">{group.label}</CardTitle>
            </div>
            <CardDescription className="text-xs">
              {group.channels.length} channel{group.channels.length === 1 ? '' : 's'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {group.channels.map((channel) => (
                <ChannelTile
                  key={channel.id}
                  channel={channel}
                  checked={enabled.has(channel.id)}
                  onToggle={(on) => toggle(channel.id, on)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <CadenceCard
        cadence={form.cadence_policy}
        onChange={setCadence}
        enabledOutputs={form.enabled_outputs}
        prior={ws?.cadence_defaults || FALLBACK_CADENCE_PRIOR}
      />
      <PublishIntentCard intent={form.publish_intent} onChange={setPublishIntent} />

      <Card className="shadow-none bg-muted/40">
        <CardContent className="flex items-start gap-3 py-4">
          <Puzzle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Publishing connections (your social scheduler, website, or newsletter) are managed on the{' '}
            <Link to="/settings/integrations" className="underline underline-offset-2 hover:text-foreground">
              Integrations
            </Link>
            {' '}page. Channels marked <span className="font-medium">via Buffer</span> post through Buffer — a social scheduling tool that publishes to all your social accounts at once — so they need a Buffer account connected.
          </p>
        </CardContent>
      </Card>

      {/* Mobile-only sticky-bottom save bar — the top header bar that
          holds Save is non-sticky on mobile (PR #657). */}
      <div className="md:hidden">
        <SaveBar
          saving={saving}
          saved={saved}
          error={error}
          isDirty={isDirty}
          onSave={handleSave}
          onDiscard={() => setForm(pristine)}
        />
      </div>
    </div>
  )
}

function ChannelTile({ channel, checked, onToggle }) {
  const Icon = CHANNEL_ICONS[channel.id] || Radio
  const badge = SHAPE_LABEL[channel.exportShape] || 'Export'
  return (
    <label
      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
        checked
          ? 'border-primary/30 bg-primary/10 hover:bg-primary/15'
          : 'border-input hover:bg-accent/30'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-4 w-4 shrink-0"
      />
      <div className={`flex h-9 w-9 items-center justify-center rounded-md shrink-0 ${
        checked ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
      }`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-tight truncate">{channel.label}</div>
        <div className="text-2xs text-muted-foreground mt-0.5 truncate">{badge}</div>
      </div>
    </label>
  )
}
