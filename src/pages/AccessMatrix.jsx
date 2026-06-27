// OWNER_ROLE_COLORS: uses --owner-accent CSS tokens from index.css
// These are the owner-role accent values. No design token exists yet — tracked in audit-2026-06-09.
// When a --role-owner token is added to src/index.css, replace these literals.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { Shield, Lock, Check, Minus, AlertTriangle, UserCheck, GitMerge, UserPlus } from 'lucide-react'
import { apiFetch } from '../lib/api.js'
import { useAppMutation } from '../lib/useAppMutation.js'
import { useConfirm } from '@/lib/useConfirm'
import { toast } from '../lib/toast'
import { useWorkspace } from '../lib/WorkspaceContext'
import { usePermission } from '../lib/usePermission.js'
import {
  CAPABILITY_GROUPS,
  OWNER_ONLY_CAPABILITIES,
  capabilityShortLabel,
  capabilityLabel,
} from '../lib/capabilities.js'

const TIER_PILL = {
  owner:     'bg-[hsl(var(--owner-accent-bg))] text-[hsl(var(--owner-accent))] ring-1 ring-[hsl(var(--owner-accent-border))]',
  producer:  'bg-scheduled/10 text-scheduled',
  clinician: 'bg-info/10 text-info',
  viewer:    'bg-muted text-muted-foreground',
}
const TIER_LABEL = { owner: '★ Owner', producer: 'Producer', clinician: 'Clinician', viewer: 'Viewer' }

const AVATAR_COLORS = ['#0b111e', '#058ac7', '#7c3aed', '#6366f1', '#0284c7', '#059669', '#d97706']
function avatarFor(person, i) {
  const initials = (person.name || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return { initials: initials || '?', color: AVATAR_COLORS[i % AVATAR_COLORS.length] }
}

export default function AccessMatrix() {
  const ws = useWorkspace()
  const { has } = usePermission()
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  const { data, isLoading, error } = useQuery({
    queryKey: ['access-matrix'],
    queryFn: () => apiFetch('/api/workspace/access-matrix'),
    enabled: has('members.invite'),
  })

  // Local, editable overrides keyed by staff id: { [id]: { [cap]: bool } }
  const [localOverrides, setLocalOverrides] = useState({})
  const seededRef = useRef(false)

  const staff = useMemo(() => data?.staff || [], [data])

  useEffect(() => {
    if (seededRef.current || !staff.length) return
    const seed = {}
    for (const s of staff) seed[s.id] = { ...(s.capability_overrides || {}) }
    setLocalOverrides(seed)
    seededRef.current = true
  }, [staff])

  // Per-person dirty check vs the server's original overrides.
  const dirtyIds = useMemo(() => {
    const set = new Set()
    for (const s of staff) {
      const orig = JSON.stringify(s.capability_overrides || {})
      const local = JSON.stringify(localOverrides[s.id] || {})
      if (orig !== local) set.add(s.id)
    }
    return set
  }, [staff, localOverrides])

  const saveMutation = useAppMutation({
    mutationFn: async (ids) => {
      await Promise.all(
        ids.map((id) =>
          apiFetch('/api/staff/capabilities', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, overrides: localOverrides[id] || {} }),
          })
        )
      )
    },
    errorMessage: 'Could not save permissions',
    onSuccess: () => {
      toast.success('Permissions saved')
      seededRef.current = false // re-seed from the refetched server state
      queryClient.invalidateQueries({ queryKey: ['access-matrix'] })
    },
  })

  // Reconciliation actions (claim a stranded proxy / merge a split). Owner-only;
  // the endpoint re-gates on members.invite.
  const reconcileMutation = useAppMutation({
    mutationFn: (payload) =>
      apiFetch('/api/staff/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    errorMessage: 'Could not reconcile',
    onSuccess: (_data, payload) => {
      toast.success(payload?.action === 'merge' ? 'Profiles merged' : 'Profile claimed')
      queryClient.invalidateQueries({ queryKey: ['access-matrix'] })
    },
  })

  const reconciliation = data?.reconciliation || null

  if (!has('members.invite')) return <Navigate to="/settings" replace />

  // ── cell state resolution ──────────────────────────────────────────────────
  function cellState(person, cap) {
    const isOwner = person.permission_tier === 'owner'
    const tierDefault = (person.tier_capabilities || []).includes(cap)
    const ovr = localOverrides[person.id]?.[cap]
    const hasOverride = ovr !== undefined
    const effective = hasOverride ? ovr : tierDefault
    const ownerOnly = OWNER_ONLY_CAPABILITIES.has(cap)
    const locked = isOwner || ownerOnly
    const clickable = !person.pending && !person.is_self && !isOwner && !ownerOnly
    return { effective, hasOverride, locked, clickable, isOwner, tierDefault }
  }

  function toggleCap(person, cap) {
    const { clickable, effective, tierDefault } = cellState(person, cap)
    if (!clickable) return
    setLocalOverrides((prev) => {
      const next = { ...prev }
      const personOvr = { ...(next[person.id] || {}) }
      const newState = !effective
      if (newState === tierDefault) delete personOvr[cap]
      else personOvr[cap] = newState
      next[person.id] = personOvr
      return next
    })
  }

  function resetPerson(id) {
    setLocalOverrides((prev) => ({ ...prev, [id]: {} }))
  }

  function resetAll() {
    setLocalOverrides((prev) => {
      const next = {}
      for (const id of Object.keys(prev)) next[id] = {}
      return next
    })
  }

  const wsName = ws?.display_name || ws?.name || 'Workspace'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <p className="text-2xs text-muted-foreground/40">Settings &middot; {wsName} &middot; Access matrix</p>
        <h1 className="text-2xl font-bold tracking-tight mt-0.5 flex items-center">
          <span className="nx-rail" aria-hidden="true" />
          Team access matrix
        </h1>
        <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed max-w-2xl">
          One row per person, one column per capability. Click any cell to grant or revoke.
          An <span className="text-action font-semibold">amber dot</span> marks a cell that differs from the tier default for that person &mdash;
          easy to spot custom access as the team grows.
        </p>
      </div>

      {/* Scale note */}
      <div className="rounded-xl border border-[hsl(var(--owner-accent-border))] bg-[hsl(var(--owner-accent-bg))] px-4 py-3.5 flex items-start gap-3">
        <Shield className="h-4 w-4 text-[hsl(var(--owner-accent))] shrink-0 mt-0.5" />
        <p className="text-2xs text-[hsl(var(--owner-accent-muted))] leading-relaxed">
          <b>Built to grow.</b> At 3 people, tiers are enough. At 10, a blanket rule like all-clinicians-get-everything breaks down &mdash;
          one publishes, another does not, a new hire sits in between. This matrix shows the
          <em> actual</em> per-person state, so nobody has to guess who can do what.
        </p>
      </div>

      {/* Reconciliation — drift between who can log in (Clerk) and who is talent (staff) */}
      {!isLoading && !error && reconciliation && (
        <ReconciliationPanel
          reconciliation={reconciliation}
          busy={reconcileMutation.isPending}
          onClaim={(staffId, userId) => reconcileMutation.mutate({ action: 'claim', staffId, userId })}
          onMerge={async (sourceId, targetId, label) => {
            const ok = await confirm({
              title: `Merge ${label}?`,
              description: `All interviews, voice phrases, and learning move to the kept profile. The duplicate is removed. This can't be undone.`,
              confirmLabel: 'Merge',
              variant: 'destructive',
            })
            if (ok) reconcileMutation.mutate({ action: 'merge', sourceId, targetId })
          }}
        />
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <Legend swatch="bg-agreement-signal/10 text-agreement-signal" icon={<Check className="h-3 w-3" />} label="tier default on" />
        <Legend swatch="bg-[hsl(var(--owner-accent-bg))] text-[hsl(var(--owner-accent))] ring-1 ring-[hsl(var(--owner-accent-border))]" icon={<Check className="h-3 w-3" />} label="custom grant" />
        <Legend swatch="bg-muted/20 text-muted-foreground/30" icon={<Minus className="h-3 w-3" />} label="off" />
        <Legend swatch="bg-card ring-1 ring-border text-muted-foreground" icon={<Lock className="h-2.5 w-2.5" />} label="owner-only" />
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-action inline-block" /> custom override</span>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground py-8 text-center">Loading team&hellip;</div>}
      {error && <div className="text-sm text-destructive py-8 text-center">Could not load the access matrix. Try refreshing.</div>}

      {/* Matrix */}
      {!isLoading && !error && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="border-collapse w-max min-w-full text-sm">
            <caption className="sr-only">Access permissions by role and capability</caption>
            <thead className="sticky top-0 z-10">
              {/* group row */}
              <tr>
                <th scope="col" className="sticky left-0 z-20 bg-card border-b border-border min-w-[220px]" />
                {CAPABILITY_GROUPS.map((g) => (
                  <th
                    key={g.label}
                    scope="col"
                    colSpan={g.caps.length}
                    className="text-3xs font-bold uppercase tracking-wider text-muted-foreground text-center px-2 py-2.5 border-b-2 border-border border-l-2 border-l-border bg-card"
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              {/* capability header row */}
              <tr>
                <th scope="col" className="sticky left-0 z-20 bg-card border-b-2 border-border border-r-2 border-r-border min-w-[220px]" />
                {CAPABILITY_GROUPS.map((g) =>
                  g.caps.map((cap, i) => (
                    <th
                      key={cap}
                      scope="col"
                      title={capabilityLabel(cap)}
                      className={`bg-card border-b-2 border-border align-bottom px-1 pb-2 h-[110px] ${i === 0 ? 'border-l-2 border-l-border' : 'border-r border-r-border/50'}`}
                    >
                      <span
                        className="text-2xs font-semibold text-foreground inline-block whitespace-nowrap rotate-180"
                        style={{ writingMode: 'vertical-rl' }}
                      >
                        {capabilityShortLabel(cap)}
                      </span>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {staff.map((person, idx) => {
                const av = avatarFor(person, idx)
                return (
                  <tr key={person.id} className="group">
                    {/* person cell */}
                    <td className="sticky left-0 z-10 bg-card group-hover:bg-muted/20 border-b border-border border-r-2 border-r-border px-4 py-2.5 min-w-[220px]">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="inline-flex items-center justify-center rounded-full text-white font-bold text-2xs shrink-0 w-8 h-8"
                          style={{ background: av.color, opacity: person.pending ? 0.5 : 1 }}
                        >
                          {av.initials}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-xs leading-tight flex items-center gap-1.5 truncate">
                            <span className={person.pending ? 'opacity-60' : ''}>{person.name}</span>
                            {person.is_self && <span className="text-3xs text-muted-foreground">&middot; you</span>}
                            {person.pending && <span className="px-1.5 py-px rounded-full text-3xs font-bold bg-action/10 text-action">invite pending</span>}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className={`px-2 py-px rounded-full text-3xs font-bold ${TIER_PILL[person.permission_tier] || TIER_PILL.viewer}`}>
                              {TIER_LABEL[person.permission_tier] || person.permission_tier}
                            </span>
                            {dirtyIds.has(person.id) && (
                              <button onClick={() => resetPerson(person.id)} className="text-3xs text-[hsl(var(--owner-accent))] hover:underline">reset</button>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* capability cells */}
                    {CAPABILITY_GROUPS.map((g) =>
                      g.caps.map((cap, i) => {
                        const st = cellState(person, cap)
                        return (
                          <td
                            key={cap}
                            className={`text-center border-b border-border group-hover:bg-muted/20 h-[52px] ${i === 0 ? 'border-l-2 border-l-border' : 'border-r border-r-border/50'}`}
                          >
                            <Cell person={person} st={st} onClick={() => toggleCap(person, cap)} />
                          </td>
                        )
                      })
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Save bar */}
      {!isLoading && !error && (
        <div className="sticky bottom-0 z-20 -mx-6 md:mx-0 px-4 py-3 flex items-center gap-3 border md:rounded-lg border-x-0 md:border-x border-border bg-background/90 backdrop-blur">
          {dirtyIds.size > 0 ? (
            <span className="text-xs text-action font-semibold flex items-center gap-1.5">
              {dirtyIds.size} {dirtyIds.size === 1 ? 'person' : 'people'} changed
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No unsaved changes.</span>
          )}
          <span className="flex-1 text-xs text-muted-foreground hidden md:inline">Changes take effect on the next session for that person.</span>
          <button onClick={resetAll} className="px-3.5 py-2 rounded-[10px] text-xs font-semibold border border-border bg-card text-foreground hover:bg-muted/40" disabled={saveMutation.isPending}>
            Reset all to defaults
          </button>
          <button
            onClick={() => saveMutation.mutate([...dirtyIds])}
            disabled={dirtyIds.size === 0 || saveMutation.isPending}
            className="px-4 py-2 rounded-[10px] text-xs font-semibold text-primary-foreground disabled:opacity-50 bg-primary"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}

function Legend({ swatch, icon, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-flex items-center justify-center rounded-full w-5 h-5 ${swatch}`}>{icon}</span>
      {label}
    </span>
  )
}

function Cell({ person, st, onClick }) {
  if (person.pending) {
    return <span className="inline-flex items-center justify-center rounded-full bg-muted/30 text-muted-foreground/30 w-[30px] h-[30px]" title="Not yet accepted invite"><Minus className="h-3.5 w-3.5" /></span>
  }
  if (st.locked) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full bg-card ring-1 ring-border text-muted-foreground w-[30px] h-[30px]"
        title={st.isOwner ? 'Owner always has access' : 'Owner-only — cannot be granted to other tiers'}
      >
        <Lock className="h-3 w-3" />
      </span>
    )
  }
  let cls
  if (st.hasOverride && st.effective) cls = 'bg-[hsl(var(--owner-accent-bg))] text-[hsl(var(--owner-accent))] ring-2 ring-[hsl(var(--owner-accent-border))]'
  else if (st.effective) cls = 'bg-agreement-signal/10 text-agreement-signal'
  else cls = 'bg-muted/20 text-muted-foreground/30'
  const icon = st.effective ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Minus className="h-3.5 w-3.5" aria-hidden="true" />
  const ariaLabel = person.is_self
    ? 'You cannot change your own access'
    : st.hasOverride
      ? (st.effective ? 'Custom grant (tier default: off)' : 'Custom revoke (tier default: on)')
      : (st.effective ? 'On — tier default' : 'Off — tier default')

  return (
    <button
      onClick={onClick}
      disabled={!st.clickable}
      className={`relative inline-flex items-center justify-center rounded-full transition w-[30px] h-[30px] ${cls} ${st.clickable ? 'hover:scale-110 cursor-pointer' : 'cursor-default'}`}
      title={ariaLabel}
      aria-label={ariaLabel}
    >
      {icon}
      {st.hasOverride && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-action ring-2 ring-white" />}
    </button>
  )
}

// ── Reconciliation panel ──────────────────────────────────────────────────────
// Surfaces drift between Clerk membership (who can sign in) and the staff table
// (who is talent) so the owner can fix it from here instead of via SQL. Uses
// plain language — never "proxy"/"claim" jargon in the visible copy.
function ReconciliationPanel({ reconciliation, busy, onClaim, onMerge }) {
  const claimable = reconciliation.claimable_proxies || []
  const orphans = claimable.filter((p) => !p.has_bound_sibling)
  const splits = claimable.filter((p) => p.has_bound_sibling)
  const missing = reconciliation.members_without_staff || []
  const dups = reconciliation.duplicate_emails || []

  // Two real logins for one person (every row already bound) — not covered by
  // the claimable list. Surfaced as a keep-which-one merge choice.
  const doubleBound = dups.filter((d) => d.staff.length > 1 && d.staff.every((r) => r.user_id))

  const total = orphans.length + splits.length + missing.length + doubleBound.length

  // Couldn't reach Clerk and nothing flagged from the table alone → stay quiet.
  if (!reconciliation.members_checked && total === 0) return null

  if (total === 0) {
    return (
      <div className="rounded-xl border border-agreement-signal/20 bg-agreement-signal/10 px-4 py-3 flex items-center gap-2.5">
        <UserCheck className="h-4 w-4 text-agreement-signal shrink-0" />
        <p className="text-2xs text-success">
          <b>All reconciled.</b> Everyone who can sign in has exactly one profile here — no strays, no duplicates.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3.5 space-y-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="h-4 w-4 text-action shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-bold text-[hsl(var(--owner-accent-muted))]">
            {total} {total === 1 ? 'profile needs' : 'profiles need'} attention
          </p>
          <p className="text-2xs text-[hsl(var(--owner-accent-muted))]/80 mt-0.5 leading-relaxed">
            Two lists never sync on their own: who can <b>sign in</b> (your invites) and who is <b>talent</b> here
            (interviewable, voice-learned). These drifted apart — link or merge to line them back up.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        {orphans.map((p) => (
          <ReconRow
            key={`claim-${p.staff_id}`}
            icon={<UserCheck className="h-3.5 w-3.5 text-info" />}
            text={<><b>{p.name || p.email}</b> has recordings but isn&rsquo;t linked to <b>{p.member_name || p.email}</b>&rsquo;s login yet.</>}
            action={
              <ReconBtn busy={busy} onClick={() => onClaim(p.staff_id, p.member_user_id)} kind="primary">
                <UserCheck className="h-3 w-3" /> Link to login
              </ReconBtn>
            }
          />
        ))}

        {splits.map((p) => (
          <ReconRow
            key={`split-${p.staff_id}`}
            icon={<GitMerge className="h-3.5 w-3.5 text-[hsl(var(--owner-accent))]" />}
            text={<><b>{p.name || p.email}</b> is split across two profiles — their learning sits on a stray copy.</>}
            action={
              <ReconBtn busy={busy} onClick={() => onMerge(p.staff_id, p.bound_sibling_id, p.name || p.email)} kind="warn">
                <GitMerge className="h-3 w-3" /> Merge into login
              </ReconBtn>
            }
          />
        ))}

        {doubleBound.map((d) => (
          <div key={`dup-${d.email}`} className="rounded-lg bg-white/70 ring-1 ring-warning/30 px-3 py-2">
            <p className="text-2xs text-[hsl(var(--owner-accent-muted))] flex items-center gap-1.5">
              <GitMerge className="h-3.5 w-3.5 text-[hsl(var(--owner-accent))] shrink-0" />
              <span><b>{d.email}</b> has two active profiles. Keep one — its data absorbs the other:</span>
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1.5 pl-5">
              {d.staff.map((keep) => {
                const remove = d.staff.find((r) => r.id !== keep.id)
                if (!remove) return null
                return (
                  <ReconBtn key={keep.id} busy={busy} onClick={() => onMerge(remove.id, keep.id, remove.name || d.email)} kind="warn">
                    Keep &ldquo;{keep.name}&rdquo;
                  </ReconBtn>
                )
              })}
            </div>
          </div>
        ))}

        {missing.map((m) => (
          <ReconRow
            key={`missing-${m.user_id}`}
            icon={<UserPlus className="h-3.5 w-3.5 text-muted-foreground" />}
            text={<><b>{m.name || m.email}</b> can sign in but has no profile yet — it appears automatically the next time they open the app.</>}
            action={<span className="text-3xs text-muted-foreground italic px-2">no action needed</span>}
          />
        ))}
      </div>
    </div>
  )
}

function ReconRow({ icon, text, action }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white/70 ring-1 ring-warning/30 px-3 py-2">
      <span className="text-2xs text-[hsl(var(--owner-accent-muted))] flex items-center gap-1.5 min-w-0">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{text}</span>
      </span>
      <span className="shrink-0">{action}</span>
    </div>
  )
}

function ReconBtn({ children, onClick, busy, kind }) {
  const cls =
    kind === 'primary'
      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
      : kind === 'warn'
        ? 'bg-[hsl(var(--owner-accent))] text-white hover:bg-[hsl(var(--owner-accent-muted))]'
        : 'bg-card text-foreground ring-1 ring-border hover:bg-muted/50'
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-3xs font-bold disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  )
}
