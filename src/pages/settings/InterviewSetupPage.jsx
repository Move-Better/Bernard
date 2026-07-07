// Interview setup — everything that controls what happens when a staff
// member starts an interview:
//
//   topic_suggestions   — the live topic catalog (add/edit/delete topics)
//   audience_options    — "who is this for?" picker options
//   story_type_options  — "what kind of piece?" picker options
//   interview_context   — per-condition steering briefs (Advanced, rarely edited)
//
// Patient archetypes and voice/brand config live on the sibling "Your voice"
// page (/settings/workspace/voice). Voice memory roster here is read-only
// nav — edits live on each staff member's profile.

import { useState, useEffect } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useSmartBack } from '@/lib/useSmartBack'
import { Loader2, ArrowLeft, ChevronDown, ChevronUp, Mic, ChevronRight, Sliders } from 'lucide-react'
import { Section, SaveBar } from '@/components/settings/helpers'
import { PageHeader } from '@/components/ui/PageHeader'
import { useUserRole } from '@/lib/useUserRole'
import { usePermission } from '@/lib/usePermission'
import { CAP_SETTINGS_EDIT } from '@/lib/capabilities'
import { useUnsavedChanges } from '@/lib/useUnsavedChanges'
import { useSaveShortcut } from '@/lib/useSaveShortcut'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useStaff } from '@/lib/queries'
import { apiFetch } from '@/lib/api'
import { StaffChip } from '@/components/StaffChip'
import { SlotEditor } from '@/components/settings/SlotEditor'
import { TopicSuggestionsEditor } from '@/components/settings/TopicSuggestionsEditor'
import { ConditionBankEditor } from '@/components/settings/ConditionBankEditor'
import {
  AUDIENCE_CATALOG,
  STORY_TYPE_CATALOG,
} from '@/lib/interviewOptionsCatalog'

function formFromWorkspace(ws) {
  return {
    topic_suggestions_json: JSON.stringify(ws.topic_suggestions ?? [], null, 2),
    interview_context_json: JSON.stringify(ws.interview_context ?? {}, null, 2),
    audience_options:       Array.isArray(ws.audience_options)   ? ws.audience_options   : [],
    story_type_options:     Array.isArray(ws.story_type_options) ? ws.story_type_options : [],
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

export default function InterviewSetupPage() {
  useDocumentTitle('Settings — Interview setup')
  const goBack = useSmartBack('/settings/workspace/voice')
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
    try {
      const ts = tryParseJson(form.topic_suggestions_json, [])
      const ic = tryParseJson(form.interview_context_json, {})
      if (!ts.ok) { setError(`Topic suggestions JSON: ${ts.error}`); setSaving(false); return }
      if (!ic.ok) { setError(`Condition bank JSON: ${ic.error}`);    setSaving(false); return }

      const updated = await apiFetch('/api/workspace/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic_suggestions: ts.value,
          interview_context: ic.value,
          audience_options:   form.audience_options,
          story_type_options: form.story_type_options,
        }),
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
  if (role !== 'admin' || !has(CAP_SETTINGS_EDIT)) return <Navigate to="/" replace />
  if (!ws) return (
    <div className="py-16 text-center text-sm text-muted-foreground">
      Workspace settings are only available on a <code className="font-mono text-xs">*.withbernard.ai</code> deployment.
    </div>
  )

  const interviewerName = runtimeWs?.interviewer_name || ws?.interviewer_name || 'Bernard'

  return (
    <div className="space-y-8">
      {/* Heading */}
      <div>
        <div className="flex items-center justify-between">
          <p className="text-2xs text-muted-foreground/80">
            Settings · {interviewerName} · Interview setup
          </p>
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back: Your voice
          </button>
        </div>
        <PageHeader
          className="mt-0.5 mb-0"
          icon={Sliders}
          title="Interview setup"
          subtitle={`What ${interviewerName} asks about and what options appear when a staff member starts an interview.`}
        />
      </div>

      {/* Topic catalog — the live, ongoing piece */}
      <Section
        title="Topic catalog"
        description={`The subjects ${interviewerName} can probe. These appear as suggestions when starting an interview and drive the editorial shot list. Add topics as your content areas grow.`}
      >
        <TopicSuggestionsEditor
          topicsJson={form.topic_suggestions_json}
          patientContextJson={null}
          onChange={set('topic_suggestions_json')}
        />
      </Section>

      {/* Interview pickers */}
      <Section
        title="Interview pickers"
        description={`The two choices ${interviewerName} surfaces at the start of every interview — who the piece is for and what kind of piece it is.`}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-6">
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

      {/* Voice memory roster — read-only, links to staff profiles */}
      <VoiceMemoryRoster interviewerName={interviewerName} />

      {/* Condition bank — advanced, rarely edited after onboarding */}
      <AdvancedConditionBank
        value={form.interview_context_json}
        onChange={set('interview_context_json')}
        interviewerName={interviewerName}
      />

      <SaveBar
        saving={saving} saved={saved} error={error} isDirty={isDirty}
        onSave={handleSave}
        onDiscard={() => { setForm(pristine); setError(null) }}
      />
    </div>
  )
}

// ── Voice memory roster ───────────────────────────────────────────────────────

function VoiceMemoryRoster({ interviewerName }) {
  const { data: staff = [], isLoading } = useStaff()

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-4">
      <div className="flex items-start gap-3 mb-3">
        <Mic className="h-4 w-4 mt-0.5 text-primary/70 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Per-staff voice memory</p>
          <p className="text-xs text-primary mt-0.5">
            As staff edit AI drafts, {interviewerName} learns how each person writes — phrases
            they keep, ones they cut, the way they naturally say things. Open a staff member&rsquo;s profile
            to review or add notes that sharpen every future draft for them.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div role="status" className="flex items-center gap-2 py-2 pl-7">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary/40" aria-hidden="true" />
          <span className="text-xs text-primary/60" aria-hidden="true">Loading staff…</span>
          <span className="sr-only">Loading staff…</span>
        </div>
      ) : staff.length === 0 ? (
        <p className="text-xs text-primary/60 pl-7">No staff yet — add one to start building voice memory.</p>
      ) : (
        <ul className="space-y-1 pl-7">
          {staff.map(c => {
            const hasNotes = !!(c.voice_notes || '').trim()
            return (
              <li key={c.id}>
                <Link
                  to={`/staff/${c.id}`}
                  className="flex items-center gap-2.5 py-1 group"
                >
                  <StaffChip id={c.id} name={c.name} size="sm" showName nameClassName="text-xs text-primary group-hover:text-primary" />
                  <span className={`text-3xs font-medium px-1.5 py-0.5 rounded-full ${hasNotes ? 'bg-primary/20 text-primary' : 'bg-primary/10 text-primary/50'}`}>
                    {hasNotes ? 'voice notes' : 'no notes yet'}
                  </span>
                  <ChevronRight className="h-3 w-3 text-primary/40 group-hover:text-primary ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Advanced: condition bank ──────────────────────────────────────────────────
// Collapsed by default — this was configured during onboarding and most
// users will never need to edit it directly.

function AdvancedConditionBank({ value, onChange, interviewerName }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-input bg-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-accent/20 rounded-lg"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">
            Advanced: condition bank
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Per-condition steering briefs — generated during onboarding. When an interview topic
            matches a condition key, {interviewerName} reads the matching brief to sharpen questions.
            Edit only if a condition entry needs correcting.
          </p>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        }
      </button>
      {open && (
        <div className="border-t border-input px-4 pb-4 pt-3">
          <ConditionBankEditor value={value} onChange={onChange} />
        </div>
      )}
    </div>
  )
}
