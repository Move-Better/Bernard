// SaveStatus — replaces a manual Save button with a passive status readout,
// for editors wired to useAutosave. Renders in the EditorChrome action slot.

import { Check, Loader2, AlertTriangle } from 'lucide-react'

export default function SaveStatus({ status }) {
  if (status === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-2xs text-destructive">
        <AlertTriangle className="h-3 w-3" />
        Couldn&apos;t save
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <Check className="h-3 w-3" />
        All changes saved
      </span>
    )
  }
  return null
}
