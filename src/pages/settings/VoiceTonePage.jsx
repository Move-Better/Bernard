// Settings → Brand → Voice. The practice's shared brand voice — how this clinic
// sounds and who it serves. Owns the fields the AI reads before writing anything,
// organized into three zones:
//
//   Identity  — clinic_context, brand_voice ("How it should sound")
//   Audience  — audience_short, audience_description, activity_context,
//               patient_context (archetypes, summary blurb, prior-provider pain points)
//   Style     — tone_modifiers (active / clinical / warm / smart), social_length_lean
//
// This is CLINIC voice, not a clinician's own voice — each clinician's phrases and
// register are learned automatically and live on their Staff Profile "Voice model" tab.
// Topic catalog, interview pickers, and condition bank live on the sibling
// "Interview setup" page (/settings/workspace/interview).

import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2, Sparkles, Pencil, Mic2, Users, Compass, SlidersHorizontal } from 'lucide-react'
import { Field, Textarea2, SaveBar } from '@/components/settings/helpers'
import { Room, SectionGuide, RoomSubhead, Collapse } from '@/components/settings/Room'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useUserRole } from '@/lib/useUserRole'
import { usePermission } from '@/lib/usePermission'
import { CAP_SETTINGS_EDIT } from '@/lib/capabilities'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { apiFetch } from '@/lib/api'
import { ToneModifierCards } from '@/components/settings/ToneCard'
import { ArchetypeCardsSection } from '@/components/settings/PatientArchetypes'
import { PatientContextEditor } from '@/components/settings/PatientContextEditor'

function tryParseJson(text, fallback) {
  if (!text || !text.trim()) return { ok: true, value: fallback }
  try { return { ok: true, value: JSON.parse(text) } }
  catch (e) { return { ok: false, error: e.message } }
}

// Content length-lean dial (workspaces.social_length_lean). Shifts how much
// depth Bernard writes into social posts — scales the deep-dive pieces, leaves
// hooks/CTAs short. See api/_lib/socialLengthTargets.js.
const LENGTH_LEAN_OPTIONS = [
  { value: 'punchy',   label: 'Punchy',   desc: 'Short and scannable — leans brief on every channel.' },
  { value: 'balanced', label: 'Balanced', desc: 'A genuine mix — short hooks, medium everyday, the occasional deep-dive.' },
  { value: 'indepth',  label: 'In-depth', desc: 'Leans into long-form on the deep pieces — depth as a signature. Hooks and CTAs still stay short.' },
]

function LengthLeanSelector({ value, onChange }) {
  const current = value || 'balanced'
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
      {LENGTH_LEAN_OPTIONS.map((opt) => {
        const active = current === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`text-left rounded-lg border p-3 transition-colors ${
              active ? 'border-primary/40 bg-primary/10' : 'border-border hover:bg-accent/30'
            }`}
          >
            <div className="flex items-center gap-2">
              <div className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors ${
                active ? 'border-primary bg-primary' : 'border-muted-foreground/40'
              }`} />
              <span className="text-sm font-medium">{opt.label}</span>
            </div>
            <p className="text-2xs text-muted-foreground mt-1.5 leading-relaxed">{opt.desc}</p>
          </button>
        )
      })}
    </div>
  )
}

function formFromWorkspace(ws) {
  return {
    clinic_context:       ws.clinic_context       ?? '',
    brand_voice:          ws.brand_voice           ?? '',
    audience_short:       ws.audience_short        ?? '',
    audience_description: ws.audience_description  ?? '',
    activity_context:     ws.activity_context      ?? '',
    tone_active:          ws.tone_modifiers?.active   ?? '',
    tone_clinical:        ws.tone_modifiers?.clinical ?? '',
    tone_warm:            ws.tone_modifiers?.warm     ?? '',
    tone_smart:           ws.tone_modifiers?.smart    ?? '',
    social_length_lean:   ws.social_length_lean       ?? 'balanced',
    patient_context_json: JSON.stringify(ws.patient_context ?? {}, null, 2),
  }
}

function formToPatch(form) {
  const pc = tryParseJson(form.patient_context_json, {})
  return {
    clinic_context:       form.clinic_context,
    brand_voice:          form.brand_voice,
    audience_short:       form.audience_short,
    audience_description: form.audience_description,
    activity_context:     form.activity_context,
    tone_modifiers: {
      active:   form.tone_active   ?? '',
      clinical: form.tone_clinical ?? '',
      warm:     form.tone_warm     ?? '',
      smart:    form.tone_smart    ?? '',
    },
    social_length_lean: form.social_length_lean || 'balanced',
    ...(pc.ok ? { patient_context: pc.value } : {}),
  }
}

export default function VoiceTonePage() {
  useDocumentTitle('Settings — Voice')
  const runtimeWs = useWorkspace()
  const { role, isLoading: roleLoading } = useUserRole()
  const { has } = usePermission()
  const [ws, setWs] = useState(undefined)
  const [form, setForm] = useState(null)
  const [pristine, setPristine] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch('/api/workspace/me')
      .then(data => {
        setWs(data)
        if (data) {
          const initial = formFromWorkspace(data)
          setForm(initial)
          setPristine(initial)
        }
      })
      .catch(() => setWs(null))
  }, [])

  const isDirty = !!form && !!pristine && JSON.stringify(form) !== JSON.stringify(pristine)
  useUnsavedChanges(isDirty)
  useSaveShortcut(() => { if (isDirty && !saving) handleSave() }, { disabled: !isDirty || saving })

  function set(key) {
    return v => setForm(f => ({ ...f, [key]: v }))
  }

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    const pc = tryParseJson(form.patient_context_json, {})
    if (!pc.ok) { setError(`Patient context JSON: ${pc.error}`); setSaving(false); return }
    try {
      const updated = await apiFetch('/api/workspace/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToPatch(form)),
      })
      setWs(updated)
      const refreshed = formFromWorkspace(/** @type {any} */ (updated))
      setForm(refreshed); setPristine(refreshed)
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(/** @type {any} */ (e)?.message || 'save-failed')
    } finally {
      setSaving(false)
    }
  }

  if (roleLoading || ws === undefined) {
    return (
      <div className="flex items-center justify-center py-24" role="status">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading…</span>
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

  const interviewerName = runtimeWs?.interviewer_name || ws?.interviewer_name || 'Bernard'
  const clinicName = runtimeWs?.display_name || ws?.display_name || 'your practice'

  // Simple completion signals — drive the section-guide dots and room pills.
  const identityDone = !!(form.clinic_context?.trim() && form.brand_voice?.trim())
  const audienceDone = !!form.audience_short?.trim()

  return (
    <div className="space-y-6">
      {/* Breadcrumb + heading */}
      <div>
        <p className="text-2xs text-muted-foreground/80">
          Settings · Brand · Voice
        </p>
        <PageHeader
          className="mt-0.5 mb-0"
          icon={Mic2}
          title="Voice"
          subtitle={`How ${clinicName} sounds in every post ${interviewerName} writes — the practice's shared voice, set once for the whole clinic.`}
        />
      </div>

      {/* Jump nav + completion at a glance */}
      <SectionGuide
        items={[
          { id: 'voice-identity', label: 'Identity', done: identityDone },
          { id: 'voice-audience', label: 'Audience', done: audienceDone },
          { id: 'voice-style',    label: 'Style',    done: true },
        ]}
      />

      {/* Clinic-vs-clinician callout — draws the line between this shared
          brand voice and each clinician's own auto-learned voice. */}
      <div className="rounded-xl bg-info/10 border border-info/25 p-3.5 flex gap-3">
        <Users className="h-4 w-4 shrink-0 text-info mt-0.5" aria-hidden="true" />
        <div className="text-sm text-foreground/90 leading-relaxed">
          <span className="font-semibold">Clinic voice, not a personal setting.</span>{' '}
          This is the practice&apos;s shared voice. Each clinician&apos;s own voice — their phrases,
          their register — is learned automatically from their interviews and edits, and lives on
          their profile&apos;s <span className="font-medium">Voice model</span> tab. Nothing for them to fill in.
        </div>
      </div>

      {/* Summary-first read of the current settings */}
      <BriefAndPreviewCard form={form} interviewerName={interviewerName} />

      {/* Rooms */}
      <div className="space-y-4">
        {/* Identity — who the practice is */}
        <Room
          id="voice-identity"
          icon={Compass}
          title="Identity"
          purpose={`Who the practice is — the core brief ${interviewerName} reads before writing anything.`}
          state={{ label: identityDone ? 'Complete' : 'Add detail', tone: identityDone ? 'done' : 'todo' }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-4 items-start">
            <Textarea2
              label="What this clinic is about"
              value={form.clinic_context}
              onChange={set('clinic_context')}
              rows={5}
              hint={`${interviewerName} uses this to orient tone and framing across all content.`}
            />
            <Textarea2
              label="How it should sound"
              value={form.brand_voice}
              onChange={set('brand_voice')}
              rows={5}
              hint="The adjectives, cadences, and phrases that make your voice yours."
            />
          </div>
        </Room>

        {/* Audience — who it's for */}
        <Room
          id="voice-audience"
          icon={Users}
          title="Audience"
          purpose={`Who it's for — ${interviewerName} calibrates language and empathy to who is actually reading.`}
          state={{ label: audienceDone ? 'Complete' : 'Add detail', tone: audienceDone ? 'done' : 'todo' }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-3 items-start">
            <Field
              label="Audience in one line"
              value={form.audience_short}
              onChange={set('audience_short')}
              hint={`A short label ${interviewerName} can reference quickly — e.g. "active adults 35–60 returning from injury."`}
            />
            <Field
              label="Activity or discipline vocabulary"
              value={form.activity_context}
              onChange={set('activity_context')}
              hint={`Sport, discipline, or lifestyle terms that belong in the ${clinicName} lexicon.`}
            />
          </div>

          <Collapse summary="Full audience description" hint="— the fuller picture, optional">
            <Textarea2
              label=""
              value={form.audience_description}
              onChange={set('audience_description')}
              rows={4}
              hint="Their goals, fears, and what gets them to take action."
            />
          </Collapse>

          <div className="space-y-3 border-t border-border/50 pt-4">
            <RoomSubhead
              title="Patient types"
              note={`${interviewerName} sharpens questions toward the type chosen at interview start.`}
            />
            <ArchetypeCardsSection
              value={form.patient_context_json}
              onChange={set('patient_context_json')}
              interviewerName={interviewerName}
            />
            <Collapse summary="Patient detail" hint="— summary, primary avatar, prior-provider pain points">
              <PatientContextEditor
                value={form.patient_context_json}
                onChange={set('patient_context_json')}
                interviewerName={interviewerName}
              />
            </Collapse>
          </div>
        </Room>

        {/* Style — how it's expressed */}
        <Room
          id="voice-style"
          icon={SlidersHorizontal}
          title="Style"
          purpose="How it's expressed — tone and length, set together."
          state={{ label: 'Set', tone: 'done' }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-6 items-start">
            <div className="space-y-3">
              <RoomSubhead title="Tone modes" note="applied when a tone is picked at interview start" />
              <ToneModifierCards form={form} set={set} />
            </div>
            <div className="space-y-3">
              <RoomSubhead title="Post length" note="hooks & calls-to-action stay short either way" />
              <LengthLeanSelector value={form.social_length_lean} onChange={set('social_length_lean')} />
            </div>
          </div>
        </Room>
      </div>

      <SaveBar
        saving={saving} saved={saved} error={error} isDirty={isDirty}
        onSave={handleSave}
        onDiscard={() => { setForm(pristine); setError(null) }}
      />
    </div>
  )
}

// ── BriefAndPreviewCard ──────────────────────────────────────────────────────
// Summary-first read of the current settings: a structured "How {name} reads
// you" card sitting above the rooms, so the outcome is visible before the
// fields. Rows are deterministic (real field values); "Try a live preview" hits
// /api/voice-preview and renders a sample opener below in a blockquote.

function BriefAndPreviewCard({ form, interviewerName }) {
  const audience = (form?.audience_short || '').trim()
  const brandVoice = (form?.brand_voice || '').trim()
  const toneCount = [form?.tone_active, form?.tone_clinical, form?.tone_warm, form?.tone_smart]
    .filter(t => (t || '').trim()).length
  const lengthLabel = (LENGTH_LEAN_OPTIONS.find(o => o.value === (form?.social_length_lean || 'balanced')) || {}).label || 'Balanced'
  const hasAny = !!(audience || brandVoice)

  const [opener, setOpener] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  async function generate() {
    setLoading(true); setErr(null)
    try {
      const data = await apiFetch('/api/voice-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      setOpener(data.opener)
    } catch (e) {
      setErr(e?.message || 'Preview failed')
    } finally {
      setLoading(false)
    }
  }

  const rows = [
    brandVoice && { k: 'Sounds like', v: brandVoice.length > 110 ? brandVoice.slice(0, 110) + '…' : brandVoice },
    audience && { k: 'Writes for', v: audience },
    { k: 'Length', v: lengthLabel },
    { k: 'Tone modes', v: toneCount ? `${toneCount} configured` : 'System defaults' },
  ].filter(Boolean)

  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-card to-primary/5 px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-widest text-primary">
          How {interviewerName} reads you right now
        </p>
        <Button
          onClick={generate}
          disabled={loading}
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          <span className="text-xs">{loading ? 'Generating…' : 'Try a live preview'}</span>
        </Button>
      </div>

      {hasAny ? (
        <dl className="mt-3 space-y-1.5">
          {rows.map(r => (
            <div key={r.k} className="flex gap-3 text-sm">
              <dt className="w-24 shrink-0 pt-px text-xs font-semibold text-muted-foreground">{r.k}</dt>
              <dd className="text-foreground">{r.v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm italic text-foreground/70 mt-2 leading-relaxed flex items-center gap-1.5">
          <Pencil className="h-3 w-3 text-verbatim-accent/80 shrink-0" />
          {interviewerName} hasn&apos;t learned your voice yet — fill in the rooms below and the read appears here.
        </p>
      )}

      {opener && (
        <blockquote className="mt-3 border-l-2 border-verbatim-accent/60 pl-3 text-sm italic text-foreground/80 leading-relaxed">
          &ldquo;{opener}&rdquo;
          <footer className="mt-1 text-2xs not-italic text-muted-foreground">— {interviewerName}, sample opener</footer>
        </blockquote>
      )}
      {err && <p className="text-2xs text-destructive mt-2">{err}</p>}
    </div>
  )
}
