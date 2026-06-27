// Editable Visual anchors for Settings → Brand identity. Renders the brief's
// anchors (interview-derived + user-curated) and lets an admin add references
// two ways — drop a screenshot, or paste an account/handle — each with an
// optional note. Anchors persist on workspaces.brand_brief.visualAnchors via
// /api/brand-discovery/anchors; screenshots upload to Blob (no brand_assets row)
// via uploadBrandAnchorImage. Read-only reveal uses BrandBriefView instead.
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, AtSign, Bookmark, ImagePlus, Loader2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { apiFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queries'
import { uploadBrandAnchorImage } from '@/lib/brandKitLib'

export default function BrandAnchorsEditor({ anchors = [] }) {
  const qc = useQueryClient()
  const workspace = useWorkspace()
  const fileRef = useRef(null)
  const [handle, setHandle] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState(null)

  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.workspace.me })

  const addAnchor = async (payload) => {
    await apiFetch('/api/brand-discovery/anchors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    await refresh()
  }

  const handleAddText = async () => {
    const ref = handle.trim()
    if (!ref || busy) return
    setBusy(true); setError(null)
    try {
      await addAnchor({ reference: ref, why: note.trim() })
      setHandle(''); setNote('')
    } catch (e) {
      setError(e?.message || 'Could not add reference')
    } finally {
      setBusy(false)
    }
  }

  const handleFile = async (file) => {
    if (!file || uploading) return
    setUploading(true); setError(null)
    try {
      const blob = await uploadBrandAnchorImage(file, { workspaceId: workspace?.id })
      await addAnchor({ reference: file.name, why: note.trim(), imageUrl: blob?.url })
      setNote('')
    } catch (e) {
      setError(e?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = async (a) => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const qs = a?.id ? `anchorId=${encodeURIComponent(a.id)}` : `index=${anchors.indexOf(a)}`
      await apiFetch(`/api/brand-discovery/anchors?${qs}`, { method: 'DELETE' })
      await refresh()
    } catch (e) {
      setError(e?.message || 'Could not remove')
    } finally {
      setBusy(false)
    }
  }

  const imageAnchors = anchors.filter((a) => a?.imageUrl)
  const textAnchors = anchors.filter((a) => a && !a.imageUrl)

  return (
    <div>
      <div className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Visual anchors</div>

      {imageAnchors.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          {imageAnchors.map((a) => (
            <div key={a.id || a.imageUrl} className="rounded-xl border border-border bg-card overflow-hidden relative">
              <img src={a.imageUrl} alt={a.reference || 'Reference'} className="h-32 w-full object-cover" />
              <button
                onClick={() => handleRemove(a)}
                disabled={busy}
                className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/70 disabled:opacity-50"
                aria-label="Remove reference"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="p-3">
                <p className="text-sm font-semibold truncate">{a.reference}</p>
                {a.why ? <p className="text-xs text-muted-foreground">{a.why}</p> : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {textAnchors.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 mb-3">
          <ul className="space-y-2 text-sm">
            {textAnchors.map((a, i) => (
              <li key={a.id || `t${i}`} className="flex items-start gap-2 group">
                <AtSign className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  <span className="font-semibold">{a.reference}</span>
                  {a.why ? <span className="text-muted-foreground"> — {a.why}</span> : null}
                </span>
                <button
                  onClick={() => handleRemove(a)}
                  disabled={busy}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label="Remove reference"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {anchors.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-4 mb-3 text-sm text-muted-foreground flex items-center gap-2">
          <Bookmark className="h-4 w-4 shrink-0" aria-hidden="true" />
          No references yet — add a screenshot or an account below.
        </div>
      )}

      {/* Add a reference */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-xs font-semibold mb-2.5">Add a reference</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}
            className={`rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center px-4 py-6 cursor-pointer transition-colors ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }}
            />
            {uploading ? (
              <Loader2 className="h-5 w-5 text-primary mb-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <ImagePlus className="h-5 w-5 text-primary mb-1.5" aria-hidden="true" />
            )}
            <p className="text-sm font-medium">{uploading ? 'Uploading…' : 'Drop a screenshot'}</p>
            <p className="text-xs text-muted-foreground">or click to browse · PNG / JPG</p>
          </label>

          <div className="flex flex-col gap-2">
            <div className="rounded-lg border border-border flex items-center px-3">
              <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddText() }}
                className="flex-1 bg-transparent text-sm px-2 py-2 outline-none"
                placeholder="paste an account or handle"
              />
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-lg border border-border text-sm px-3 py-2 outline-none"
              placeholder="why it resonates (optional)"
            />
            <Button onClick={handleAddText} disabled={!handle.trim() || busy} className="self-start gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add reference
            </Button>
          </div>
        </div>

        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        <p className="text-xs text-muted-foreground mt-2.5 flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          These references steer on-brand image generation. A note on each helps Bernard understand what you&apos;re reaching for.
        </p>
      </div>
    </div>
  )
}
