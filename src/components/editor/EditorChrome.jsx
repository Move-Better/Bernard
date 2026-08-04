import { ArrowLeft } from 'lucide-react'

// EditorChrome — the persistent top bar shared by every editor archetype
// (carousel / story / reel / doc …). It never changes shape across post types;
// only its slots fill differently. This is the "shared chrome" half of the
// unified-shell architecture (the side surface is the part that swaps).
//
// Slots:
//   onBack            back arrow handler
//   title             piece title (truncated)
//   destination       { icon, label, colorClass, bgClass, borderClass } | null —
//                     WHERE this piece publishes (platform pill). Shown first so
//                     an editor never hides its own destination; feed it from
//                     PLATFORM_META so it matches the rest of the app.
//   badge             { icon: Component, label, sub }  — the format pill
//   note              optional muted aside (e.g. "3 slides from 2 photos")
//   format            { value, options: [{id,label,disabled?,title?}], onChange } | null
//   aspect            { value, options: string[], onChange } | null — aspect seg
//   children          right-aligned action buttons (Preview / Save / Schedule)
//
// Extracted from SlideEditor's header verbatim so wiring it in is a visual no-op.
export default function EditorChrome({ onBack, title, destination, badge, note, format, aspect, children }) {
  const BadgeIcon = badge?.icon
  const DestIcon = destination?.icon
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

      {destination && (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-semibold ${destination.bgClass || ''} ${destination.colorClass || ''} ${destination.borderClass || 'border-transparent'}`}
        >
          {DestIcon && <DestIcon className="h-3.5 w-3.5" aria-hidden="true" />}
          {destination.label}
        </span>
      )}

      <span className={`text-sm font-semibold truncate max-w-[200px] ${destination ? 'text-muted-foreground' : ''}`}>{title || 'Untitled'}</span>

      {badge && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-semibold"
          style={{ background: 'hsl(var(--info)/.12)', color: 'hsl(var(--info))' }}
        >
          {BadgeIcon && <BadgeIcon className="h-3.5 w-3.5" />}
          {badge.label}
          {badge.sub ? ` · ${badge.sub}` : ''}
        </span>
      )}

      {note && <span className="hidden text-3xs text-muted-foreground lg:inline">{note}</span>}

      {/* Format — the piece's PUBLISH shape (post / carousel / reel / story),
          persisted to content_items.format. Sits next to the badge because the
          badge describes the same thing; before this control the format was
          derived from whatever media happened to be attached, so a video always
          hijacked the piece into a Reel and a clip could never sit inside a
          carousel. An option is disabled (not hidden) when the current media
          can't satisfy it — the label still teaches what the platform offers,
          and `title` carries the reason. */}
      {format && format.options?.length > 1 && (
        <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Post format">
          {format.options.map((f) => (
            <button
              key={f.id}
              type="button"
              disabled={f.disabled}
              title={f.title || undefined}
              aria-pressed={format.value === f.id}
              onClick={() => format.onChange(f.id)}
              className={`px-2 py-0.5 text-2xs font-medium transition-colors ${
                format.value === f.id
                  ? 'bg-primary text-primary-foreground'
                  : f.disabled
                    ? 'cursor-not-allowed text-muted-foreground/40'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

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
