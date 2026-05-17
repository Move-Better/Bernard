import { useState, useEffect } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { Loader2, Sparkles, Pencil, Plus, X, ChevronDown, ChevronRight } from 'lucide-react'
import { Section, Field, Textarea2, SaveBar } from '@/components/settings/helpers'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useUserRole } from '@/lib/useUserRole'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { apiFetch } from '@/lib/api'
import { useClinicians } from '@/lib/queries'
import { ClinicianChip } from '@/components/ClinicianChip'
import { ToneModifierCards } from '@/components/settings/ToneCard'
import { ArchetypeCardsSection } from '@/components/settings/PatientArchetypes'
import { PatientContextEditor } from '@/components/settings/PatientContextEditor'
import { TopicSuggestionsEditor } from '@/components/settings/TopicSuggestionsEditor'
import { ConditionBankEditor } from '@/components/settings/ConditionBankEditor'
import {
  AUDIENCE_CATALOG,
  STORY_TYPE_CATALOG,
  MAX_CATALOG_SLOTS,
  MAX_CUSTOM_SLOTS,
} from '@/lib/interviewOptionsCatalog'

function formFromWorkspace(ws) {
  return {
    clinic_context:       ws.clinic_context       ?? '',
    audience_short:       ws.audience_short        ?? '',
    audience_description: ws.audience_description  ?? '',
    activity_context:     ws.activity_context      ?? '',
    brand_voice:          ws.brand_voice           ?? '',
    tone_active:          ws.tone_modifiers?.active   ?? '',
    tone_clinical:        ws.tone_modifiers?.clinical ?? '',
    tone_warm:            ws.tone_modifiers?.warm     ?? '',
    tone_smart:           ws.tone_modifiers?.smart    ?? '',
    patient_context_json:    JSON.stringify(ws.patient_context   ?? {}, null, 2),
    interview_context_json:  JSON.stringify(ws.interview_context ?? {}, null, 2),
    topic_suggestions_json:  JSON.stringify(ws.topic_suggestions ?? [], null, 2),
    audience_options:        Array.isArray(ws.audience_options)   ? ws.audience_options   : [],
    story_type_options:      Array.isArray(ws.story_type_options) ? ws.story_type_options : [],
  }
}

function tryParseJson(text, fallback) {
  if (!text || !text.trim()) return { ok: true, value: fallback }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

function formToPatch(form) {
  return {
    clinic_context:       form.clinic_context,
    audience_short:       form.audience_short,
    audience_description: form.audience_description,
    activity_context:     form.activity_context,
    brand_voice:          form.brand_voice,
    tone_modifiers: {
      active:   form.tone_active   ?? '',
      clinical: form.tone_clinical ?? '',
      warm:     form.tone_warm     ?? '',
      smart:    form.tone_smart    ?? '',
    },
    patient_context:   form._parsed_patient_context,
    interview_context: form._parsed_interview_context,
    topic_suggestions: form._parsed_topic_suggestions,
    audience_options:   form.audience_options,
    story_type_options: form.story_type_options,
  }
}

export default function VoiceSettings() {
  useDocumentTitle('Settings — Bernard & voice')
  const { getToken } = useAuth()
  const runtimeWs = useWorkspace()
  const { role, isLoading: roleLoading } = useUserRole()
  const [ws, setWs]           = useState(undefined)
  const [form, setForm]       = useState(null)
  const [pristine, setPristine] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    fetch('/api/workspace/me')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(data => {
        setWs(data)
        if (data) {
          const initial = formFromWorkspace(data)
          setForm(initial)
          setPristine(initial)
        }
      })
  }, [])

  const isDirty = !!form && !!pristine && JSON.stringify(form) !== JSON.stringify(pristine)
  useUnsavedChanges(isDirty)
  useSaveShortcut(() => { if (isDirty && !saving) handleSave() }, { disabled: !isDirty || saving })

  function set(key) {
    return v => setForm(f => ({ ...f, [key]: v }))
  }

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const pc = tryParseJson(form.patient_context_json, {})
      const ic = tryParseJson(form.interview_context_json, {})
      const ts = tryParseJson(form.topic_suggestions_json, [])
      if (!pc.ok)  { setError(`Patient context JSON: ${pc.error}`);   setSaving(false); return }
      if (!ic.ok)  { setError(`Interview context JSON: ${ic.error}`); setSaving(false); return }
      if (!ts.ok)  { setError(`Topic suggestions JSON: ${ts.error}`); setSaving(false); return }
      const formWithParsed = {
        ...form,
        _parsed_patient_context:   pc.value,
        _parsed_interview_context: ic.value,
        _parsed_topic_suggestions: ts.value,
      }
      const token = await getToken()
      const r = await fetch('/api/workspace/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(formToPatch(formWithParsed)),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setError(err.error || 'save-failed')
      } else {
        const updated = await r.json()
        setWs(updated)
        const refreshed = formFromWorkspace(updated)
        setForm(refreshed); setPristine(refreshed)
        setSaved(true); setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      setError('network-error')
    } finally {
      setSaving(false)
    }
  }

  if (roleLoading || ws === undefined) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (role !== 'admin') return <Navigate to="/" replace />
  if (!ws) return (
    <div className="py-16 text-center text-sm text-muted-foreground">
      Workspace settings are only available on a <code className="font-mono text-xs">*.narraterx.ai</code> deployment.
    </div>
  )

  const interviewerName = runtimeWs?.interviewer_name || ws?.interviewer_name || 'Bernard'
  const clinicName = runtimeWs?.display_name || ws?.display_name || 'your practice'

  return (
    <div className="max-w-2xl space-y-8">
      {/* ── Page header — narrative framing ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          What {interviewerName} knows about {clinicName}
        </h1>
        <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed">
          This is the brief {interviewerName} reads before every interview and every piece of content.
          What you write here shapes how your clinicians sound — and how faithfully that voice
          carries into every draft.
        </p>
      </div>

      {/* ── Bernard's working summary (P0-E) ── */}
      <WorkingSummaryCallout form={form} interviewerName={interviewerName} />

      {/* ── Patient archetypes — front-and-centre read/edit cards ── */}
      <ArchetypeCardsSection
        value={form.patient_context_json}
        onChange={set('patient_context_json')}
        interviewerName={interviewerName}
      />

      {/* ── Preview Bernard's voice (P1-F) — near the top, next to archetypes ── */}
      <PreviewBernardCard interviewerName={interviewerName} />

      <Separator />

      {/* ── How your practice sounds ── */}
      <div id="voice-context-anchor" className="scroll-mt-20" />
      <Section
        title={`How ${clinicName} sounds`}
        description={`The core brief ${interviewerName} uses to stay on-brand in every piece of content.`}
      >
        <Textarea2
          label="What this clinic is about"
          value={form.clinic_context}
          onChange={set('clinic_context')}
          rows={3}
          hint={`${interviewerName} uses this to orient tone and framing across all content.`}
        />
        <Textarea2
          label="Brand voice"
          value={form.brand_voice}
          onChange={set('brand_voice')}
          rows={6}
          hint="How your content should feel — the adjectives, cadences, and phrases that make your voice yours."
        />
      </Section>

      <Separator />

      {/* ── Who you serve ── */}
      <Section
        title="Who you serve"
        description={`${interviewerName} uses this to calibrate language and empathy — who is actually reading this content?`}
      >
        <Field
          label="Audience in one line"
          value={form.audience_short}
          onChange={set('audience_short')}
          hint={`A short label ${interviewerName} can reference quickly — e.g. "active adults 35–60 returning from injury."`}
        />
        <Textarea2
          label="Full audience description"
          value={form.audience_description}
          onChange={set('audience_description')}
          rows={4}
          hint="The fuller picture of who you're writing for — their goals, fears, and what gets them to take action."
        />
        <Field
          label="Activity or discipline vocabulary"
          value={form.activity_context}
          onChange={set('activity_context')}
          hint={`Sport, discipline, or lifestyle terms that belong in the ${clinicName} lexicon.`}
        />
      </Section>

      <Separator />

      {/* ── Tone modes ── */}
      <Section
        title="How tone shifts"
        description={`When a clinician picks a tone at the start of an interview, ${interviewerName} applies the matching modifier below. Leave any tone blank to skip it.`}
      >
        <ToneModifierCards form={form} set={set} />
      </Section>

      <Separator />

      {/* ── Topic suggestions ── */}
      <Section
        title={`What ${interviewerName} asks about`}
        description={`The interview topics ${interviewerName} proposes. Tag each topic with the archetypes it serves — leave untagged to offer it to everyone.`}
      >
        <TopicSuggestionsEditor
          topicsJson={form.topic_suggestions_json}
          patientContextJson={form.patient_context_json}
          onChange={set('topic_suggestions_json')}
        />
      </Section>

      <Separator />

      {/* ── Pre-interview options — audience + story-type slots ── */}
      <Section
        title="Pre-interview choices"
        description="The audience and story-type options clinicians can pick from before starting an interview. Curate from the master catalog or add custom slots. Up to 6 catalog + 2 custom in each list."
      >
        <div className="space-y-6">
          <SlotEditor
            label="Audience"
            description="Who the piece is for. Shapes how the interviewer probes and how the output is worded."
            catalog={AUDIENCE_CATALOG}
            value={form.audience_options}
            onChange={set('audience_options')}
          />
          <SlotEditor
            label="Story type"
            description="What kind of piece you're making. Drives what the interviewer probes for (case study → timeline; principle → analogy)."
            catalog={STORY_TYPE_CATALOG}
            value={form.story_type_options}
            onChange={set('story_type_options')}
          />
        </div>
      </Section>

      <Separator />

      {/* ── Patient context details — avatar, pain points (advanced) ── */}
      <details className="group rounded-lg border border-input">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none hover:bg-accent/30 list-none flex items-center justify-between rounded-lg">
          <span>Patient context details <span className="text-xs font-normal text-muted-foreground ml-1">(advanced)</span></span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-4 pb-4 pt-2">
          <PatientContextEditor
            value={form.patient_context_json}
            onChange={set('patient_context_json')}
          />
        </div>
      </details>

      <Separator />

      {/* ── Condition bank — structured editor (replaces legacy raw JSON) ── */}
      <Section
        title="Condition bank"
        description={`Per-condition steering briefs. When an interview topic matches a condition key (or a keyword alias), ${interviewerName} reads the matching brief to sharpen his questions.`}
      >
        <ConditionBankEditor
          value={form.interview_context_json}
          onChange={set('interview_context_json')}
        />
      </Section>

      {/* ── Per-clinician voice memory ── */}
      <VoiceMemorySection interviewerName={interviewerName} />

      <SaveBar
        saving={saving} saved={saved} error={error} isDirty={isDirty}
        onSave={handleSave}
        onDiscard={() => { setForm(pristine); setError(null) }}
      />
    </div>
  )
}

// ── Pre-interview slot editor (Phase 1 — workspace curates audience + story type) ──
//
// Renders the full catalog as toggleable cards (selected ones are highlighted
// and counted against the 6-catalog cap) and a separate list of custom slots
// (up to 2) with inline label + description editing.
//
// All edits flow through onChange as the canonical slots array of
// { key, label, emoji, description, is_custom } objects — the shape the
// server expects on PATCH /api/workspace/me.

function SlotEditor({ label, description, catalog, value, onChange }) {
  const slots = Array.isArray(value) ? value : []
  const selectedCatalogKeys = new Set(
    slots.filter((s) => !s.is_custom).map((s) => s.key),
  )
  const customSlots = slots.filter((s) => s.is_custom)
  const catalogCount = selectedCatalogKeys.size

  // Pending row — filled before being committed via "Add" button
  const [pending, setPending] = useState(null)

  function toggleCatalogItem(item) {
    if (selectedCatalogKeys.has(item.key)) {
      onChange(slots.filter((s) => !(!s.is_custom && s.key === item.key)))
      return
    }
    if (catalogCount >= MAX_CATALOG_SLOTS) return
    onChange([...slots, { ...item, is_custom: false }])
  }

  function openPendingRow() {
    if (customSlots.length >= MAX_CUSTOM_SLOTS) return
    setPending({ emoji: '⭐', label: '', description: '' })
  }

  function commitPending() {
    if (!pending || !pending.label.trim()) return
    const key = `custom_${Date.now().toString(36)}`
    onChange([
      ...slots,
      { key, label: pending.label.trim(), emoji: pending.emoji || '⭐', description: pending.description.trim(), is_custom: true },
    ])
    setPending(null)
  }

  function updateCustomSlot(key, patch) {
    onChange(slots.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  function removeCustomSlot(key) {
    onChange(slots.filter((s) => s.key !== key))
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>

      {/* Catalog grid */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            From catalog
          </Label>
          <span className="text-xs text-muted-foreground">
            {catalogCount} / {MAX_CATALOG_SLOTS} selected
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {catalog.map((item) => {
            const selected = selectedCatalogKeys.has(item.key)
            const disabled = !selected && catalogCount >= MAX_CATALOG_SLOTS
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleCatalogItem(item)}
                disabled={disabled}
                className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all ${
                  selected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : disabled
                    ? 'border-input opacity-40 cursor-not-allowed'
                    : 'border-input hover:border-primary/40 hover:bg-accent/30'
                }`}
              >
                <span className="text-base shrink-0 mt-0.5">{item.emoji}</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold leading-tight">{item.label}</p>
                  <p className="text-2xs text-muted-foreground mt-0.5 leading-tight">
                    {item.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Custom slots */}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-baseline justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Custom slots
          </Label>
          <span className="text-xs text-muted-foreground">
            {customSlots.length} / {MAX_CUSTOM_SLOTS}
          </span>
        </div>
        {customSlots.length === 0 && !pending && (
          <p className="text-xs text-muted-foreground italic">
            No custom slots. Add one if the catalog doesn&rsquo;t cover what you need.
          </p>
        )}
        {customSlots.map((slot) => (
          <div
            key={slot.key}
            className="flex items-start gap-2 rounded-lg border border-input bg-muted/30 p-2.5"
          >
            <Input
              value={slot.emoji}
              onChange={(e) => updateCustomSlot(slot.key, { emoji: e.target.value.slice(0, 4) })}
              className="w-12 text-center text-base h-8 shrink-0"
              maxLength={4}
              aria-label="Emoji"
            />
            <div className="flex-1 min-w-0 space-y-1">
              <Input
                value={slot.label}
                onChange={(e) => updateCustomSlot(slot.key, { label: e.target.value })}
                placeholder="Label (e.g. Equine owners)"
                maxLength={60}
                className="h-8 text-xs font-semibold"
              />
              <Input
                value={slot.description}
                onChange={(e) => updateCustomSlot(slot.key, { description: e.target.value })}
                placeholder="Short description (shown beneath the label)"
                maxLength={120}
                className="h-8 text-2xs text-muted-foreground"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeCustomSlot(slot.key)}
              className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label="Remove custom slot"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}

        {/* Pending (uncommitted) row */}
        {pending && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5">
            <Input
              value={pending.emoji}
              onChange={(e) => setPending(p => ({ ...p, emoji: e.target.value.slice(0, 4) }))}
              className="w-12 text-center text-base h-8 shrink-0"
              maxLength={4}
              aria-label="Emoji"
            />
            <div className="flex-1 min-w-0 space-y-1">
              <Input
                value={pending.label}
                onChange={(e) => setPending(p => ({ ...p, label: e.target.value }))}
                placeholder="Label (e.g. Equine owners)"
                maxLength={60}
                className="h-8 text-xs font-semibold"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') commitPending(); if (e.key === 'Escape') setPending(null) }}
              />
              <Input
                value={pending.description}
                onChange={(e) => setPending(p => ({ ...p, description: e.target.value }))}
                placeholder="Short description (shown beneath the label)"
                maxLength={120}
                className="h-8 text-2xs text-muted-foreground"
                onKeyDown={(e) => { if (e.key === 'Enter') commitPending(); if (e.key === 'Escape') setPending(null) }}
              />
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Button
                type="button"
                size="sm"
                onClick={commitPending}
                disabled={!pending.label.trim()}
                className="h-8 text-xs px-2"
              >
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPending(null)}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {!pending && customSlots.length < MAX_CUSTOM_SLOTS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openPendingRow}
            className="text-xs"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add custom slot
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Per-clinician voice memory (P1-H) ────────────────────────────────────────

function VoiceMemorySection({ interviewerName }) {
  const { data: clinicians = [], isLoading } = useClinicians()

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-4">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-base mt-0.5">🎙</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-indigo-900">Per-clinician voice memory</p>
          <p className="text-xs text-indigo-700 mt-0.5">
            As clinicians edit AI drafts, {interviewerName} learns how each person writes — phrases
            they keep, ones they cut, the way they naturally say things. These fingerprints
            sharpen every future draft for that clinician.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-2 pl-7">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
          <span className="text-xs text-indigo-600">Loading clinicians…</span>
        </div>
      ) : clinicians.length === 0 ? (
        <p className="text-xs text-indigo-600 pl-7">No clinicians yet — add one to start building voice memory.</p>
      ) : (
        <ul className="space-y-1 pl-7">
          {clinicians.map(c => {
            const hasNotes = !!(c.voice_notes || '').trim()
            return (
              <li key={c.id}>
                <Link
                  to={`/clinician/${c.id}`}
                  className="flex items-center gap-2.5 py-1 group"
                >
                  <ClinicianChip id={c.id} name={c.name} size="sm" showName nameClassName="text-xs text-indigo-800 group-hover:text-indigo-950" />
                  <span className={`text-3xs font-medium px-1.5 py-0.5 rounded-full ${hasNotes ? 'bg-indigo-200 text-indigo-800' : 'bg-indigo-100/60 text-indigo-500'}`}>
                    {hasNotes ? 'voice notes' : 'no notes yet'}
                  </span>
                  <ChevronRight className="h-3 w-3 text-indigo-400 group-hover:text-indigo-700 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Working summary callout (P0-E) ───────────────────────────────────────────

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

function WorkingSummaryCallout({ form, interviewerName }) {
  const summary = buildWorkingSummary(form, interviewerName)
  function scrollToVoiceContext(e) {
    e.preventDefault()
    document.getElementById('voice-context-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">
          {interviewerName}&apos;s working summary
        </p>
        <a
          href="#voice-context-anchor"
          onClick={scrollToVoiceContext}
          className="inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900"
        >
          <Pencil className="h-3 w-3" /> Edit
        </a>
      </div>
      {summary ? (
        <p className="text-sm text-foreground mt-1.5 leading-relaxed">{summary}</p>
      ) : (
        <p className="text-sm italic text-foreground/70 mt-1.5 leading-relaxed">
          {interviewerName} hasn&apos;t learned your voice yet — fill in the sections below and he&apos;ll mirror it back.
        </p>
      )}
    </div>
  )
}

// ── Preview Bernard's voice card (P1-F) ──────────────────────────────────────

function PreviewBernardCard({ interviewerName }) {
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
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Preview {interviewerName}&apos;s voice</p>
            <p className="text-xs text-muted-foreground mt-0.5">See a sample opener given the current settings.</p>
          </div>
          <Button onClick={generate} disabled={loading} size="sm" className="shrink-0 gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {loading ? 'Generating preview…' : 'Try a preview'}
          </Button>
        </div>
        {opener && (
          <blockquote className="border-l-2 border-primary/40 pl-3 text-base italic text-foreground/80 leading-relaxed">
            &ldquo;{opener}&rdquo;
            <footer className="mt-1 text-xs not-italic text-muted-foreground">— {interviewerName}</footer>
          </blockquote>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  )
}

