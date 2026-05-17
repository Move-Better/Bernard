// Edits the "non-prototype" half of workspace.patient_context — the
// summary blurb, the primary avatar, and prior-provider pain points.
// PrototypeCard/ArchetypeCardsSection handle the prototypes[] array
// from the same JSONB column and live in PatientArchetypes.jsx.

import { Label } from '@/components/ui/label'
import { Textarea2 } from '@/components/settings/helpers'

export function PatientContextEditor({ value, onChange, interviewerName = 'Bernard' }) {
  let parsed = null
  let parseError = null
  try {
    if (value && value.trim()) parsed = JSON.parse(value)
  } catch (e) {
    parseError = e.message
  }

  if (parseError) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive">JSON parse error — editing as raw JSON until fixed: {parseError}</p>
        <Textarea2 label="Patient context (raw JSON)" value={value} onChange={onChange} rows={14} mono />
      </div>
    )
  }

  const pc = parsed ?? {}

  function update(patch) {
    onChange(JSON.stringify({ ...pc, ...patch }, null, 2))
  }

  const painPointsText = (pc.priorProviderPainPoints || []).join('\n')

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Textarea2
          label="Patient summary"
          value={pc.summaryBlurb || ''}
          onChange={v => update({ summaryBlurb: v })}
          rows={3}
          hint={`One paragraph ${interviewerName} uses to orient tone and framing across all content.`}
        />
        <PrimaryAvatarEditor
          value={pc.primaryAvatar}
          onChange={v => update({ primaryAvatar: v })}
          interviewerName={interviewerName}
        />
      </div>

      <Textarea2
        label="What patients often say went wrong before"
        value={painPointsText}
        onChange={v => update({ priorProviderPainPoints: v.split('\n').map(l => l.trim()).filter(Boolean) })}
        rows={4}
        hint={`One per line. ${interviewerName} uses these to frame "what this clinic does differently."`}
      />
    </div>
  )
}

function PrimaryAvatarEditor({ value, onChange, interviewerName }) {
  const isObject = value != null && typeof value === 'object' && !Array.isArray(value)
  if (!isObject) {
    return (
      <Textarea2
        label="Primary avatar"
        value={typeof value === 'string' ? value : ''}
        onChange={onChange}
        rows={3}
        hint={`The archetypal patient in plain language — who ${interviewerName} is always writing for.`}
      />
    )
  }

  const av = value
  const update = (patch) => onChange({ ...av, ...patch })
  const listFields = ['fears', 'beliefs', 'painPoints', 'demographics']

  return (
    <div className="rounded-lg border border-input bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Primary avatar</Label>
        <span className="text-3xs text-muted-foreground italic">structured</span>
      </div>
      <div>
        <Label className="text-xs mb-1 block">Name</Label>
        <input
          className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={av.name || ''}
          onChange={e => update({ name: e.target.value })}
          placeholder="e.g. The Frustrated Active Adult"
        />
      </div>
      <Textarea2
        label="Their story"
        value={av.story || ''}
        onChange={v => update({ story: v })}
        rows={4}
        hint="A short narrative of where this patient is coming from."
      />
      <Textarea2
        label="What they want"
        value={av.whatTheyWant || ''}
        onChange={v => update({ whatTheyWant: v })}
        rows={3}
        hint="The outcome this patient is reaching for."
      />
      <details className="rounded border border-input">
        <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:bg-accent/30 list-none">
          ▾ Fears, beliefs, pain points, demographics (one per line)
        </summary>
        <div className="p-3 pt-0 space-y-3">
          {listFields.map((key) => {
            const arr = Array.isArray(av[key]) ? av[key] : []
            return (
              <Textarea2
                key={key}
                label={key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                value={arr.join('\n')}
                onChange={v => update({ [key]: v.split('\n').map(s => s.trim()).filter(Boolean) })}
                rows={3}
              />
            )
          })}
        </div>
      </details>
    </div>
  )
}
