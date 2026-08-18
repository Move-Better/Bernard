import { useState, useRef, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Copy, LayoutTemplate } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useConfirm } from '@/lib/useConfirm'
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
  BUILTIN_THEME_IDS,
  defaultBlockConfig,
} from '@/lib/photoTemplates'
import { renderFreeformSlide } from '@/lib/overlayTemplates'
import { ColorPickerPopover } from '@/components/ColorPickerPopover'
import { brandSwatches, NEUTRAL_SWATCHES, brandInk, brandPaper, workspacePrimaryColor, WORKSPACE_DEFAULT_PRIMARY, brandStyleForRender } from '@/lib/brandSwatches'

// Resolve the brand hero accent the SAME way the bake does — via
// workspacePrimaryColor() (colors.primary → brand_style.accent_color → palette →
// default), the client mirror of the server compositor's chain that the slide
// renderer now bakes with (brandStyleForRender → brandAccent). So a `bgColor:
// null` CTA and the rail thumbnails preview the exact accent that publishes,
// identically across the client slide bake and the server compositor.
function useBrandAccent() {
  const workspace = useWorkspace()
  return workspacePrimaryColor(workspace)
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

// Preview-only ratio presets — changes the preview container's aspect so you can
// check a template holds up at each shape it will actually be rendered at. This
// is a DESIGN TOOL, not a per-post choice: a real post's frame is derived from
// its destination via src/lib/postFrames.js and is never selectable.
//
// Titles name the destinations each shape is actually used for, per that
// registry. They previously called BOTH 1:1 and 4:5 "Instagram post", which is
// the same mislabelling that let `instagram_feed: 1:1` survive for months —
// Instagram's feed renders 4:5, and nothing Bernard publishes is square.
// `ratio` is height/width. The preview box is fully responsive (CSS
// aspect-ratio), capped by PREVIEW_MAX_H so tall formats don't run away.
const PREVIEW_MAX_H = 540
const FORMATS = [
  { id: 'portrait',  label: '4:5',  ratio: 5 / 4,   title: 'Portrait — Instagram / Facebook / LinkedIn post (1080×1350)' },
  { id: 'story',     label: '9:16', ratio: 16 / 9,  title: 'Vertical — Reels & Stories, TikTok, YouTube Shorts (1080×1920)' },
  { id: 'landscape', label: '16:9', ratio: 9 / 16,  title: 'Landscape — blog hero, X, Mastodon, long-form video (1920×1080)' },
  { id: 'gbp',       label: '4:3',  ratio: 3 / 4,   title: 'Google Business Profile — the only ratio Maps & Search will not clip (1200×900)' },
  { id: 'square',    label: '1:1',  ratio: 1,       title: 'Square — Bluesky (1080×1080)' },
]

// Normalize a theme record so renderFreeformSlide gets layout, palette AND
// blocks. The old themeRenderObject only returned { blocks }, which silently
// stripped layout/palette from built-in themes — WHOOP geometry never fired.
function normalizeTheme(t) {
  if (!t) return { blocks: {} }
  return {
    layout:    t.layout,
    palette:   t.palette,
    blocks:    t.blocks || t.config?.blocks || {},
    structure: t.structure || t.config?.structure || undefined,
    mode:      t.mode     || t.config?.mode     || undefined,
  }
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
  return <canvas ref={canvasRef} className="block w-full h-auto" />
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

// ── Layout-diagram thumbnail — SVG skeleton of each WHOOP layout family ──────
//
// Built-in templates get a precise layout diagram (not a text swatch) so the
// user can distinguish the 6 families at a glance. Custom templates fall back
// to the CSS swatch below.

// Fallback ground colors for workspaces with no Brand Kit palette (the thumbnail
// otherwise derives ink/paper from the brand, matching the real renderer).
const NAVY_T  = '#0c1a2e'
const PAPER_T = '#f0ede6'

function WhoopLayoutThumb({ templateId, size = 'sm', brandAccent = WORKSPACE_DEFAULT_PRIMARY, ink = NAVY_T, paper = PAPER_T }) {
  const dim = size === 'sm' ? { w: 48, h: 60 } : { w: 96, h: 120 }
  const { w, h } = dim
  const p = Math.round(w * 0.10)        // padding
  const ruleW = Math.round(w * 0.20)
  const ruleH = 2
  const ruleY = p + 2

  // Shared label + text stubs helper
  function textLines(x, y, lineW, lineH, gap, color, count) {
    return Array.from({ length: count }, (_, i) => (
      <rect key={i} x={x} y={y + i * (lineH + gap)} width={lineW * (1 - i * 0.18)} height={lineH} rx={1} fill={color} opacity={0.9 - i * 0.15} />
    ))
  }

  const layout = templateId?.split('-')[1]    // claim | badge | split
  const isDark = templateId?.startsWith('dark')

  if (layout === 'claim') {
    const bg    = isDark ? ink : paper
    const textC = isDark ? '#ffffff' : ink
    const label = isDark ? 'rgba(255,255,255,0.55)' : brandAccent
    const textY = Math.round(h * 0.35)
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ borderRadius: 6, flexShrink: 0, display: 'block' }}>
        <rect width={w} height={h} fill={bg} />
        <rect x={p} y={ruleY} width={ruleW} height={ruleH} rx={1} fill={brandAccent} />
        {/* label stub */}
        <rect x={p + ruleW + 4} y={ruleY} width={Math.round(w * 0.22)} height={ruleH} rx={1} fill={label} />
        {/* headline stubs */}
        {textLines(p, textY, w - p * 2, Math.round(h * 0.065), Math.round(h * 0.020), textC, 3)}
        {/* CTA pill */}
        <rect x={p} y={h - p - Math.round(h * 0.11)} width={Math.round(w * 0.45)} height={Math.round(h * 0.09)} rx={999} fill={brandAccent} opacity={0.9} />
      </svg>
    )
  }

  if (layout === 'split') {
    const photoH  = Math.round(h * 0.67)
    const panelBg = isDark ? ink : paper
    const panelInk = isDark ? '#ffffff' : ink
    const photoBg = isDark ? '#3f4145' : '#9b9ea3'
    const textY = photoH + Math.round(h * 0.075)
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ borderRadius: 6, flexShrink: 0, display: 'block' }}>
        {/* photo area */}
        <rect width={w} height={photoH} fill={photoBg} />
        {/* gradient on photo */}
        <defs><linearGradient id={`pg-${templateId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#000" stopOpacity="0.05"/><stop offset="1" stopColor="#000" stopOpacity="0.18"/></linearGradient></defs>
        <rect width={w} height={photoH} fill={`url(#pg-${templateId})`} />
        {/* panel */}
        <rect y={photoH} width={w} height={h - photoH} fill={panelBg} />
        {/* rule */}
        <rect x={p} y={photoH + Math.round(h * 0.025)} width={ruleW} height={ruleH} rx={1} fill={brandAccent} />
        {/* headline stubs */}
        {textLines(p, textY, w - p * 2, Math.round(h * 0.065), Math.round(h * 0.018), panelInk, 2)}
        {/* CTA pill */}
        <rect x={p} y={h - p - Math.round(h * 0.10)} width={Math.round(w * 0.40)} height={Math.round(h * 0.08)} rx={999} fill={brandAccent} opacity={0.85} />
      </svg>
    )
  }

  // badge
  const photoH  = isDark ? h : Math.round(h * 0.56)
  const panelBg = isDark ? 'transparent' : paper
  const textC    = isDark ? '#ffffff' : ink
  const photoBg  = isDark ? '#3f4145' : '#9b9ea3'
  const badgeR   = Math.round(w * 0.12)
  const badgeCx  = w - p - badgeR
  const badgeCy  = p + badgeR
  const circ     = 2 * Math.PI * badgeR
  const textY    = isDark ? h - Math.round(h * 0.35) : photoH + Math.round(h * 0.065)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ borderRadius: 6, flexShrink: 0, display: 'block' }}>
      {/* photo area */}
      <rect width={w} height={photoH} fill={photoBg} />
      {isDark && (
        <>
          <defs><linearGradient id={`bg-${templateId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stopColor={ink} stopOpacity="0"/><stop offset="1" stopColor={ink} stopOpacity="0.85"/></linearGradient></defs>
          <rect width={w} height={h} fill={`url(#bg-${templateId})`} />
        </>
      )}
      {!isDark && <rect y={photoH} width={w} height={h - photoH} fill={panelBg} />}
      {/* badge ring */}
      <circle cx={badgeCx} cy={badgeCy} r={badgeR} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={Math.round(badgeR * 0.20)} />
      <circle cx={badgeCx} cy={badgeCy} r={badgeR} fill="none" stroke={brandAccent} strokeWidth={Math.round(badgeR * 0.20)} strokeLinecap="round"
        strokeDasharray={`${circ * 0.78} ${circ}`} transform={`rotate(-90 ${badgeCx} ${badgeCy})`} />
      {/* rule */}
      <rect x={p} y={isDark ? textY - Math.round(h * 0.065) : photoH + Math.round(h * 0.022)} width={ruleW} height={ruleH} rx={1} fill={brandAccent} />
      {/* headline stubs */}
      {textLines(p, textY, w - p * 2 - badgeR * 2 - 4, Math.round(h * 0.065), Math.round(h * 0.018), textC, 2)}
      {/* CTA pill */}
      <rect x={p} y={h - p - Math.round(h * 0.10)} width={Math.round(w * 0.40)} height={Math.round(h * 0.08)} rx={999} fill={brandAccent} opacity={0.85} />
    </svg>
  )
}

// CSS swatch fallback for custom templates (no fixed layout to diagram)
function CustomThemePreview({ theme, size = 'md', brandAccent = WORKSPACE_DEFAULT_PRIMARY }) {
  const b = theme?.blocks || {}
  const hook = b.hook || {}
  const body = b.body || {}
  const cta  = b.cta  || {}

  const sizeMap = { sm: { w: 48, p: '5px 6px', hk: 8, bd: 6, ct: 6, pill: 14 },
                    md: { w: 96, p: '9px 10px', hk: 13, bd: 9, ct: 9, pill: 20 } }
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
  const ctaBg = cta.bgColor || brandAccent
  const ctaStyle = cta.background === 'pill'
    ? { display: 'inline-block', fontSize: s.ct, fontWeight: FONT_WEIGHT_CSS[cta.fontWeight] || '700',
        color: cta.color || '#fff', background: ctaBg,
        padding: `${s.pill * 0.2}px ${s.pill * 0.55}px`, borderRadius: 999 }
    : cta.background === 'rect'
    ? { display: 'inline-block', fontSize: s.ct, fontWeight: FONT_WEIGHT_CSS[cta.fontWeight] || '700',
        color: cta.color || '#fff', background: ctaBg, padding: '2px 8px', borderRadius: 3,
        textTransform: cta.uppercase ? 'uppercase' : 'none' }
    : { fontSize: s.ct, fontWeight: '700', color: cta.color || '#fff' }

  return (
    <div style={{
      width: s.w, aspectRatio: '4/5', borderRadius: 6, overflow: 'hidden', position: 'relative', flexShrink: 0,
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

// Dispatcher: built-ins get the SVG layout diagram; custom get the CSS swatch.
function ThemePreview({ theme, size = 'md', brandAccent = WORKSPACE_DEFAULT_PRIMARY }) {
  const workspace = useWorkspace()
  const id = theme?.id
  if (id && BUILTIN_THEME_IDS.includes(id)) {
    return <WhoopLayoutThumb templateId={id} size={size} brandAccent={brandAccent}
      ink={brandInk(workspace, NAVY_T)} paper={brandPaper(workspace, PAPER_T)} />
  }
  return <CustomThemePreview theme={normalizeTheme(theme)} size={size} brandAccent={brandAccent} />
}

// ── Per-block-role style editor ───────────────────────────────────────────────

function BlockEditor({ role, config, onChange, brandAccent = WORKSPACE_DEFAULT_PRIMARY, swatches = [] }) {
  const c = config || defaultBlockConfig(role)
  function set(key, val) { onChange({ ...c, [key]: val }) }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-2xs font-medium text-muted-foreground block mb-1">Font size</label>
        <Select value={c.fontSize || 'base'} onValueChange={(v) => set('fontSize', v)}>
          <SelectTrigger className="h-7 text-xs w-full" aria-label="Font size">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map((s) => (
              <SelectItem key={s} value={s}>{s} — {FONT_SIZE_PX[s]}px</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-2xs font-medium text-muted-foreground block mb-1">Weight</label>
        <Select value={c.fontWeight || 'semibold'} onValueChange={(v) => set('fontWeight', v)}>
          <SelectTrigger className="h-7 text-xs w-full" aria-label="Font weight">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_WEIGHTS.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-2xs font-medium text-muted-foreground block mb-1">Text color</label>
        <div className="flex items-center gap-2">
          <ColorPickerPopover
            value={/^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#ffffff'}
            onChange={(hex) => set('color', hex)}
            swatches={swatches}
            swatchClassName="h-7 w-7"
            ariaLabel="Pick text color"
          />
          <input aria-label="Text color hex value" type="text" value={c.color || '#ffffff'} onChange={(e) => set('color', e.target.value)}
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>
      <div>
        <label className="text-2xs font-medium text-muted-foreground block mb-1">Shadow</label>
        <Select value={c.shadow || 'medium'} onValueChange={(v) => set('shadow', v)}>
          <SelectTrigger className="h-7 text-xs w-full" aria-label="Shadow">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHADOWS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-2xs font-medium text-muted-foreground block mb-1">Background</label>
        <Select value={c.background || 'none'} onValueChange={(v) => set('background', v)}>
          <SelectTrigger className="h-7 text-xs w-full" aria-label="Background style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BACKGROUNDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {(c.background === 'pill' || c.background === 'rect') && (
        <div>
          <label className="text-2xs font-medium text-muted-foreground block mb-1">Background color</label>
          <div className="flex items-center gap-2">
            <ColorPickerPopover
              value={/^#[0-9a-f]{6}$/i.test(c.bgColor || '') ? c.bgColor : brandAccent}
              onChange={(hex) => set('bgColor', hex)}
              swatches={swatches}
              swatchClassName="h-7 w-7"
              ariaLabel="Pick background color"
            />
            <input aria-label="Background color hex value" type="text" value={c.bgColor || ''} placeholder="null = brand accent"
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
  const workspace = useWorkspace()
  const swatches = useMemo(() => [...brandSwatches(workspace), ...NEUTRAL_SWATCHES], [workspace])
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
              <label htmlFor="photo-template-name" className="text-2xs font-medium text-muted-foreground block mb-1">Template name</label>
              <input id="photo-template-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Move Better Dark"
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
                swatches={swatches}
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

// A theme record → the {layout, palette, blocks} config shape the renderer
// speaks. Built-ins carry layout/palette at top level; custom templates carry
// it (or just blocks) under .config. Used by Duplicate, which is how you get an
// editable copy of a built-in.
function themeToConfig(theme) {
  if (!theme) return null
  const layout    = theme.config?.layout    || theme.layout    || 'photo'
  const palette   = theme.config?.palette   || theme.palette   || 'dark'
  const blocks    = theme.config?.blocks    || theme.blocks    || {}
  const structure = theme.config?.structure || theme.structure || undefined
  const mode      = theme.config?.mode      || theme.mode      || undefined
  const out = { layout, palette, blocks }
  if (structure?.length) out.structure = structure
  if (mode) out.mode = mode
  return out
}

// ── Main PhotoTemplates component ────────────────────────────────────────────

export default function PhotoTemplates() {
  const { data: allThemes = [], isLoading } = usePhotoTemplates()
  const createTheme  = useCreatePhotoTemplate()
  const updateTheme  = useUpdatePhotoTemplate()
  const deleteTheme  = useDeletePhotoTemplate()
  const brandAccent  = useBrandAccent()
  const workspace    = useWorkspace()
  // Reconciled: heroAccent resolved the SAME way the server compositor does, so
  // the LiveThemePreview canvas bakes the exact accent that publishes.
  const brandStyle   = brandStyleForRender(workspace)
  const confirm      = useConfirm()

  // Live-preview state: which theme + slide type to render full-size, and the
  // backdrop photo (workspace recent photos, else the renderer's gradient).
  const [selectedThemeId, setSelectedThemeId] = useState(null)
  const [slideKey, setSlideKey] = useState('cover')
  const [previewPhotoIdx, setPreviewPhotoIdx] = useState(0) // 0 = first photo; -1 = gradient
  const { data: mediaPages } = useMediaInfinite({ kind: 'photo' }, { pageSize: 6 })
  const recentPhotos = useMemo(() => {
    return (mediaPages?.pages?.flat() || [])
      .slice(0, 6)
      .map((a) => a.rendered_url || a.web_blob_url || a.blob_url || null)
      .filter(Boolean)
  }, [mediaPages])
  const previewPhotoUrl = previewPhotoIdx >= 0 ? (recentPhotos[previewPhotoIdx] ?? null) : null
  const slides = useMemo(() => sampleSlides(workspace?.display_name), [workspace?.display_name])
  const selectedTheme = allThemes.find((t) => t.id === selectedThemeId) || allThemes[0] || null

  const [editing, setEditing] = useState(null)  // null | 'new' | { theme }
  const editorRef = useRef(null)
  // The editor renders inline below the template list, often below the fold —
  // without this it looks like the Edit button does nothing.
  useEffect(() => {
    if (editing) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editing])
  // Defaults to 4:5, the frame most real posts render at. It used to default to
  // square — the one shape in this list that nothing Bernard publishes uses.
  const [formatId, setFormatId] = useState('portrait')
  const format    = FORMATS.find((f) => f.id === formatId) || FORMATS[0]
  // Cap the box WIDTH so a tall format (9:16) stays within PREVIEW_MAX_H.
  const maxBoxW   = Math.round(PREVIEW_MAX_H / format.ratio)

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
    if (!(await confirm({
      title: `Delete "${theme.name}"?`,
      description: 'Stories using it will fall back to the workspace default.',
      confirmLabel: 'Delete',
    }))) return
    try {
      await deleteTheme.mutateAsync(theme.id)
      toast.success('Template deleted')
    } catch (e) {
      toast.error('Failed to delete template', { description: e.message })
    }
  }

  async function handleDuplicate(theme) {
    const config = themeToConfig(theme)
    try {
      await createTheme.mutateAsync({ name: `${theme.name} (copy)`, is_default: false, config })
      toast.success(`Copied "${theme.name}" — edit it below`)
    } catch (e) {
      toast.error('Failed to copy template', { description: e.message })
    }
  }

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading templates…</div>

  return (
    <div className="space-y-4">
      <PageHeader
        icon={LayoutTemplate}
        title="Photo Templates"
        subtitle={
          <>
            Built-in layouts — claim cards, split panels, and badge overlays — in dark and light palettes, plus your own. Templates apply per carousel slide and to standalone photos.
          </>
        }
      />

      {/* How a new template gets made. Authoring happens in the carousel editor,
          not here — you dial a look in on real slides and promote it, so what you
          approve is what publishes. This page browses, copies, edits and deletes. */}
      <p className="flex items-start gap-2 rounded-xl border bg-card p-4 text-xs text-muted-foreground">
        <LayoutTemplate className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          To make a new one, open a carousel, style the slides how you want them, then choose{' '}
          <strong className="text-foreground">Save this look as a template</strong> in the Theme panel.
          You design it on real slides, so what you approve is what gets published.
        </span>
      </p>

      {/* Live preview panel */}
      <div className="rounded-xl border bg-card p-4 flex flex-row gap-4 items-start">

        {/* Format picker — vertical stack, one button per platform ratio */}
        <div className="shrink-0 flex flex-col gap-1">
          <div className="text-2xs font-medium text-muted-foreground text-center mb-0.5">Format</div>
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFormatId(f.id)}
              title={f.title}
              className={`w-10 rounded py-1.5 text-2xs font-semibold text-center transition-colors ${
                formatId === f.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Center — responsive canvas, letterboxed to selected format. Grows to
            fill the space freed by the fixed-width template list. */}
        <div className="flex-1 min-w-0 flex flex-col items-center gap-2">
          {/* Canvas container — fluid width, capped so tall formats fit; black
              letterbox bars frame the square 1080×1080 canvas at any ratio. */}
          <div
            className="rounded-lg shadow-sm flex items-center justify-center overflow-hidden mx-auto"
            style={{ width: '100%', maxWidth: maxBoxW, aspectRatio: `1 / ${format.ratio}`, background: '#111' }}
          >
            <div className={`${format.ratio >= 1 ? 'w-full' : 'h-full'} aspect-square`}>
              <LiveThemePreview
                theme={normalizeTheme(selectedTheme)}
                slide={slides[slideKey]}
                brandStyle={brandStyle}
                photoUrl={previewPhotoUrl}
              />
            </div>
          </div>

          {/* Photo picker — gradient chip + workspace recent photos */}
          {recentPhotos.length > 0 && (
            <div className="flex items-center justify-center gap-1.5 flex-wrap" style={{ maxWidth: maxBoxW }}>
              <button
                type="button"
                onClick={() => setPreviewPhotoIdx(-1)}
                aria-label="No photo (gradient)"
                className={`h-8 w-8 rounded-md border-2 transition-colors overflow-hidden shrink-0 ${
                  previewPhotoIdx === -1
                    ? 'border-primary'
                    : 'border-transparent hover:border-primary/40'
                }`}
                style={{ background: 'linear-gradient(135deg,#475569 0%,#1e293b 100%)' }}
              />
              {recentPhotos.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPreviewPhotoIdx(i)}
                  title={`Photo ${i + 1}`}
                  className={`h-8 w-8 rounded-md border-2 transition-colors overflow-hidden shrink-0 ${
                    previewPhotoIdx === i
                      ? 'border-primary'
                      : 'border-transparent hover:border-primary/40'
                  }`}
                >
                  <img src={url} alt="" className="pointer-events-none w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* Slide type toggle */}
          <div className="inline-flex rounded-lg border border-input overflow-hidden">
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
        </div>

        {/* Right rail: fixed-width so the freed space goes to the preview, not
            to uselessly-wide template rows. */}
        <div className="w-72 shrink-0 flex flex-col min-h-0">
          <div className="text-sm font-bold text-foreground leading-tight">{selectedTheme?.name || '—'}</div>
          <div className="text-2xs text-muted-foreground mb-3">{selectedTheme?.builtin ? 'Built-in' : 'Custom'}</div>

          <div className="text-2xs font-medium text-muted-foreground mb-1.5">Template</div>
          <div className="space-y-1 pr-1">
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
                    <ThemePreview theme={t} size="sm" brandAccent={brandAccent} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate flex items-center gap-1.5">
                        {t.name}
                        {t.is_default && (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-2xs font-semibold text-primary">Default</span>
                        )}
                      </div>
                      <div className="text-2xs text-muted-foreground">{t.builtin ? 'Built-in' : 'Custom'}</div>
                    </div>
                  </button>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label="Duplicate template" onClick={() => handleDuplicate(t)} disabled={createTheme.isPending}>
                      <Copy className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    {t.custom && (
                      <>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label="Edit template" onClick={() => setEditing({ theme: t })}>
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" aria-label="Delete template"
                          onClick={() => handleDelete(t)}>
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* New template — a blank block-style config. The usual route to a
              custom template is Duplicate above, or Save this look as a template
              in the carousel editor's Theme panel. */}
          <div className="mt-2 flex flex-col gap-1.5">
            {editing !== 'new' && (
              <button
                type="button"
                onClick={() => setEditing('new')}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors py-0.5 px-1"
              >
                <Plus className="h-3.5 w-3.5" />
                New template
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Theme editor — inline below the panel when creating or editing */}
      {editing && (
        <div ref={editorRef}>
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
      )}
    </div>
  )
}
