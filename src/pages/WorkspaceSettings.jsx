import { useState, useEffect, useId } from 'react'
import { Navigate, Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Loader2, CheckCircle2, AlertCircle, Settings, ChevronRight, Globe, Building2 } from 'lucide-react'
import LoadingState from '@/components/LoadingState'
import { SaveBar } from '@/components/settings/helpers'
import { Room, SectionGuide } from '@/components/settings/Room'
import { useUserRole } from '@/lib/useUserRole'
import { usePermission } from '@/lib/usePermission'
import { CAP_SETTINGS_EDIT } from '@/lib/capabilities'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import SchedulePrefsSection from '@/components/settings/SchedulePrefsSection'
import { apiFetch } from '@/lib/api'

// General tab — identity, web presence, social handles, approval workflow,
// and content strings. Logos / colors / brandbook moved to Brand Kit;
// locations moved to /settings/workspace/locations; paradigm content moved
// to /settings/workspace/voice; billing moved to /settings/workspace/billing.
function formFromWorkspace(ws) {
  return {
    display_name:            ws.display_name            ?? '',
    tagline:                 ws.tagline                 ?? '',
    sign_in_blurb:           ws.sign_in_blurb           ?? '',
    app_name:                ws.app_name                ?? '',
    website:                 ws.website                 ?? '',
    website_hostname:        ws.website_hostname        ?? '',
    booking_url:             ws.booking_url             ?? '',
    link_preview_blurb:      ws.link_preview_blurb      ?? '',
    social_instagram:        ws.social?.instagram       ?? '',
    social_facebook:         ws.social?.facebook        ?? '',
    internal_links_markdown: ws.internal_links_markdown ?? '',
    signature_system_name:   ws.signature_system_name   ?? '',
    signature_system_url:    ws.signature_system_url    ?? '',
    brand_hashtag:           ws.brand_hashtag           ?? '',
    spoken_url:              ws.spoken_url              ?? '',
    skip_review:             !!ws.skip_review,
    buffer_use_queue:        !!ws.buffer_use_queue,
    schedule_prefs:          ws.schedule_prefs ?? null,
    realtime_voice_daily_cap_min: ws.realtime_voice_daily_cap_min ?? 60,
  }
}

function formToPatch(form) {
  return {
    display_name:            form.display_name,
    tagline:                 form.tagline,
    sign_in_blurb:           form.sign_in_blurb,
    app_name:                form.app_name,
    website:                 form.website,
    website_hostname:        form.website_hostname,
    booking_url:             form.booking_url,
    link_preview_blurb:      form.link_preview_blurb,
    social: {
      instagram: form.social_instagram,
      facebook:  form.social_facebook,
    },
    internal_links_markdown: form.internal_links_markdown,
    signature_system_name:   form.signature_system_name || null,
    signature_system_url:    form.signature_system_url  || null,
    brand_hashtag:           form.brand_hashtag,
    spoken_url:              form.spoken_url,
    skip_review:             !!form.skip_review,
    buffer_use_queue:        !!form.buffer_use_queue,
    schedule_prefs:          form.schedule_prefs ?? null,
    realtime_voice_daily_cap_min: form.realtime_voice_daily_cap_min,
  }
}

export default function WorkspaceSettings() {
  useDocumentTitle('Settings — Workspace')
  const { getToken } = useAuth()
  const { role, isLoading: roleLoading } = useUserRole()
  const { has } = usePermission()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [ws, setWs]       = useState(undefined)
  const [form, setForm]   = useState(null)
  const [pristineForm, setPristineForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState(null)

  // Legacy redirect: /settings/workspace?billing=... and /settings/workspace#billing
  // now live at /settings/workspace/billing.
  useEffect(() => {
    const billing = searchParams.get('billing')
    if (billing) {
      navigate(`/settings/workspace/billing?billing=${billing}`, { replace: true })
      return
    }
    if (window.location.hash === '#billing') {
      navigate('/settings/workspace/billing', { replace: true })
    }
  }, [searchParams, navigate])

  useEffect(() => {
    // Authenticated load — needs the bearer token to get the full row.
    // A tokenless fetch returns the slim branding shape (display_name/logo
    // only), which left every other field on this tab blank on load.
    //
    // IMPORTANT: the slim shape is also returned with HTTP 200 when the bearer
    // token is present but scoped to the wrong org / stale (cross-subdomain
    // Clerk session). apiFetch can't retry it because it's a 200, not a 401.
    // If we seeded the form from that slim payload, every Content-strings /
    // Web-presence field would bind to '' and the next Save would PATCH those
    // empties over real data — exactly how these fields got silently wiped.
    // So: NEVER seed the form from a slim response. Treat it as a load failure.
    apiFetch('/api/workspace/me')
      .then(data => {
        if (data && data.slim_branding) {
          console.warn('[WorkspaceSettings] slim branding shape on load — refusing to seed form (stale/wrong-org token)')
          setWs(null)
          return
        }
        setWs(data)
        if (data) {
          const initial = formFromWorkspace(data)
          setForm(initial)
          setPristineForm(initial)
        }
      })
      .catch(() => setWs(null))
  }, [])

  const isDirty = !!form && !!pristineForm && JSON.stringify(form) !== JSON.stringify(pristineForm)
  useUnsavedChanges(isDirty)
  useSaveShortcut(() => { if (isDirty && !saving) handleSave() }, { disabled: !isDirty || saving })

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const token = await getToken()
      // Dirty-only patch: send ONLY fields whose value changed vs. the pristine
      // load. A field the user never touched is never PATCHed, so it can't be
      // overwritten with an empty string it never genuinely loaded. Belt-and-
      // suspenders with the slim-shape load guard above.
      const next = formToPatch(form)
      const base = pristineForm ? formToPatch(pristineForm) : {}
      const patch = {}
      for (const k of Object.keys(next)) {
        if (JSON.stringify(next[k]) !== JSON.stringify(base[k])) patch[k] = next[k]
      }
      const r = await fetch('/api/workspace/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setError(err.error || 'save-failed')
      } else {
        const updated = await r.json()
        setWs(updated)
        const refreshed = formFromWorkspace(updated)
        setForm(refreshed)
        setPristineForm(refreshed)
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  function set(key) {
    return v => setForm(f => ({ ...f, [key]: v }))
  }

  if (roleLoading || ws === undefined) return <LoadingState />

  // Phase 4 PR 2: capability gate. Producer (no CAP_SETTINGS_EDIT) is bounced.
  if (role !== 'admin' || !has(CAP_SETTINGS_EDIT)) {
    return <Navigate to="/" replace />
  }

  if (!ws) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Settings could not load. You may be signed into the wrong organisation — try signing out and back in.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-16">
      {/* Sticky header / save bar */}
      <div className="md:sticky md:top-0 z-20 py-4 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b border-border/60 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
            General
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Identity, web presence, and content strings used across prompts and link previews.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-1">
          {saved && (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />Saved
            </span>
          )}
          {error && (
            <span className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />{error}
            </span>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving || !isDirty}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Save changes
          </Button>
        </div>
      </div>

      <SectionGuide
        items={[
          { id: 'gen-identity', label: 'Identity',     done: !!form.display_name?.trim() },
          { id: 'gen-web',      label: 'Web presence',  done: !!form.website?.trim() },
        ]}
      />

      {/* Lead with the two most-edited sections open; the rest collapse into
          value-summary rows below (progressive disclosure — punch-list item 6). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard
        id="gen-identity"
        icon={Building2}
        title="Identity"
        description="How this workspace introduces itself on the sign-in screen and in the browser tab."
      >
        <Grid>
          <Field label="Workspace name"
            value={form.display_name} onChange={set('display_name')} />
          <Field label="Tagline"
            value={form.tagline} onChange={set('tagline')} />
        </Grid>
        <Field label="Text on your sign-in page"
          value={form.sign_in_blurb} onChange={set('sign_in_blurb')}
          hint="Shown below the workspace name on the sign-in screen." />
        <Field label="App name"
          value={form.app_name} onChange={set('app_name')}
          hint="App name in the browser tab — e.g. “Move Better — Bernard”." />
      </SectionCard>

      <SectionCard
        id="gen-web"
        icon={Globe}
        title="Web presence"
        description="Where this workspace lives on the web. Drives outbound links and link previews."
      >
        <Grid>
          <Field label="Website"
            value={form.website} onChange={set('website')} placeholder="https://..." type="url" autoComplete="url" />
          <Field label="Website hostname"
            value={form.website_hostname} onChange={set('website_hostname')}
            placeholder="movebetter.co"
            hint="Hostname only — no protocol or trailing slash." />
        </Grid>
        <Field label="Booking URL"
          value={form.booking_url} onChange={set('booking_url')}
          placeholder="https://..." type="url" autoComplete="off"
          hint="Primary call-to-action URL. Used in blog CTAs, email buttons, and social bios in generated copy." />
        <Textarea2 label="Summary for shared links"
          value={form.link_preview_blurb} onChange={set('link_preview_blurb')}
          rows={2}
          hint="Shown when a link to your site is shared on social or in chat — one sentence under 130 chars." />
      </SectionCard>
      </div>

      {/* Set-once / advanced settings — collapsed by default, each header shows
          its current value so state is scannable without opening. */}
      <div className="space-y-3">
      <CollapsibleSectionCard
        title="Social handles"
        description="Used for @-mentions in generated copy and source-of-truth URLs."
        summary={[form.social_instagram && `@${form.social_instagram}`, form.social_facebook].filter(Boolean).join(' · ') || 'Not set'}
      >
        <Grid>
          <Field label="Instagram handle"
            value={form.social_instagram} onChange={set('social_instagram')} placeholder="yourhandle" />
          <Field label="Facebook handle"
            value={form.social_facebook} onChange={set('social_facebook')} placeholder="yourpage" />
        </Grid>
      </CollapsibleSectionCard>

      <CollapsibleSectionCard
        title="Approval workflow"
        description="When off, drafts route through a reviewer (Send for review → Approve → Publish). Turn this on for single-user workspaces so the editor can publish directly."
        summary={form.skip_review ? 'Skip review — editors publish directly' : 'Review required before publish'}
      >
        <label className="flex items-start gap-3 rounded-lg border border-input p-3.5 cursor-pointer hover:bg-accent/30 transition-colors">
          <input
            type="checkbox"
            checked={!!form.skip_review}
            onChange={(e) => setForm((f) => ({ ...f, skip_review: e.target.checked }))}
            className="mt-0.5 h-4 w-4"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-tight">Skip review step</div>
            <div className="text-xs text-muted-foreground mt-1">
              Editors can publish directly from a draft. No reviewer approval required.
            </div>
          </div>
        </label>
      </CollapsibleSectionCard>

      <CollapsibleSectionCard
        title="Publish timing"
        description="Where the approve action sheet defaults when picking a publish time."
        summary={form.buffer_use_queue ? 'Add to queue by default' : 'Suggested times by default'}
      >
        <label className="flex items-start gap-3 rounded-lg border border-input p-3.5 cursor-pointer hover:bg-accent/30 transition-colors">
          <input
            type="checkbox"
            checked={!!form.buffer_use_queue}
            onChange={(e) => setForm((f) => ({ ...f, buffer_use_queue: e.target.checked }))}
            className="mt-0.5 h-4 w-4"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-tight">Use the scheduling queue by default</div>
            <div className="text-xs text-muted-foreground mt-1">
              When approving a post, the primary action becomes &ldquo;Add to queue&rdquo; — the next open spot on your channel&rsquo;s schedule is picked for you. Keep this off to use Bernard&rsquo;s platform-aware suggested times instead. &ldquo;Pick a specific time&rdquo; and &ldquo;Publish now&rdquo; remain available either way.
            </div>
          </div>
        </label>
      </CollapsibleSectionCard>

      {ws.realtime_voice_enabled && (
        <CollapsibleSectionCard
          title="Live Interview daily cap"
          description="Maximum minutes of real-time voice conversation per day across this workspace. Helps cap OpenAI Realtime spend if a session loops or someone runs back-to-back calls. Resets at midnight UTC."
          summary={`${form.realtime_voice_daily_cap_min ?? 60} min / day`}
        >
          <Field
            label="Daily cap (minutes)"
            type="number"
            value={form.realtime_voice_daily_cap_min ?? ''}
            onChange={(v) => {
              const n = parseInt(v, 10)
              setForm((f) => ({
                ...f,
                realtime_voice_daily_cap_min: Number.isFinite(n) && n >= 0 ? n : 0,
              }))
            }}
            hint="Default 60. Set to 0 to block all Live Interview sessions temporarily."
          />
        </CollapsibleSectionCard>
      )}

      <CollapsibleSectionCard
        title="Optimal posting times"
        description="Per-platform day/hour preferences that drive the suggested time on the approve action sheet and the optimal-time tint on the calendar."
        summary="Per-platform day & hour preferences"
      >
        <SchedulePrefsSection
          value={form.schedule_prefs}
          onChange={(v) => setForm((f) => ({ ...f, schedule_prefs: v }))}
        />
      </CollapsibleSectionCard>

      <CollapsibleSectionCard
        title="Content strings"
        description="Reusable phrases and links that flow into generated copy."
        summary={[form.brand_hashtag, form.signature_system_name].filter(Boolean).join(' · ') || 'Links & phrases for generated copy'}
      >
        <Textarea2
          label="Internal links (Markdown)"
          value={form.internal_links_markdown}
          onChange={set('internal_links_markdown')}
          rows={8}
          mono
          hint="Markdown list of pages. The blog post prompt uses these for contextual linking."
        />
        <Grid>
          <Field label="Signature system name"
            value={form.signature_system_name} onChange={set('signature_system_name')}
            placeholder="Leave blank if none" />
          <Field label="Signature system URL"
            value={form.signature_system_url} onChange={set('signature_system_url')}
            placeholder="https://..." />
        </Grid>
        <Grid>
          <Field label="Brand hashtag"
            value={form.brand_hashtag} onChange={set('brand_hashtag')}
            placeholder="#MoveBetter" />
          <Field label="Spoken URL"
            value={form.spoken_url} onChange={set('spoken_url')}
            placeholder="MoveBetter.co"
            hint="Said aloud in video scripts." />
        </Grid>
        <p className="text-xs text-muted-foreground">
          Location keyword and hashtag now live with each location in the{' '}
          <Link to="/settings/workspace/locations" className="underline underline-offset-2 hover:text-foreground">Locations tab</Link>
          {' '}— the primary location&apos;s values flow into prompts automatically.
        </p>
      </CollapsibleSectionCard>

      </div>

      <DangerZone workspace={ws} getToken={getToken} />

      {/* Mobile-only sticky-bottom save bar — the page header bar that
          holds Save is non-sticky on mobile (PR #657), so without this
          the user has to scroll back to the top of a long form to save. */}
      <div className="md:hidden">
        <SaveBar
          saving={saving}
          saved={saved}
          error={error}
          isDirty={isDirty}
          onSave={handleSave}
          onDiscard={() => setForm(pristineForm)}
        />
      </div>
    </div>
  )
}

function DangerZone({ workspace, getToken }) {
  const [confirmText, setConfirmText]   = useState('')
  const [archiving, setArchiving]       = useState(false)
  const [error, setError]               = useState(null)

  const slug = workspace?.slug || ''
  const matches = confirmText.trim().toLowerCase() === slug.toLowerCase() && slug.length > 0

  async function handleArchive() {
    if (!matches || archiving) return
    if (!confirm(`Archive "${workspace?.display_name || slug}"? This suspends the workspace immediately. Members lose access on their next request. Restoring requires database access.`)) return
    setArchiving(true)
    setError(null)
    try {
      const token = await getToken({ skipCache: true })
      const r = await fetch('/api/workspace/danger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'archive', confirm_slug: confirmText.trim() }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        setError(body?.error || `archive-failed (${r.status})`)
        setArchiving(false)
        return
      }
      try { await window.Clerk?.signOut?.() } catch { /* empty */ }
      window.location.href = 'https://withbernard.ai'
    } catch (e) {
      setError(e?.message || 'network-error')
      setArchiving(false)
    }
  }

  return (
    <Card className="rounded-2xl border-destructive/30 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <CardHeader>
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-1 h-5 rounded-full shrink-0"
            style={{ background: 'hsl(var(--destructive))' }}
            aria-hidden="true"
          />
          <CardTitle className="text-lg font-bold text-destructive">Danger zone</CardTitle>
        </div>
        <CardDescription>
          Destructive actions. Read carefully — these affect every member of the workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border-2 border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-destructive">Archive workspace</p>
              <p className="text-xs text-muted-foreground mt-1">
                Suspends this workspace immediately. All members lose access — the subdomain stops resolving and every API call returns 404. Content, media, and credentials stay in storage so the workspace can be restored manually via the database.
              </p>
              <ul className="text-2xs text-muted-foreground list-disc pl-4 mt-1.5 space-y-0.5">
                <li>Published posts on external channels (WordPress / Astro / your social scheduler) are <strong>not</strong> taken down.</li>
                <li>Cron jobs that reference this workspace start no-op&apos;ing.</li>
                <li>Your Clerk Organization is not deleted; members can still sign in elsewhere.</li>
              </ul>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              To confirm, type the workspace slug: <code className="text-foreground bg-muted px-1 py-0.5 rounded">{slug}</code>
            </Label>
            <Input
              aria-label="Workspace slug confirmation"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={slug}
              disabled={archiving}
              autoComplete="off"
              className="h-10 text-sm"
            />
            {error && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                {error === 'confirm-slug-mismatch'
                  ? "The slug you typed doesn't match. Copy the value above exactly."
                  : error}
              </p>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={handleArchive}
              disabled={!matches || archiving}
            >
              {archiving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Archive this workspace
            </Button>
          </div>
        </div>

        <p className="text-2xs text-muted-foreground">
          Rename, transfer ownership, and hard delete are not available in-app yet — each requires substantial server work. Contact the platform team (drq@withbernard.ai) for any of these.
        </p>
      </CardContent>
    </Card>
  )
}

// A primary settings section — the shared "room" shell (icon tile, title,
// one-line purpose), matching the Brand screens. Collapsible/advanced sections
// below still use CollapsibleSectionCard (progressive disclosure), and the
// Danger zone keeps its own destructive Card.
function SectionCard({ id, icon, title, description, children, className = '' }) {
  return (
    <Room id={id} icon={icon} title={title} purpose={description} className={className}>
      {children}
    </Room>
  )
}

// A collapsible SectionCard for the set-once / advanced settings. Collapsed by
// default so the page leads with the fields you actually edit (Identity + Web
// presence); the collapsed header shows a one-line summary of the current value
// so state is scannable without opening. Editing state lives in the parent form,
// so open/closed never affects saved values.
function CollapsibleSectionCard({ title, description, summary, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card className="rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-accent/30 transition-colors"
      >
        <span className="text-lg font-bold shrink-0">{title}</span>
        {!open && summary
          ? <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
          : <span className="flex-1" />}
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <CardContent className="space-y-5 border-t pt-5">
          {description && <p className="-mt-1 text-xs text-muted-foreground">{description}</p>}
          {children}
        </CardContent>
      )}
    </Card>
  )
}

function Grid({ children }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">{children}</div>
}

function Field({ label, value, onChange, placeholder, hint, type = 'text', autoComplete }) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-10 text-sm"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Textarea2({ label, value, onChange, rows = 4, hint, mono = false }) {
  const fieldId = `textarea2-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId} className="text-sm font-medium">{label}</Label>
      <Textarea
        id={fieldId}
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        className={`text-sm resize-y ${mono ? 'font-mono' : ''}`}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
