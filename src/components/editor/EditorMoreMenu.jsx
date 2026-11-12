import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// EditorMoreMenu — the labelled "More" button at the right end of every
// editor's top bar (post editor audit option A, 2026-11-11). It holds the
// things that used to sit loose in the bar or behind an unlabelled icon:
// version history, the full publish panel, ads, render-without-approving.
// Same place, same name in every editor.
//
// items: [{ key, icon, label, sub?, onClick, hidden? }]
export default function EditorMoreMenu({ items }) {
  const [open, setOpen] = useState(false)
  const shown = (items || []).filter((it) => it && !it.hidden)
  if (!shown.length) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-muted"
          aria-label="More options"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          More
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        {shown.map((it) => {
          const Icon = it.icon
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => { setOpen(false); it.onClick?.() }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-accent"
            >
              {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
              <span>
                <span className="block text-xs font-semibold text-foreground">{it.label}</span>
                {it.sub && <span className="block text-2xs text-muted-foreground">{it.sub}</span>}
              </span>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
