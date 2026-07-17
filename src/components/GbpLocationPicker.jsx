import { MapPin } from 'lucide-react'

// Checkbox list letting a tenant narrow a GBP post to a subset of their
// connected locations — "at times social media output may apply to only 1
// location and not all" (Q, 2026-07-17). Used both in the quick New Post flow
// (NewBrief.jsx, local component state) and the Storyboard editor
// (PublishPanel, persisted to content_items.target_locations). Selection
// resolution at publish time lives in src/lib/gbpLocations.js.
export default function GbpLocationPicker({ locations, selectedIds, onToggle, indent = true, className = '' }) {
  if (!locations || locations.length < 2) return null
  return (
    <div className={`${indent ? 'pl-7' : ''} space-y-1 ${className}`}>
      {locations.map((loc) => (
        <label
          key={loc.id}
          className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground"
        >
          <input
            type="checkbox"
            checked={selectedIds.has(loc.id)}
            onChange={() => onToggle(loc.id)}
            className="h-3.5 w-3.5 accent-primary"
          />
          <MapPin className="h-3 w-3 shrink-0" />
          {loc.label}
        </label>
      ))}
    </div>
  )
}
