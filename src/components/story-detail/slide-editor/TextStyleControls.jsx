import { useMemo } from 'react'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { ColorPickerPopover } from '@/components/ColorPickerPopover'
import { brandSwatches, NEUTRAL_SWATCHES } from '@/lib/brandSwatches'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import SegRow from './SegRow'
import { TEXT_COLORS } from './shared'

// Per-block text styling — Size / Colour / Weight / Case / Font. All optional;
// "Auto" clears the override so the block inherits the role + theme (renderer
// precedence: block > theme > role). The swatch palette is the brand set.
export default function TextStyleControls({ block, onSet, photoPalette = [] }) {
  const workspace = useWorkspace()
  const swatches = useMemo(() => [...brandSwatches(workspace), ...photoPalette, ...NEUTRAL_SWATCHES], [workspace, photoPalette])
  const scale = Number.isFinite(block.fontScale) && block.fontScale > 0 ? block.fontScale : 1
  return (
    <div className="space-y-3.5 rounded-xl border border-border/60 p-3.5">
      <p className="text-sm font-bold uppercase tracking-wide text-foreground/80">Style</p>

      {/* Size */}
      <div>
        <div className="mb-1 flex justify-between text-sm text-muted-foreground">
          <span>Size</span><span>{Math.round(scale * 100)}%</span>
        </div>
        <input
          type="range" min="0.6" max="1.8" step="0.05" value={scale}
          onChange={(e) => onSet('fontScale', parseFloat(e.target.value))}
          className="h-5 w-full accent-primary" aria-label="Text size"
        />
      </div>

      {/* Text width (wrap width) — 100% = Auto (role default) */}
      <div>
        <div className="mb-1 flex justify-between text-sm text-muted-foreground">
          <span>Text width</span>
          <span>{Number.isFinite(block.width) && block.width > 0 ? `${Math.round(block.width * 100)}%` : 'Auto'}</span>
        </div>
        <input
          type="range" min="0.3" max="1" step="0.05"
          value={Number.isFinite(block.width) && block.width > 0 ? block.width : 1}
          onChange={(e) => { const v = parseFloat(e.target.value); onSet('width', v >= 1 ? null : v) }}
          className="h-5 w-full accent-primary" aria-label="Text width"
        />
      </div>

      {/* Colour */}
      <div>
        <p className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Colour</p>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button" onClick={() => onSet('color', null)}
                className={`h-8 rounded-lg px-2.5 text-sm font-medium ${!block.color ? 'bg-primary/10 text-primary ring-1 ring-primary' : 'bg-muted text-muted-foreground'}`}
              >Auto</button>
            </TooltipTrigger>
            <TooltipContent>Auto (theme)</TooltipContent>
          </Tooltip>
          {TEXT_COLORS.map((c) => (
            <button
              key={c.value} type="button" onClick={() => onSet('color', c.value)} aria-label={c.label}
              className={`h-8 w-8 rounded-full border ${block.color === c.value ? 'ring-2 ring-primary ring-offset-1' : 'border-border'}`}
              style={{ background: c.value }}
            />
          ))}
          <ColorPickerPopover
            value={/^#[0-9a-f]{6}$/i.test(block.color || '') ? block.color : '#ffffff'}
            onChange={(hex) => onSet('color', hex)}
            swatches={swatches}
            swatchClassName="h-8 w-8 rounded-full"
            ariaLabel="Pick custom text color"
          />
        </div>
      </div>

      {photoPalette.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">From photo</p>
          <div className="flex flex-wrap items-center gap-2">
            {photoPalette.map((c) => (
              <button
                key={c} type="button" onClick={() => onSet('color', c)} aria-label={`Photo colour ${c}`}
                className={`h-8 w-8 rounded-full border ${block.color === c ? 'ring-2 ring-primary ring-offset-1' : 'border-border'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      )}

      <SegRow
        label="Weight"
        options={[{ label: 'Auto', value: null }, { label: 'Reg', value: '400' }, { label: 'Med', value: '500' }, { label: 'Bold', value: '700' }]}
        value={block.fontWeight ?? null}
        onPick={(v) => onSet('fontWeight', v)}
      />
      <SegRow
        label="Font"
        options={[{ label: 'Auto', value: null }, { label: 'Heading', value: 'heading' }, { label: 'Body', value: 'body' }]}
        value={block.font ?? null}
        onPick={(v) => onSet('font', v)}
      />
      <SegRow
        label="Align"
        options={[{ label: 'Left', value: 'left' }, { label: 'Center', value: null }, { label: 'Right', value: 'right' }]}
        value={block.align ?? null}
        onPick={(v) => onSet('align', v)}
      />
      {/* Italic / Underline toggles */}
      <div>
        <p className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Format</p>
        <div className="flex gap-1.5">
          {[
            { key: 'italic',    label: 'I',  className: 'italic'    },
            { key: 'underline', label: 'U',  className: 'underline' },
            { key: 'uppercase', label: 'AA', className: 'uppercase' },
          ].map(({ key, label, className: cls }) => {
            const active = block[key] === true
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSet(key, active ? null : true)}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${cls} ${
                  active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Spacing — whole-box letter + line. 0 / 100% = Auto (role default). */}
      <div>
        <p className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Spacing</p>
        <div className="mb-1 flex justify-between text-sm text-muted-foreground">
          <span>Letter</span><span>{Number.isFinite(block.letterSpacing) ? block.letterSpacing : 0}</span>
        </div>
        <input
          type="range" min="-10" max="40" step="1"
          value={Number.isFinite(block.letterSpacing) ? block.letterSpacing : 0}
          onChange={(e) => { const v = parseInt(e.target.value, 10); onSet('letterSpacing', v === 0 ? null : v) }}
          className="h-5 w-full accent-primary" aria-label="Letter spacing"
        />
        <div className="mb-1 mt-2 flex justify-between text-sm text-muted-foreground">
          <span>Line</span><span>{Math.round((Number.isFinite(block.lineHeight) && block.lineHeight > 0 ? block.lineHeight : 1) * 100)}%</span>
        </div>
        <input
          type="range" min="0.8" max="2" step="0.05"
          value={Number.isFinite(block.lineHeight) && block.lineHeight > 0 ? block.lineHeight : 1}
          onChange={(e) => { const v = parseFloat(e.target.value); onSet('lineHeight', v === 1 ? null : v) }}
          className="h-5 w-full accent-primary" aria-label="Line height"
        />
      </div>

      {/* Text effect (WS3.2) — one-tap legibility over busy photos. The same
          renderer bakes preview AND publish, so what you see here ships. */}
      <div>
        <SegRow
          label="Text effect"
          options={[
            { label: 'None', value: 'none' },
            { label: 'Shadow', value: 'shadow' },
            { label: 'Outline', value: 'outline' },
            { label: 'Glow', value: 'glow' },
            { label: 'Label', value: 'label' },
          ]}
          value={block.textEffect ?? 'shadow'}
          onPick={(v) => onSet('textEffect', v)}
        />
        {(block.textEffect ?? 'shadow') !== 'none' && (
          <>
            <div className="mb-1 mt-2 flex justify-between text-sm text-muted-foreground">
              <span>Intensity</span>
              <span>{['Soft', 'Medium', 'Strong'][(block.effectIntensity ?? 2) - 1]}</span>
            </div>
            <input
              type="range" min="1" max="3" step="1"
              value={block.effectIntensity ?? 2}
              onChange={(e) => onSet('effectIntensity', parseInt(e.target.value, 10))}
              className="h-5 w-full accent-primary" aria-label="Effect intensity"
            />
            {['outline', 'glow', 'label'].includes(block.textEffect) && (
              <div className="mt-2">
                <p className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Effect colour</p>
                <div className="flex gap-2">
                  {[
                    { k: '#000000', bg: '#000000' },
                    { k: '#ffffff', bg: '#ffffff' },
                    { k: 'brand',   bg: 'hsl(var(--primary))' },
                    { k: 'action',  bg: 'hsl(var(--action))' },
                  ].map((sw) => {
                    const active = (block.effectColor ?? (block.textEffect === 'label' ? '#ffffff' : block.textEffect === 'glow' ? 'brand' : '#000000')) === sw.k
                    return (
                      <button
                        key={sw.k} type="button"
                        onClick={() => onSet('effectColor', sw.k)}
                        className={`h-7 w-7 rounded-full border-2 transition-colors ${active ? 'border-primary' : 'border-border hover:border-primary/50'}`}
                        style={{ background: sw.bg }}
                        aria-label={`Effect colour ${sw.k}`}
                      />
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
