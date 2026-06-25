import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useUser } from '@clerk/react'
import {
  ArrowLeft, ArrowRight, Loader2, Mail, Plus, Check, Megaphone, Target, Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { getOrCreateStaff, createInterview } from '@/lib/api'
import MicCheck from '@/components/MicCheck'
import { useStaff, useCampaigns, useUpsertCampaign } from '@/lib/queries'
import { getVoiceModes } from '@/lib/prompts'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { toast } from '@/lib/toast'

// Content-style options for the inline "New goal" form. Mirrors the campaigns
// content_style enum (api/campaigns/upsert.js ALLOWED_CONTENT_STYLE).
const CONTENT_STYLES = [
  { id: 'relationship', label: 'Relationship', hint: 'Community / connection' },
  { id: 'promotional',  label: 'Promotional',  hint: 'An offer or event' },
  { id: 'referral',     label: 'Referral',     hint: 'To other providers' },
  { id: 'clinical',     label: 'Educational',  hint: 'Teach the reader' },
]

const STYLE_CHIP = {
  relationship: 'bg-accent text-accent-foreground',
  promotional:  'bg-muted text-muted-foreground',
  referral:     'bg-muted text-muted-foreground',
  clinical:     'bg-muted text-muted-foreground',
}

/**
 * NewNewsletter — the "Write a newsletter" entry surface (/new/newsletter).
 *
 * Screen 1 of the goal-steered newsletter flow: pick a reusable goal (a
 * `campaigns` row) — or create one inline — then drop into the regular voice
 * interview, which is steered toward that goal and generates an email draft on
 * completion. Reuses the full interview engine; the only new state here is the
 * goal selection, which is bound to the interview as campaign_id +
 * selected_outputs:['email'].
 */
export default function NewNewsletter() {
  useDocumentTitle('Write a newsletter')
  const navigate = useNavigate()
  const { user } = useUser()
  const workspace = useWorkspace()
  const VOICE_MODES = getVoiceModes(workspace)

  const { data: staffList = [], isLoading: staffLoading } = useStaff()
  const { data: campaigns = [], isLoading: campaignsLoading } = useCampaigns()
  const upsertCampaign = useUpsertCampaign()

  const preferredName = user?.unsafeMetadata?.display_name || user?.fullName || ''
  const [staffName, setStaffName] = useState(preferredName)
  const [voiceMode, setVoiceMode] = useState('practice')
  const [selectedGoalId, setSelectedGoalId] = useState(null)
  const [showNewGoal, setShowNewGoal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Two-step: 'form' → 'miccheck'. The interview row is created only after the
  // mic check passes (mirrors NewInterview), so an abandoned check leaves no
  // phantom interview behind.
  const [step, setStep] = useState('form')
  const pendingStartRef = useRef(null)

  useEffect(() => {
    const name = user?.unsafeMetadata?.display_name || user?.fullName || ''
    if (name && !staffName) setStaffName(name)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.unsafeMetadata?.display_name, user?.fullName])

  // Only "active" goals make sense as a target; default-select the first.
  const goals = useMemo(
    () => (Array.isArray(campaigns) ? campaigns.filter((c) => c.status !== 'archived') : []),
    [campaigns],
  )
  useEffect(() => {
    if (!selectedGoalId && goals.length > 0) setSelectedGoalId(goals[0].id)
  }, [goals, selectedGoalId])

  const selectedGoal = goals.find((g) => g.id === selectedGoalId) || null

  function handleStart() {
    if (!staffName.trim() || !selectedGoal || !user) return
    const typed = staffName.trim().toLowerCase()
    const display = (user?.unsafeMetadata?.display_name || '').trim().toLowerCase()
    const full    = (user?.fullName || '').trim().toLowerCase()
    const isSelf  = !!typed && (typed === display || typed === full)
    pendingStartRef.current = { isSelf, goal: selectedGoal }
    setError('')
    setStep('miccheck')
  }

  async function createAndStart() {
    const pending = pendingStartRef.current
    if (!pending || !user || loading) return
    setLoading(true)
    setError('')
    try {
      const staffMember = await getOrCreateStaff({
        name: staffName.trim(),
        createdById: user.id,
        createdByEmail: user.primaryEmailAddress?.emailAddress,
        userId: pending.isSelf ? user.id : undefined,
      })
      const interview = await createInterview({
        staffId: staffMember.id,
        // Topic doubles as the story title in lists; the goal name is the most
        // meaningful label for a newsletter interview.
        topic: pending.goal.name,
        ownerEmail: user.primaryEmailAddress?.emailAddress,
        voiceMode,
        campaignId: pending.goal.id,
        selectedOutputs: ['email'],
      })
      navigate(`/interview/${staffMember.id}/${interview.id}`, { state: { micChecked: true } })
    } catch (e) {
      setError(e.message)
      setLoading(false)
      setStep('form')
    }
  }

  // ── Mic-check step ────────────────────────────────────────────────────────
  if (step === 'miccheck') {
    return (
      <div className="space-y-3">
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">{error}</div>
        )}
        {loading ? (
          <div role="status" className="rounded-xl border bg-card p-10 flex flex-col items-center gap-4">
            <Loader2 className="h-7 w-7 text-primary animate-spin" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Setting up your newsletter&hellip;</p>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => { setStep('form'); pendingStartRef.current = null }}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to setup
            </button>
            <MicCheck onContinue={createAndStart} />
          </>
        )}
      </div>
    )
  }

  const matchesExistingStaff = staffList.some(
    (s) => s.name.trim().toLowerCase() === staffName.trim().toLowerCase(),
  )

  // ── Goal-picker form ──────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back">
          <Link to="/new"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center">
            <span className="inline-flex h-7 w-7 rounded-md bg-primary/10 text-primary items-center justify-center mr-2.5 shrink-0">
              <Mail className="h-4 w-4" />
            </span>
            Write a newsletter
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pick what this newsletter is for. We&apos;ll steer the conversation toward that goal, then write it in your voice.
          </p>
        </div>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">{error}</div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">What&apos;s this newsletter for?</CardTitle>
          <CardDescription>Goals are reusable — saved here and in Settings → Campaigns.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Who's talking */}
          <div className="space-y-1.5">
            <Label>Who&apos;s talking?</Label>
            {staffLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading staff…
              </div>
            ) : staffList.length > 0 ? (
              <div className="flex flex-wrap gap-2 items-center">
                {staffList.map((s) => {
                  const isSelected = staffName.trim().toLowerCase() === s.name.trim().toLowerCase()
                  const initials = s.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStaffName(s.name)}
                      className={`inline-flex items-center gap-2 rounded-full border-2 pl-1 pr-3 py-1 transition-all ${
                        isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <span className={`h-6 w-6 rounded-full text-2xs flex items-center justify-center font-semibold shrink-0 ${
                        isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                        {initials}
                      </span>
                      <span className={`text-sm font-medium ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {s.name.split(' ')[0]}
                      </span>
                    </button>
                  )
                })}
                {!matchesExistingStaff && (
                  <Input
                    placeholder="Other name…"
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    autoComplete="name"
                    className="h-8 w-36 text-xs rounded-full"
                  />
                )}
                {matchesExistingStaff && (
                  <button
                    type="button"
                    onClick={() => setStaffName('')}
                    className="text-xs text-muted-foreground hover:text-foreground rounded-full border border-dashed px-3 py-1 hover:border-primary/40"
                  >
                    Other…
                  </button>
                )}
              </div>
            ) : (
              <Input
                placeholder="e.g. Dr. Quasney"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                autoComplete="name"
              />
            )}
          </div>

          {/* Goal picker */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-primary" /> Goal</Label>
              <Link to="/settings/campaigns" className="text-2xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                <Settings className="h-3 w-3" /> Manage goals
              </Link>
            </div>

            {campaignsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading goals…
              </div>
            ) : goals.length === 0 && !showNewGoal ? (
              <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-center space-y-2">
                <p className="text-sm text-muted-foreground">No goals yet. Create one to steer the conversation.</p>
                <Button size="sm" variant="outline" onClick={() => setShowNewGoal(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> New goal
                </Button>
              </div>
            ) : (
              <div className="grid gap-2">
                {goals.map((g) => {
                  const isSel = g.id === selectedGoalId
                  const about = (g.theme_notes || g.description || '').trim()
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setSelectedGoalId(g.id)}
                      className={`text-left rounded-lg border p-3 transition-all ${
                        isSel ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-input hover:border-primary/40'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{g.name}</span>
                            {g.content_style && (
                              <span className={`text-3xs px-1.5 py-0.5 rounded-full font-semibold ${STYLE_CHIP[g.content_style] || 'bg-muted text-muted-foreground'}`}>
                                {g.content_style}
                              </span>
                            )}
                          </div>
                          {about && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{about}</p>}
                          {g.cta_label && (
                            <p className="text-2xs text-muted-foreground mt-1.5 inline-flex items-center gap-1">
                              <Megaphone className="h-3 w-3" /> CTA: <span className="font-medium text-foreground">&ldquo;{g.cta_label}&rdquo;</span>
                            </p>
                          )}
                        </div>
                        {isSel && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                      </div>
                    </button>
                  )
                })}

                {!showNewGoal && (
                  <button
                    type="button"
                    onClick={() => setShowNewGoal(true)}
                    className="w-full rounded-lg border border-dashed p-2.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary inline-flex items-center justify-center gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" /> New goal
                  </button>
                )}
              </div>
            )}

            {showNewGoal && (
              <NewGoalForm
                pending={upsertCampaign.isPending}
                onCancel={() => setShowNewGoal(false)}
                onCreate={async (payload) => {
                  try {
                    const created = await upsertCampaign.mutateAsync(payload)
                    const row = Array.isArray(created) ? created[0] : created
                    if (row?.id) setSelectedGoalId(row.id)
                    setShowNewGoal(false)
                    toast.success(`Goal "${payload.name}" saved`)
                  } catch {
                    // useUpsertCampaign surfaces the error toast (incl. 403 if
                    // this member can't edit goals — they can still pick one).
                  }
                }}
              />
            )}
          </div>

          {/* Whose voice */}
          <div className="space-y-1.5">
            <Label className="text-sm">Whose voice is this newsletter in?</Label>
            <div className="grid grid-cols-2 gap-2">
              {VOICE_MODES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setVoiceMode(opt.id)}
                  className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all ${
                    voiceMode === opt.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-input hover:border-primary/40 hover:bg-accent/30'
                  }`}
                >
                  <span className="text-base shrink-0 mt-0.5">{opt.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold leading-tight">{opt.label}</p>
                    {opt.description && <p className="text-2xs text-muted-foreground mt-0.5 leading-tight">{opt.description}</p>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleStart}
            disabled={!staffName.trim() || !selectedGoal || loading}
            className="w-full"
            size="lg"
          >
            Start the conversation
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
          <p className="text-2xs text-muted-foreground text-center">You can change the goal mid-conversation.</p>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Inline "New goal" form ───────────────────────────────────────────────────
function NewGoalForm({ onCreate, onCancel, pending }) {
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [contentStyle, setContentStyle] = useState('relationship')
  const [ctaLabel, setCtaLabel] = useState('')

  function submit() {
    if (!name.trim()) return
    onCreate({
      name: name.trim(),
      theme_notes: about.trim() || undefined,
      content_style: contentStyle,
      cta_label: ctaLabel.trim() || undefined,
      status: 'active',
    })
  }

  return (
    <div className="mt-2 rounded-lg border bg-card p-3 space-y-3">
      <Input placeholder="Goal name — e.g. &quot;Community outreach — sponsor patients' causes&quot;" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <textarea
        aria-label="Campaign goal description"
        rows={2}
        placeholder="What's it about? (woven into the conversation + the copy)"
        value={about}
        onChange={(e) => setAbout(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          aria-label="Content style"
          value={contentStyle}
          onChange={(e) => setContentStyle(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {CONTENT_STYLES.map((s) => (
            <option key={s.id} value={s.id}>{s.label} — {s.hint}</option>
          ))}
        </select>
        <Input placeholder="CTA — “Nominate a cause”" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={!name.trim() || pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save goal'}
        </Button>
      </div>
    </div>
  )
}
