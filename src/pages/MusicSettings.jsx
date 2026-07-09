import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, Play, Pause, Trash2, Loader2, Music } from 'lucide-react'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useAppMutation } from '@/lib/useAppMutation'
import { useConfirm } from '@/lib/useConfirm'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { toast } from '@/lib/toast'
import { getMusicTracks, uploadMusicTrack, deleteMusicTrack, updateMusicTrack } from '@/lib/musicLib'

const MOODS = ['calm', 'upbeat', 'warm', 'cinematic']
const fmt = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)

// A single track row. Module-scope (react-hooks/static-components).
function TrackRow({ t, own, isPlaying, onPreview, onMood, onDelete }) {
  return (
    <div className="flex items-center gap-3 border-t px-3.5 py-2.5 first:border-t-0" style={{ borderColor: 'hsl(var(--border))' }}>
      <button
        type="button" onClick={() => onPreview(t)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'hsl(var(--primary)/.10)', color: 'hsl(var(--primary))' }}
        title={isPlaying ? 'Stop preview' : 'Preview'}
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{t.title}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{fmt(t.durationSec)}</p>
      </div>
      {own ? (
        <select
          value={t.mood}
          onChange={(e) => onMood(t.id, e.target.value)}
          className="rounded-md border bg-card px-2 py-1 text-xs font-medium capitalize text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          style={{ borderColor: 'hsl(var(--border))' }}
          aria-label="Mood"
        >
          {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      ) : (
        <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-bold uppercase tracking-wide text-muted-foreground">{t.mood}</span>
      )}
      {own && (
        <button
          type="button" onClick={() => onDelete(t)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
          title="Remove"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export default function MusicSettings() {
  useDocumentTitle('Music')
  const workspace = useWorkspace()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const audioRef = useRef(null)
  const fileRef = useRef(null)
  const [previewId, setPreviewId] = useState(null)
  const [uploading, setUploading] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: ['music-tracks'], queryFn: getMusicTracks })
  const tracks = data?.tracks || []
  const shared = tracks.filter((t) => t.shared)
  const own = tracks.filter((t) => !t.shared)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['music-tracks'] })
  const delMut = useAppMutation({ mutationFn: (id) => deleteMusicTrack(id), onSuccess: () => { invalidate(); toast('Track removed') } })
  const moodMut = useAppMutation({ mutationFn: ({ id, mood }) => updateMusicTrack(id, { mood }), onSuccess: invalidate })

  async function onDelete(t) {
    if (!(await confirm({
      title: `Remove "${t.title}"?`,
      description: 'This deletes the track permanently — it can’t be recovered.',
      confirmLabel: 'Remove',
    }))) return
    delMut.mutate(t.id)
  }

  function preview(t) {
    const a = audioRef.current
    if (!a) return
    if (previewId === t.id) { a.pause(); setPreviewId(null); return }
    a.src = t.url; a.currentTime = 0
    a.play().then(() => setPreviewId(t.id)).catch(() => setPreviewId(null))
  }

  async function onFiles(files) {
    const list = [...files].filter((f) => /audio\/(mpeg|mp3)/.test(f.type) || /\.mp3$/i.test(f.name))
    if (!list.length) { toast('Choose MP3 files'); return }
    setUploading(true)
    let ok = 0
    for (const f of list) {
      try {
        await uploadMusicTrack(f, { workspaceId: workspace.id, title: f.name.replace(/\.[^.]+$/, ''), mood: 'calm' })
        ok++
      } catch {
        toast(`Couldn't upload "${f.name}" — admins only, MP3 under 15MB`)
      }
    }
    setUploading(false)
    if (ok) toast(`Uploaded ${ok} track${ok > 1 ? 's' : ''}`)
    invalidate()
    // The row is inserted on the completion callback; refetch again shortly in
    // case it lands just after the upload resolves.
    setTimeout(invalidate, 1500)
  }

  const sectionLabel = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground'

  return (
    <div className="max-w-xl py-6">
      <audio ref={audioRef} onEnded={() => setPreviewId(null)} className="hidden" />
      <input
        ref={fileRef} type="file" accept="audio/mpeg,.mp3" multiple className="hidden"
        onChange={(e) => { onFiles(e.target.files); e.target.value = '' }}
      />

      <div className="mb-1 flex items-center gap-2">
        <Music className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight">Music</h1>
      </div>
      <p className="mb-7 text-sm text-muted-foreground">
        Licensed background tracks for your video clips. Add one in the video editor and it&rsquo;s mixed under the voice with auto-duck.
      </p>

      {/* Shared library */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <span className={sectionLabel}>Shared library</span>
          <span className="rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-wide" style={{ background: 'hsl(var(--accent))', color: 'hsl(var(--primary))' }}>✓ Included</span>
        </div>
        <div className="rounded-xl border bg-card" style={{ borderColor: 'hsl(var(--border))' }}>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : shared.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-sm text-muted-foreground">The shared starter set is being curated — it&rsquo;ll appear here soon.</p>
          ) : (
            shared.map((t) => (
              <TrackRow key={t.id} t={t} own={false} isPlaying={previewId === t.id} onPreview={preview} />
            ))
          )}
        </div>
      </section>

      {/* Your tracks */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <span className={sectionLabel}>Your tracks</span>
          <span className="text-xs text-muted-foreground">Admins only</span>
        </div>
        <div className="rounded-xl border bg-card" style={{ borderColor: 'hsl(var(--border))' }}>
          <button
            type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="m-3.5 flex w-[calc(100%-1.75rem)] flex-col items-center rounded-xl border border-dashed px-6 py-6 text-center transition-colors hover:bg-primary/[.03] disabled:opacity-60"
            style={{ borderColor: 'hsl(var(--border))' }}
          >
            {uploading
              ? <Loader2 className="mb-2 h-7 w-7 animate-spin text-muted-foreground" />
              : <Upload className="mb-2 h-7 w-7 text-muted-foreground/60" />}
            <span className="text-sm font-medium">{uploading ? 'Uploading…' : 'Upload MP3 tracks'}</span>
            <span className="mt-1 text-xs text-muted-foreground">Tracks your clinic is licensed to use. Set the mood after upload.</span>
          </button>
          {own.length > 0 && (
            <div className="border-t" style={{ borderColor: 'hsl(var(--border))' }}>
              {own.map((t) => (
                <TrackRow
                  key={t.id} t={t} own isPlaying={previewId === t.id}
                  onPreview={preview}
                  onMood={(id, mood) => moodMut.mutate({ id, mood })}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
