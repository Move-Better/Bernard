import { useState, useRef, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/WorkspaceContext'
import {
  usePhotoTemplates,
  useCreatePhotoTemplate,
  useUpdatePhotoTemplate,
  useDeletePhotoTemplate,
  useMediaInfinite,
} from '@/lib/queries'
import {
  FONT_SIZE_PX,
  FONT_WEIGHT_CSS,
  defaultBlockConfig,
} from '@/lib/carouselThemes'
import { renderFreeformSlide } from '@/lib/overlayTemplates'

// Resolve the brand accent the SAME way the canvas renderer does
// (brandAccent() in overlayTemplates.js reads brand_style.accent_color), so a
// `bgColor: null` CTA previews in the workspace's real accent — not a stray
// hardcoded orange. Falls back to the Bernard product color when unset.
function useBrandAccent() {
  const workspace = useWorkspace()
  return workspace?.brand_style?.accent_color || workspace?.colors?.primary || '#0c7580'
}

// Representative slides for the live preview, one per common slide type.
// attribution uses the workspace name when available.
function sampleSlides(workspaceName) {
  const who = workspaceName || 'Your clinic'
  return {
    cover: { label: 'Cover', blocks: [
      { role: 'page', text: 'Mobility', position: 'top-left' },
      { role: 'hook', text: 'Why your hips lie', position: 'center' },
      { role: 'attribution', text: who, position: 'bottom-left' },
    ] },
    explainer: { label: 'Explainer', blocks: [
      { role: 'hook', text: 'Train the hip', position: 'top' },
      { role: 'body', text: 'The hips drive the whole chain — load them right and the complaints get quiet.', position: 'center' },
      { role: 'page', text: '2 / 6', position: 'bottom-right' },
    ] },
    cta: { label: 'CTA', blocks: [
      { role: 'hook', text: 'Ready when you are', position: 'top' },
      { role: 'body', text: 'Book a movement assessment and we’ll map the real driver.', position: 'center' },
      { role: 'cta', text: 'Book now →', position: 'bottom' },
    ] },
  }
}
const SLIDE_KEYS = ['cover', 'explainer', 'cta']

// Normalize a theme record (built-in has .blocks; custom has .config.blocks)
// into the { blocks } shape renderFreeformSlide + ThemePreview expect.
function themeRenderObject(t) {
  if (!t) return { blocks: {} }
  return { blocks: t.blocks || t.config?.blocks || {} }
}

// Full-size live preview rendered by the REAL slide renderer (same code path as
// the slide editor), so it's WYSIWYG with what publishes — not a CSS chip.
function LiveThemePreview({ theme, slide, brandStyle, photoUrl }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    let cancelled = false
    async function draw() {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        await renderFreeformSlide({ sourceUrl: photoUrl || null, slide, brandStyle: brandStyle || {}, canvas, theme })
      } catch (e) {
        if (!cancelled) console.warn('[LiveThemePreview] render failed', e.message)
      }
    }
    draw()
    return () => { cancelled = true }
  }, [theme, slide, brandStyle, photoUrl])
  return <canvas ref={canvasRef} className="h-full w-auto" />
}

const BLOCK_ROLES_ORDERED = ['hook', 'body', 'caption', 'cta', 'attribution', 'page']
const ROLE_LABELS = { hook: 'Hook', body: 'Body', caption: 'Caption', cta: 'CTA', attribution: 'Attribution', page: 'Page #' }

const FONT_SIZES   = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl']
const FONT_WEIGHTS = ['normal', 'medium', 'semibold', 'bold', 'extrabold']
const SHADOWS      = ['none', 'soft', 'medium', 'strong']
const BACKGROUNDS  = ['none', 'pill', 'rect']

function emptyThemeConfig() {
  const blocks = {}
  for (const role of BLOCK_ROLES_ORDERED) blocks[role] = { ...defaultBlockConfig(role) }
  return { blocks }
}

// ── Mini slide preview (CSS-based, no canvas) ────────────────────────────────

function ThemePreview({ theme, size = 'md', brandAccent = '#0c7580' }) {
  const b = theme?.blocks || {}
  const hook = b.hook || {}
  const body = b.body || {}
  const cta  = b.cta  || {}

  const sizeMap = { sm: { w: 64, p: '6px 7px', hk: 9, bd: 6.5, ct: 6.5, pill: 16 },
                    md: { w: 120, p: '10px 11px', hk: 14, bd: 10, ct: 10, pill: 22 } }
  const s = sizeMap[size] || sizeMap.md

  const hookStyle = {
    fontSize: s.hk, fontWeight: FONT_WEIGHT_CSS[hook.fontWeight] || '800',
    color: hook.color || '#fff',
    textShadow: hook.shadow && hook.shadow !== 'none' ? '0 1px 3px rgba(0,0,0,.6)' : 'none',
    textTransform: hook.uppercase ? 'uppercase' : 'none',
    lineHeight: 1.2, alignSelf: 'flex-start',
    ...(hook.background === 'rect' ? { background: hook.bgColor || brandAccent, padding: '2px 4px' } : {}),
  }
  const bodyStyle = {
    fontSize: s.bd, fontWeight: FONT_WEIGHT_CSS[body.fontWeight] || '500',
    color: body.color || 'rgba(255,255,255,.8)',
    lineHeight: 1.3, marginTop: 3, alignSelf: 'flex-start',
    ...(body.background === 'rect' ? { background: body.bgColor || brandAccent, padding: '2px 4px' } : {}),
  }
  // A CTA with background pill/rect and no explicit bgColor inherits the brand
  // accent — matching the canvas renderer's `bgColor: null` behavior.
  const ctaBg = cta.bgColor || brandAccent
  const ctaStyle = cta.background === 'pill'
    ? { display: 'inline-block', fontSize: s.ct, fontWeight: FONT_WEIGHT_CSS[cta.fontWeight] || '700',
        color: cta.color || '#fff', background: ctaBg,
        padding: `${s.pill * 0.2}px ${s.pill * 0.55}px`, borderRadius: 999 }
    : cta.background === 'rect'
    ? { display: 'inline-block', fontSize: s.ct, fontWeight: FONT_WEIGHT_CSS[cta.fontWeight] || '700',
        color: cta.color || '#fff', background: ctaBg, padding: '2px 8px', borderRadius: 3,
        textTransform: cta.uppercase ? 'uppercase' : 'none' }
    : { fontSize: s.ct, fontWeight: '700', color: cta.color || '#fff', textDecoration: 'none' }

  return (
    <div style={{
      width: s.w, aspectRatio: '4/5', borderRadius: 8, overflow: 'hidden', position: 'relative', flexShrink: 0,
      background: 'linear-gradient(160deg, #6b7fa6 0%, #3a4a6a 100%)',
    }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.45) 100%)' }} />
      <div style={{ position: 'absolute', inset: 0, padding: s.p, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', zIndex: 1 }}>
        <div style={hookStyle}>Why your hips lie</div>
        <div style={bodyStyle}>Most pain starts upstream.</div>
        <div style={{ marginTop: 'auto' }}>
          <span style={ctaStyle}>Book now →</span>
        </div>
      </div>
    </div>
  )
}

// ── Per-block-role style editor ───────────────────────────────────────────────

function BlockEditor({ role, config, onChange, brandAccent = '#0c7580' }) {
  const c = config || defaultBlockConfig(role)
  function set(key, val) { onChange({ ...c, [key]: val }) }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-2xs font-medium text-muted-foreground block mb-1">Font size</label>
        <select value={c.fontSize || 'base'} onChange={(e) => set('fontSize', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>{s} — {FONT_SIZE_PX[s]}px</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-2xs font-medium text-muted-foreground block mb-1">Weight</label>
        <select value={c.fontWeight || 'semibold'} onChange={(e) => set('fontWeight', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
          {FONT_WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>
      <div>
        <label className="text-2xs font-medium text-muted-foreground block mb-1">Text color</label>
        <div className="flex items-center gap-2">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#ffffff'}
            onChange={(e) => set('color', e.target.value)}
            className="h-7 w-7 rounded cursor-pointer border border-input p-0.5" />
          <input type="text" value={c.color || '#ffffff'} onChange={(e) => set('color', e.target.value)}
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>
      <div>
        <label className="text-2xs font-medium text-muted-foreground block mb-1">Shadow</label>
        <select value={c.shadow || 'medium'} onChange={(e) => set('shadow', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
          {SHADOWS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label className="text-2xs font-medium text-muted-foreground block mb-1">Background</label>
        <select value={c.background || 'none'} onChange={(e) => set('background', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
          {BACKGROUNDS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>
      {(c.background === 'pill' || c.background === 'rect') && (
        <div>
          <label className="text-2xs font-medium text-muted-foreground block mb-1">Background color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.bgColor || '') ? c.bgColor : brandAccent}
              onChange={(e) => set('bgColor', e.target.value)}
              className="h-7 w-7 rounded cursor-pointer border border-input p-0.5" />
            <input type="text" value={c.bgColor || ''} placeholder="null = brand accent"
              onChange={(e) => set('bgColor', e.target.value || null)}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
        </div>
      )}
      <div className="col-span-2 flex items-center gap-2">
        <input type="checkbox" id={`uppercase-${role}`} checked={!!c.uppercase}
          onChange={(e) => set('uppercase', e.target.checked)}
          className="h-3.5 w-3.5 rounded border-input accent-primary cursor-pointer" />
        <label htmlFor={`uppercase-${role}`} className="text-xs text-muted-foreground cursor-pointer">Uppercase</label>
      </div>
    </div>
  )
}

// ── Theme editor form (create or edit a custom theme) ────────────────────────

function ThemeEditor({ initial, onSave, onCancel, saving }) {
  const brandAccent = useBrandAccent()
  const [name, setName]       = useState(initial?.name || '')
  const [isDefault, setIsDefault] = useState(initial?.is_default || false)
  const [config, setConfig]   = useState(initial?.config || emptyThemeConfig())
  const [activeRole, setActiveRole] = useState('hook')

  function setBlock(role, val) {
    setConfig((c) => ({ ...c, blocks: { ...c.blocks, [role]: val } }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Template name is required'); return }
    onSave({ name: name.trim(), is_default: isDefault, config })
  }

  const previewTheme = { blocks: config.blocks }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-sm font-bold text-foreground">{initial ? 'Edit template' : 'New template'}</h3>
        <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <span className="sr-only">Cancel</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className="flex gap-5">
        {/* Controls */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Name + default */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-2xs font-medium text-muted-foreground block mb-1">Template name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Move Better Dark"
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="shrink-0">
              <label className="text-2xs font-medium text-muted-foreground block mb-1">Default</label>
              <div className="h-8 flex items-center">
                <button type="button" onClick={() => setIsDefault((v) => !v)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${isDefault ? 'bg-primary' : 'bg-muted'}`}>
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isDefault ? 'translate-x-4' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Block role tabs */}
          <div>
            <div className="text-2xs font-medium text-muted-foreground mb-2">Style per block role</div>
            <div className="flex gap-1 flex-wrap mb-3">
              {BLOCK_ROLES_ORDERED.map((role) => (
                <button key={role} type="button" onClick={() => setActiveRole(role)}
                  className={`rounded-md px-2.5 py-1 text-2xs font-semibold transition-colors ${
                    activeRole === role
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}>
                  {ROLE_LABELS[role]}
                </button>
              ))}
            </div>
            <div className="rounded-lg border bg-card p-3">
              <BlockEditor
                key={activeRole}
                role={activeRole}
                config={config.blocks?.[activeRole]}
                onChange={(val) => setBlock(activeRole, val)}
                brandAccent={brandAccent}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving} loading={saving}>
              {saving ? 'Saving…' : 'Save template'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </div>

        {/* Preview */}
        <div className="shrink-0">
          <div className="text-2xs font-medium text-muted-foreground mb-2">Preview</div>
          <ThemePreview theme={previewTheme} size="md" brandAccent={brandAccent} />
        </div>
      </div>
    </form>
  )
}

// ── Main PhotoTemplates component ────────────────────────────────────────────

export default function PhotoTemplates() {
  const { data: allThemes = [], isLoading } = usePhotoTemplates()
  const createTheme  = useCreatePhotoTemplate()
  const updateTheme  = useUpdatePhotoTemplate()
  const deleteTheme  = useDeletePhotoTemplate()
  const brandAccent  = useBrandAccent()
  const workspace    = useWorkspace()
  const brandStyle   = workspace?.brand_style || {}

  // Live-preview state: which theme + slide type to render full-size, and the
  // backdrop photo (most-recent workspace photo, else the renderer's gradient).
  const [selectedThemeId, setSelectedThemeId] = useState(null)
  const [slideKey, setSlideKey] = useState('cover')
  const { data: mediaPages } = useMediaInfinite({ kind: 'photo' }, { pageSize: 1 })
  const previewPhotoUrl = useMemo(() => {
    const a = mediaPages?.pages?.[0]?.[0]
    return a ? (a.rendered_url || a.web_blob_url || a.blob_url || null) : null
  }, [mediaPages])
  const slides = useMemo(() => sampleSlides(workspace?.display_name), [workspace?.display_name])
  const selectedTheme = allThemes.find((t) => t.id === selectedThemeId) || allThemes[0] || null

  const [editing, setEditing] = useState(null)  // null | 'new' | { theme }

  async function handleCreate(body) {
    try {
      await createTheme.mutateAsync(body)
      toast.success('Template created')
      setEditing(null)
    } catch (e) {
      toast.error('Failed to create template', { description: e.message })
    }
  }

  async function handleUpdate(id, body) {
    try {
      await updateTheme.mutateAsync({ id, patch: body })
      toast.success('Template updated')
      setEditing(null)
    } catch (e) {
      toast.error('Failed to update template', { description: e.message })
    }
  }

  async function handleDelete(theme) {
    if (!window.confirm(`Delete "${theme.name}"? Stories using it will fall back to the workspace default.`)) return
    try {
      await deleteTheme.mutateAsync(theme.id)
      toast.success('Template deleted')
    } catch (e) {
      toast.error('Failed to delete template', { description: e.message })
    }
  }

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading templates…</div>

  return (
    <div className="max-w-3xl space-y-4">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Photo Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Control how text overlays look on photo slides. One theme applies per carousel — clinicians pick it in the slide editor.
        </p>
      </div>

      {/* Live preview panel: portrait photo left, rail right */}
      <div className="rounded-xl border bg-card p-4 flex flex-row gap-5 items-stretch h-[480px]">

        {/* Portrait preview — canvas is square (1080×1080) displayed in a 4:5 CSS
            container with overflow-hidden, so left/right edges clip to portrait */}
        <div className="h-full aspect-[4/5] shrink-0 overflow-hidden rounded-lg shadow-sm">
          <LiveThemePreview
            theme={themeRenderObject(selectedTheme)}
            slide={slides[slideKey]}
            brandStyle={brandStyle}
            photoUrl={previewPhotoUrl}
          />
          {!previewPhotoUrl && (
            <p className="absolute bottom-2 left-2 right-2 text-2xs text-white/70 text-center">
              No photos yet — backdrop only
            </p>
          )}
        </div>

        {/* Right rail: name, slide-type toggle, scrollable theme list, + New template at bottom */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="text-sm font-bold text-foreground leading-tight">{selectedTheme?.name || '—'}</div>
          <div className="text-2xs text-muted-foreground mb-3">{selectedTheme?.builtin ? 'Built-in' : 'Custom'}</div>

          <div className="text-2xs font-medium text-muted-foreground mb-1.5">Slide type</div>
          <div className="inline-flex rounded-lg border border-input overflow-hidden mb-4 self-start">
            {SLIDE_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSlideKey(k)}
                className={`px-3 py-1.5 text-xs font-semibold capitalize border-r border-input last:border-r-0 transition-colors ${
                  slideKey === k ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {slides[k].label}
              </button>
            ))}
          </div>

          <div className="text-2xs font-medium text-muted-foreground mb-1.5">Theme</div>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1 min-h-0">
            {allThemes.map((t) => {
              const sel = t.id === selectedTheme?.id
              return (
                <div
                  key={t.id}
                  className={`group flex items-center gap-2.5 w-full rounded-lg border p-1.5 transition-colors ${
                    sel ? 'border-primary bg-primary/5' : 'border-transparent hover:border-primary/20 hover:bg-muted/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedThemeId(t.id)}
                    className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                  >
                    <ThemePreview theme={themeRenderObject(t)} size="sm" brandAccent={brandAccent} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate flex items-center gap-1.5">
                        {t.name}
                        {t.is_default && (
                          <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-2xs font-semibold text-green-700">Default</span>
                        )}
                      </div>
                      <div className="text-2xs text-muted-foreground">{t.builtin ? 'Built-in' : 'Custom'}</div>
                    </div>
                  </button>
                  {t.custom && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditing({ theme: t })}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(t)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* + New template at bottom of rail */}
          {editing !== 'new' && (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors py-1"
            >
              <Plus className="h-3.5 w-3.5" />
              New template
            </button>
          )}
        </div>
      </div>

      {/* Theme editor — inline below the panel when creating or editing */}
      {editing === 'new' && (
        <ThemeEditor
          onSave={handleCreate}
          onCancel={() => setEditing(null)}
          saving={createTheme.isPending}
        />
      )}
      {editing?.theme && (
        <ThemeEditor
          initial={{ name: editing.theme.name, is_default: editing.theme.is_default, config: editing.theme.config }}
          onSave={(body) => handleUpdate(editing.theme.id, body)}
          onCancel={() => setEditing(null)}
          saving={updateTheme.isPending}
        />
      )}
    </div>
  )
}
