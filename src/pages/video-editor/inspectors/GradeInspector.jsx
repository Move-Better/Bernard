import { InspectorShell } from '../shared'
import { apiFetch } from '@/lib/api'
import { GRADE_SLIDERS, GRADE_VIBES } from '@/lib/gradeParams'
import { toast } from '@/lib/toast'
import { Loader2, Sparkles} from 'lucide-react'
import { useState } from 'react'

export function GradeInspector({ ctx }) {
  const { grade, setGradeKey, applyVibe, resetGrade, brandGrade, saveBrandGrade, savingBrand } = ctx
  const [vibePrompt, setVibePrompt] = useState('')
  const [proposing, setProposing] = useState(false)
  async function proposeFromText() {
    const prompt = vibePrompt.trim()
    if (!prompt || proposing) return
    setProposing(true)
    try {
      const res = await apiFetch('/api/editorial/propose-grade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
      })
      if (res?.params) { applyVibe(res.params); toast('Look applied — fine-tune below') }
      else toast('Could not read a look from that')
    } catch { toast('Describe-a-look failed') }
    finally { setProposing(false) }
  }
  return (
    <InspectorShell icon={Sparkles} title="AI Colorist — Frame grade" right="whole clip">
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Describe a look</p>
      <div className="mb-3 flex gap-1.5">
        <input
          type="text" aria-label="Describe the grade or look" value={vibePrompt}
          onChange={(e) => setVibePrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') proposeFromText() }}
          placeholder="e.g. bright, warm, clinical" disabled={proposing}
          className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-2xs outline-none focus:ring-1 focus:ring-primary/50"
          style={{ borderColor: 'hsl(var(--border))' }}
        />
        <button onClick={proposeFromText} disabled={proposing || !vibePrompt.trim()} className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-2xs font-semibold text-primary-foreground disabled:opacity-50">{proposing ? '…' : 'Apply'}</button>
      </div>
      <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Vibe presets</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => brandGrade && applyVibe(brandGrade)}
          disabled={!brandGrade}
          title={brandGrade ? 'Your saved brand look' : 'Dial in a grade, then "Save as Brand look" below'}
          className="rounded-full border border-action px-2.5 py-1 text-2xs font-medium text-action bg-action/[0.08] disabled:opacity-50"
        >★ Brand</button>
        {GRADE_VIBES.map((v) => (
          <button key={v.id} onClick={() => applyVibe(v.params)} className="rounded-full border border-border px-2.5 py-1 text-2xs text-muted-foreground">{v.label}</button>
        ))}
      </div>
      <p className="mb-2 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Fine-tune</p>
      {GRADE_SLIDERS.map((s) => (
        <div key={s.key} className="mb-2">
          <div className="mb-1 flex justify-between text-2xs text-muted-foreground"><span>{s.label}</span><span>{grade[s.key] > 0 ? '+' : ''}{grade[s.key]}</span></div>
          <input aria-label={s.label} type="range" min={-50} max={50} value={grade[s.key] || 0} onChange={(e) => setGradeKey(s.key, +e.target.value)} className="w-full" />
        </div>
      ))}
      <button onClick={saveBrandGrade} disabled={savingBrand} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-action py-2 text-2xs text-action bg-action/[0.06] disabled:opacity-60">
        {savingBrand ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span>★</span>}Save as Brand look
      </button>
      <button onClick={resetGrade} className="mt-1 w-full rounded-md py-1.5 text-2xs text-muted-foreground">Reset adjustments</button>
    </InspectorShell>
  )
}
