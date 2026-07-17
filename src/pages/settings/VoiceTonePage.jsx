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
import { Loader2, Sparkles, Pencil, Mic2, Users } from 'lucide-react'
import { Section, Field, Textarea2, SaveBar } from '@/components/settings/helpers'
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

// A labeled sub-block inside a zone Section — a quieter h3 heading than the
// zone's own h2, used to keep merged clusters (patient types, tone, length)
// legible within one zone.
function SubGroup({ title, description, className = '', children }) {
  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        {description && <p className="text-2xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>}
      </div>
      {children}
    </div>
  )
}

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

  return (
    <div className="space-y-8">
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

      {/* Unified brief + preview card */}
      <BriefAndPreviewCard form={form} interviewerName={interviewerName} />

      <div className="space-y-8">
        {/* ── Zone 1 · Identity — who the practice is ─────────────────────── */}
        <Section
          title="Identity"
          description={`Who the practice is — the core brief ${interviewerName} reads before writing anything.`}
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
        </Section>

        {/* ── Zone 2 · Audience — who it's for ────────────────────────────── */}
        <Section
          title="Audience"
          description={`Who it's for — ${interviewerName} calibrates language and empathy to who is actually reading.`}
          className="pt-8 border-t border-border/60"
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
          <Textarea2
            label="Full audience description"
            value={form.audience_description}
            onChange={set('audience_description')}
            rows={4}
            hint="The fuller picture of who you're writing for — their goals, fears, and what gets them to take action."
          />

          <SubGroup
            title="Patient types"
            description={`The patient types ${clinicName} serves. ${interviewerName} sharpens questions toward the type chosen at interview start.`}
            className="pt-4 mt-1 border-t border-border/50"
          >
            <ArchetypeCardsSection
              value={form.patient_context_json}
              onChange={set('patient_context_json')}
              interviewerName={interviewerName}
            />
            <PatientContextEditor
              value={form.patient_context_json}
              onChange={set('patient_context_json')}
              interviewerName={interviewerName}
            />
          </SubGroup>
        </Section>

        {/* ── Zone 3 · Style — how it's expressed ─────────────────────────── */}
        <Section
          title="Style"
          description="How it's expressed — tone and length, set together."
          className="pt-8 border-t border-border/60"
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-6 items-start">
            <SubGroup
              title="Tone modes"
              description={`When a staff member picks a tone at the start of an interview, ${interviewerName} applies the matching modifier. Leave any blank to fall back to the system default shown in the card.`}
            >
              <ToneModifierCards form={form} set={set} />
            </SubGroup>
            <SubGroup
              title="Post length"
              description={`How much depth ${interviewerName} writes into social posts. Hooks and calls-to-action stay short either way — this dials the everyday and deep-dive pieces.`}
            >
              <LengthLeanSelector value={form.social_length_lean} onChange={set('social_length_lean')} />
            </SubGroup>
          </div>
        </Section>
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
// Merges what used to be two separate things on the legacy page:
//   - WorkingSummaryCallout: deterministic string-template of the brief
//   - PreviewBernardCard: live LLM opener generated from current settings
//
// One card. Resting state shows the deterministic summary; "Try a live
// preview" hits /api/voice-preview and renders the opener below in a
// blockquote. Avoids two answers to the "what does Bernard think" question.

function buildWorkingSummary(form, interviewerName) {
  const brandVoice = (form?.brand_voice || '').trim()
  const audience = (form?.audience_short || '').trim()
  if (!brandVoice && !audience) return null
  const tones = [form?.tone_active, form?.tone_clinical, form?.tone_warm, form?.tone_smart]
    .map(t => (t || '').trim()).filter(Boolean)
  const name = interviewerName || 'Bernard'
  const sentences = []
  if (brandVoice && audience) {
    const voiceSnippet = brandVoice.slice(0, 120) + (brandVoice.length > 120 ? '…' : '')
    sentences.push(`${name} will write for ${audience} in a voice that comes across as ${voiceSnippet}.`)
  } else if (brandVoice) {
    const voiceSnippet = brandVoice.slice(0, 160) + (brandVoice.length > 160 ? '…' : '')
    sentences.push(`${name} will write in a voice that comes across as ${voiceSnippet}.`)
  } else if (audience) {
    sentences.push(`${name} will tailor content for ${audience}.`)
  }
  if (tones.length) {
    sentences.push(`${tones.length} tone mode${tones.length === 1 ? '' : 's'} configured so each piece can shift register when needed.`)
  }
  return sentences.join(' ')
}

function BriefAndPreviewCard({ form, interviewerName }) {
  const summary = buildWorkingSummary(form, interviewerName)
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

  return (
    <div className="rounded-lg border border-action/30 bg-action/5 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-widest text-action">
          {interviewerName}&apos;s brief, as he reads it
        </p>
        <Button
          onClick={generate}
          disabled={loading}
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 border-action/40 bg-action/10 text-action hover:bg-action/20 hover:text-action"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          <span className="text-xs">{loading ? 'Generating…' : 'Try a live preview'}</span>
        </Button>
      </div>
      {summary ? (
        <p className="text-sm text-foreground mt-2 leading-relaxed">{summary}</p>
      ) : (
        <p className="text-sm italic text-foreground/70 mt-2 leading-relaxed flex items-center gap-1.5">
          <Pencil className="h-3 w-3 text-verbatim-accent/80 shrink-0" />
          {interviewerName} hasn&apos;t learned your voice yet — fill in the sections below and he&apos;ll mirror it back.
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
