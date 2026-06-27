import { ArrowLeft } from 'lucide-react'

// EditorChrome — the persistent top bar shared by every editor archetype
// (carousel / story / reel / doc …). It never changes shape across post types;
// only its slots fill differently. This is the "shared chrome" half of the
// unified-shell architecture (the side surface is the part that swaps).
//
// Slots:
//   onBack            back arrow handler
//   title             piece title (truncated)
//   badge             { icon: Component, label, sub }  — the format pill
//   note              optional muted aside (e.g. "3 slides from 2 photos")
//   aspect            { value, options: string[], onChange } | null — aspect seg
//   children          right-aligned action buttons (Preview / Save / Schedule)
//
// Extracted from SlideEditor's header verbatim so wiring it in is a visual no-op.
export default function EditorChrome({ onBack, title, badge, note, aspect, children }) {
  const BadgeIcon = badge?.icon
  return (
    <header className="flex items-center gap-3 border-b bg-card px-4 py-2.5 shrink-0">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center text-muted-foreground hover:text-foreground"
        aria-label="Back"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      </button>

      <span className="text-sm font-semibold truncate max-w-[200px]">{title || 'Untitled'}</span>

      {badge && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-semibold bg-info/10 text-info"
        >
          {BadgeIcon && <BadgeIcon className="h-3.5 w-3.5" />}
          {badge.label}
          {badge.sub ? ` · ${badge.sub}` : ''}
        </span>
      )}

      {note && <span className="hidden text-3xs text-muted-foreground lg:inline">{note}</span>}

      {aspect && aspect.options?.length > 0 && (
        <div className="flex overflow-hidden rounded-md border border-border">
          {aspect.options.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => aspect.onChange(a)}
              className={`px-2 py-0.5 text-2xs font-medium transition-colors ${
                aspect.value === a
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  )
}
