// Reel template library — browse, rename, delete, and choose which look new
// reels use. Deliberately NOT a second editor: templates are authored by
// dialling a look in on a real clip and hitting "Save as reel template" in the
// video editor, which is what keeps what-you-approved identical to what bakes.
// This page manages the set; it never restyles one.
//
// Selection writes workspaces.reel_preset. That is the field reelFactory reads
// FIRST (pin → the workspace's default row → built-in hook_card), so a UI that
// set is_default instead would appear to work and change nothing.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@clerk/react'
import { Check, Loader2, Trash2, Pencil, Film, AlertCircle } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useAppMutation } from '@/lib/useAppMutation'
import { toast } from '@/lib/toast'

// Plain-language summary of what a config actually does, so the list is
// readable without opening anything.
function describe(t) {
  const bits = []
  if (t.headline?.role) {
    bits.push(t.headline.role === 'hook_card' ? 'Headline in an inset card' : 'Headline on the frame')
    bits.push(t.headline.hold === 'reading' ? 'held for reading time' : `held ${t.headline.hold}s`)
  } else {
    bits.push('No headline')
  }
  if (t.captions?.enabled === false) bits.push('captions off')
  else {
    const size = t.captions.sizeScale >= 1.3 ? 'large' : t.captions.sizeScale <= 0.8 ? 'small' : 'medium'
    bits.push(`${size} captions ${t.captions.position === 'center' ? 'centred' : `at the ${t.captions.position}`}`)
    if (t.captions.style !== 'bold') bits.push(t.captions.style.replace(/_/g, ' '))
  }
  return bits.join(' · ')
}

export default function VideoTemplates() {
  const { getToken } = useAuth()
  const queryClient = useQueryClient()
  const [renaming, setRenaming] = useState(null)   // template id
  const [renameText, setRenameText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['video-templates'],
    queryFn: () => apiFetch('/api/video-templates'),
  })

  const templates = data?.templates || []
  const pinned = data?.pinned || null
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['video-templates'] })

  async function patch(path, body) {
    const token = await getToken()
    const r = await fetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'save-failed')
    return r.json()
  }

  const useMutationFor = useAppMutation({
    mutationFn: (id) => patch('/api/workspace/me', { reel_preset: id }),
    onSuccess: () => { refresh(); toast('New reels will use this look.') },
  })

  const renameMutation = useAppMutation({
    mutationFn: ({ id, name }) => patch(`/api/video-templates/${id}`, { name }),
    onSuccess: () => { setRenaming(null); refresh(); toast('Renamed.') },
  })

  const deleteMutation = useAppMutation({
    mutationFn: async (id) => {
      const token = await getToken()
      const r = await fetch(`/api/video-templates/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        // The API refuses to delete a pinned template rather than silently
        // repointing every future reel — say which one it is.
        throw new Error(body.error === 'template_pinned'
          ? 'This template is in use for new reels. Choose another look first.'
          : 'Could not delete that.')
      }
      return r.json()
    },
    onSuccess: () => { setConfirmDelete(null); refresh(); toast('Template deleted.') },
    onError: (e) => { setConfirmDelete(null); toast(e.message) },
  })

  if (isLoading) {
    return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading templates…</div>
  }
  if (error) {
    return <p className="py-10 text-sm text-destructive">Couldn&apos;t load templates.</p>
  }

  const customs = templates.filter((t) => t.custom)

  return (
    <div className="space-y-6 py-2">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reel templates</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The look Bernard renders captions and headlines with on auto-generated Reels.
          Changing this affects reels made from here on — it doesn&apos;t re-render ones already drafted.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Film className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            To make a new one, open a clip, set the captions and headline how you want them,
            then choose <strong className="text-foreground">Save as reel template</strong> in the Captions panel.
            You design it on a real video, so what you approve is what gets rendered.
          </span>
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your templates {customs.length ? `(${customs.length})` : ''}
        </h2>
        {!customs.length && (
          <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
            None yet — the built-in looks below are available in the meantime.
          </p>
        )}
        {customs.map((t) => (
          <TemplateRow
            key={t.id} t={t} active={pinned === t.id}
            onUse={() => useMutationFor.mutate(t.id)}
            busy={useMutationFor.isPending}
            renaming={renaming === t.id}
            renameText={renameText}
            onRenameStart={() => { setRenaming(t.id); setRenameText(t.name) }}
            onRenameText={setRenameText}
            onRenameCancel={() => setRenaming(null)}
            onRenameSave={() => renameMutation.mutate({ id: t.id, name: renameText.trim() })}
            renameBusy={renameMutation.isPending}
            confirming={confirmDelete === t.id}
            onDeleteStart={() => setConfirmDelete(t.id)}
            onDeleteCancel={() => setConfirmDelete(null)}
            onDeleteConfirm={() => deleteMutation.mutate(t.id)}
            deleteBusy={deleteMutation.isPending}
          />
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Built in</h2>
        {templates.filter((t) => !t.custom).map((t) => (
          <TemplateRow
            key={t.id} t={t} active={pinned === t.id}
            onUse={() => useMutationFor.mutate(t.id)}
            busy={useMutationFor.isPending}
          />
        ))}
      </section>
    </div>
  )
}

function TemplateRow({
  t, active, onUse, busy,
  renaming, renameText, onRenameStart, onRenameText, onRenameCancel, onRenameSave, renameBusy,
  confirming, onDeleteStart, onDeleteCancel, onDeleteConfirm, deleteBusy,
}) {
  const editable = !!t.custom
  return (
    <div className={`rounded-xl border p-4 transition-colors ${active ? 'border-primary bg-primary/5' : 'border-border'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                value={renameText} onChange={(e) => onRenameText(e.target.value)} maxLength={80} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && renameText.trim()) onRenameSave(); if (e.key === 'Escape') onRenameCancel() }}
                className="rounded-md border bg-background px-2 py-1 text-sm"
              />
              <button onClick={onRenameSave} disabled={!renameText.trim() || renameBusy} className="text-xs text-primary disabled:opacity-60">Save</button>
              <button onClick={onRenameCancel} className="text-xs text-muted-foreground">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{t.name}</span>
              {active && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide text-primary-foreground">
                  <Check className="h-2.5 w-2.5" />In use
                </span>
              )}
            </div>
          )}
          <p className="mt-1 text-xs text-muted-foreground">{describe(t)}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!active && (
            <button onClick={onUse} disabled={busy}
              className="rounded-md border px-2.5 py-1 text-xs hover:border-primary hover:text-primary disabled:opacity-60">
              Use for new reels
            </button>
          )}
          {editable && !renaming && (
            <>
              <button onClick={onRenameStart} aria-label={`Rename ${t.name}`}
                className="rounded-md border p-1.5 text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={onDeleteStart} aria-label={`Delete ${t.name}`}
                className="rounded-md border p-1.5 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </>
          )}
        </div>
      </div>

      {confirming && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-center gap-1.5 text-xs text-foreground">
            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            Delete &ldquo;{t.name}&rdquo;? Reels already made keep their look.
          </p>
          <div className="flex gap-2">
            <button onClick={onDeleteCancel} className="text-xs text-muted-foreground">Cancel</button>
            <button onClick={onDeleteConfirm} disabled={deleteBusy}
              className="rounded-md bg-destructive px-2.5 py-1 text-xs text-destructive-foreground disabled:opacity-60">
              {deleteBusy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
