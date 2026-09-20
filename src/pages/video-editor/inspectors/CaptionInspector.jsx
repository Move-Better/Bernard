import { HEX6_RE, fmt } from '../constants'
import { InspectorShell, segBtn } from '../shared'
import { CAPTION_STYLE_OPTS, captionCss } from '../captions'
import { WORKSPACE_DEFAULT_ACCENT, workspaceCaptionAccent } from '@/lib/brandSwatches'
import { Captions, LayoutTemplate, Loader2, Sparkles } from 'lucide-react'

export function CaptionInspector({ ctx }) {
  const { asset, caption, setCaption, lines, genCaptions, genCaptionsPending, captionsEdited, resetCaptions, openSaveTemplate, captionsBaked, displayClipT, editLine, editCaptionLine, logCaptionCorrection } = ctx
  // A caption-baked clip with no clean source (a manually-exported broll) is
  // edited from its own already-captioned blob, so restyling here would double
  // the track. The controls are replaced with a plain explanation instead of
  // silently doing nothing. Trim/reframe/grade/music still apply (they don't
  // touch the caption pixels), and the true fix is re-exporting from the source.
  if (captionsBaked) {
    return (
      <InspectorShell icon={Captions} title="Karaoke captions" right="baked in">
        <div className="rounded-md border border-dashed p-3 text-2xs leading-relaxed" style={{ color: 'hsl(var(--muted-foreground))' }}>
          This clip&rsquo;s captions are <span className="font-semibold" style={{ color: 'hsl(var(--foreground))' }}>baked into the video</span>, so they can&rsquo;t be restyled here. Trim, reframe, grade, and music still apply. To change the words, re-export the clip from its original source.
        </div>
      </InspectorShell>
    )
  }
  // The workspace's own brand primary — the SAME value the hydration effect
  // (workspaceCaptionAccent(asset.workspace), above) already seeds caption.accent
  // with, and what the server bake falls back to when no explicit accent is
  // sent. The swatch row used to offer Bernard's own product colors (this
  // app's teal + amber) instead, so a workspace whose brand differs from
  // Bernard's UI had no swatch for its own already-selected default — only the
  // custom color wheel could get back to it. Leading with it here makes the
  // picker match what it's actually picking.
  const wsPrimary = workspaceCaptionAccent(asset?.workspace) || WORKSPACE_DEFAULT_ACCENT
  const seg = (label, opts, key) => (
    <div className="mb-3">
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex gap-1.5">
        {opts.map((o) => <button key={o} onClick={() => setCaption(key, o)} className="flex-1 rounded-md border py-1.5 text-2xs" style={segBtn(caption[key] === o)}>{o[0].toUpperCase() + o.slice(1)}</button>)}
      </div>
    </div>
  )
  return (
    <InspectorShell icon={Captions} title="Karaoke captions" right="on-screen · from transcript">
      <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>On-screen words</p>
      <div className="mb-3 flex gap-1.5">
        {['karaoke', 'off'].map((p) => <button key={p} onClick={() => setCaption('preset', p)} className="flex-1 rounded-md border py-1.5 text-3xs" style={segBtn(caption.preset === p)}>{p === 'karaoke' ? 'On' : 'Off'}</button>)}
      </div>
      {caption.preset !== 'off' && (
        <div className="mb-3">
          <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Style</p>
          <div className="grid grid-cols-2 gap-1.5">
            {CAPTION_STYLE_OPTS.map((o) => {
              const on = (caption.style || 'bold') === o.id
              const css = captionCss(o.id, caption.accent)
              return (
                <button key={o.id} onClick={() => setCaption('style', o.id)} className="rounded-md border p-1.5" style={segBtn(on)}>
                  <span className="flex h-6 items-center justify-center rounded" style={{ background: '#26302a' }}>
                    <span className="text-3xs font-extrabold leading-none" style={{ display: 'inline-block', ...css.wrap }}><span style={css.active}>Aa</span></span>
                  </span>
                  <span className="mt-1 block text-3xs">{o.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {caption.preset !== 'off' && (
        <div className="mb-3">
          <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Highlight colour</p>
          <div className="flex items-center gap-1.5">
            {/* tenant brand + neutrals only — never a Bernard product color (#0C7580/#d97706). */}
            {[wsPrimary, '#ffffff', '#111111'].map((c, i) => {
              const on = (caption.accent || '').toLowerCase() === c.toLowerCase()
              return <button key={c} type="button" onClick={() => setCaption('accent', c)} aria-label={i === 0 ? `Your brand colour ${c}` : `Caption colour ${c}`} title={i === 0 ? 'Your brand colour (default)' : undefined} className="h-6 w-6 rounded-full border" style={{ background: c, borderColor: on ? 'hsl(var(--primary))' : 'hsl(var(--border))', boxShadow: on ? '0 0 0 1.5px hsl(var(--primary))' : undefined }} />
            })}
            <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border" style={{ borderColor: 'hsl(var(--border))' }} title="Custom colour">
              <span className="absolute inset-0" style={{ background: 'conic-gradient(from 90deg, #f44, #fd4, #4d4, #4dd, #44f, #f4f, #f44)' }} aria-hidden="true" />
              <input type="color" value={HEX6_RE.test(caption.accent || '') ? caption.accent : wsPrimary} onChange={(e) => setCaption('accent', e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Custom caption colour" />
            </label>
          </div>
        </div>
      )}
      {caption.preset !== 'off' && (
        <div className="mb-3">
          <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Animation</p>
          <div className="flex gap-1.5">
            {[['none', 'None'], ['pop', 'Pop'], ['fade', 'Fade']].map(([v, l]) => <button key={v} onClick={() => setCaption('anim', v)} className="flex-1 rounded-md border py-1.5 text-3xs" style={segBtn((caption.anim || 'none') === v)}>{l}</button>)}
          </div>
          <p className="mt-1 text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Entrance effect — shown in the exported video.</p>
        </div>
      )}
      {seg('Position', ['top', 'center', 'bottom'], 'position')}
      {seg('Size', ['small', 'medium', 'large'], 'size')}
      {lines.length === 0 ? (
        <button onClick={genCaptions} disabled={genCaptionsPending} className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border py-2 text-2xs disabled:opacity-60" style={{ borderColor: 'hsl(var(--action))', background: 'hsl(var(--action)/0.06)', color: 'hsl(var(--action))' }}>
          {genCaptionsPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Transcribing…</> : <><Sparkles className="h-3.5 w-3.5" />Generate captions</>}
        </button>
      ) : (
        <div className="mt-2">
          {/* Caption-lines list — every spoken line as a readable, editable row,
              beside the preview instead of an oversized input on the video frame
              (Philip's report: on-frame text clipped a full line at the edges).
              Each row edits text only for v1; it commits through the existing
              editLine(idx, text), so the bake/publish path is unchanged. The row
              at the playhead is highlighted (displayClipT, same test the timeline
              caption lane uses); tapping a row seeks there via editCaptionLine. */}
          <p className="mb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Caption lines · tap to edit</p>
          <div className="flex max-h-60 flex-col gap-1 overflow-auto rounded-md border p-1" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted)/0.4)' }}>
            {lines.map((l, i) => {
              const active = displayClipT >= l.start && displayClipT < l.end
              return (
                // key includes the text so a programmatic change (reset / regen /
                // a committed edit) remounts the uncontrolled input with the fresh
                // value, while in-progress typing (text unchanged until blur)
                // keeps a stable key and doesn't lose the caret.
                <div
                  key={`${i}:${l.text}`}
                  onClick={() => editCaptionLine(i)}
                  className="flex cursor-text items-start gap-1.5 rounded-md border px-1.5 py-1 transition-colors"
                  style={active
                    ? { borderColor: 'hsl(var(--primary))', background: 'hsl(var(--primary)/0.08)' }
                    : { borderColor: 'transparent', background: 'hsl(var(--card))' }}
                >
                  <span className="shrink-0 pt-px font-mono text-3xs tabular-nums" style={{ color: active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}>{fmt(l.start)}</span>
                  <input
                    defaultValue={l.text}
                    aria-label={`Caption line at ${fmt(l.start)}`}
                    onBlur={(e) => { const v = e.target.value; if (v.trim() && v !== l.text) { editLine(i, v); logCaptionCorrection?.(l.text, v, 'line') } }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
                    className="w-full min-w-0 bg-transparent text-2xs outline-none"
                    style={{ color: 'hsl(var(--foreground))', fontWeight: active ? 600 : 400 }}
                  />
                  {l.userEdited && <span className="shrink-0 pt-px text-3xs font-bold" title="Edited" style={{ color: 'hsl(var(--action))' }}>·</span>}
                </div>
              )
            })}
          </div>
          {captionsEdited && (
            <button onClick={resetCaptions} className="mt-1.5 w-full rounded-md py-1.5 text-3xs text-muted-foreground underline-offset-2 hover:underline">Reset captions to transcript</button>
          )}
        </div>
      )}
      {/* Mirrors "Save as Brand look" in the Grade inspector — dial the look in
          on a real clip, then promote it. */}
      <button
        onClick={openSaveTemplate}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border py-2 text-2xs"
        style={{ borderColor: 'hsl(var(--primary))', background: 'hsl(var(--primary)/0.06)', color: 'hsl(var(--primary))' }}
      >
        <LayoutTemplate className="h-3.5 w-3.5" />Save as video template
      </button>
    </InspectorShell>
  )
}
