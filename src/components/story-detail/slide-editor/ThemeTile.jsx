import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { resolveTheme } from '@/lib/photoTemplates'
import MiniSlideCanvas from './MiniSlideCanvas'

// One template tile — a real rendered miniature of the active slide in that
// template. Module scope (react-hooks/static-components); reused by both the
// Photo-templates and Text-cards groups in the picker.
export default function ThemeTile({ t, slide, photoUrl, brandStyle, customThemes, thumbSig, onChange }) {
  const resolved = resolveTheme(t.id, customThemes)
  const selected = slide.template_id === t.id
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onChange({ ...slide, template_id: t.id })}
          className={`group relative overflow-hidden rounded-md border text-left transition-all ${
            selected ? 'border-verbatim-accent ring-1 ring-verbatim-accent/40' : 'border-border hover:border-primary/40'
          }`}
        >
          <div className="aspect-[4/5] w-full bg-muted">
            <MiniSlideCanvas
              renderSlide={slide}
              photoUrl={photoUrl}
              brandStyle={brandStyle}
              theme={resolved}
              renderKey={`${t.id}|${thumbSig}`}
            />
          </div>
          <div className="px-2 py-1.5 text-xs font-medium truncate text-foreground">{t.name}</div>
          {selected && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-verbatim-accent ring-1 ring-verbatim-accent/40" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{`${t.name}${selected ? ' (this slide only)' : ''}`}</TooltipContent>
    </Tooltip>
  )
}
