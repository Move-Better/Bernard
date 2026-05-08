import { useState, useEffect, useCallback } from 'react'
import { Loader2, Plus, FolderPlus, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  listCollections,
  addAssetsToCollection,
  createCollection,
} from '@/lib/collectionsLib'
import { useUserRole } from '@/lib/useUserRole'

// Sticky action bar shown when multi-select is active. Surfaces a count and
// bulk actions over the current selection. v1 ships "Add to collection";
// further bulk actions (archive, status change, etc.) can slot in alongside.
//
// Selection state is owned by MediaHub.jsx; this component only renders the
// UI and dispatches the bulk mutations. `onChange` lets the parent refresh
// collection chip counts after a successful add.
export default function BulkActionBar({
  selectedIds,
  onClear,
  onExit,
  onChange,
}) {
  const { canEdit } = useUserRole()
  const [picking, setPicking]         = useState(false)
  const [collections, setCollections] = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const [busy, setBusy]               = useState(null) // collection id (or 'new') while in flight
  const [justAdded, setJustAdded]     = useState(null) // id of last collection added — brief checkmark
  const [creating, setCreating]       = useState(false)
  const [newName, setNewName]         = useState('')
  const [error, setError]             = useState('')

  const count = selectedIds.length

  const loadCollections = useCallback(async () => {
    setLoadingList(true); setError('')
    try {
      const rows = await listCollections({ status: 'active', limit: 200 })
      setCollections(rows)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingList(false)
    }
  }, [])

  // Hydrate the picker the first time it opens, and again on each open so
  // newly-created collections from elsewhere in the page show up.
  useEffect(() => {
    if (picking) loadCollections()
  }, [picking, loadCollections])

  // Auto-clear the "just added" indicator after a moment.
  useEffect(() => {
    if (!justAdded) return
    const t = setTimeout(() => setJustAdded(null), 1400)
    return () => clearTimeout(t)
  }, [justAdded])

  async function addToExisting(collection) {
    if (!count) return
    setBusy(collection.id); setError('')
    try {
      await addAssetsToCollection(collection.id, selectedIds)
      setJustAdded(collection.id)
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function submitNew() {
    const name = newName.trim()
    if (!name || !count) return
    setBusy('new'); setError('')
    try {
      const created = await createCollection({ name, kind: 'campaign' })
      await addAssetsToCollection(created.id, selectedIds)
      setCollections((prev) => [{ ...created, item_count: count }, ...prev])
      setJustAdded(created.id)
      setCreating(false); setNewName('')
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="sticky top-2 z-30">
      <div className="rounded-lg border bg-background/95 backdrop-blur shadow-sm p-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium pl-1">
            {count === 0
              ? 'Select media…'
              : `${count} selected`}
          </span>

          {canEdit && count > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPicking((v) => !v)}
              className="h-7 gap-1.5 text-[11px] rounded-full"
            >
              <Plus className="h-3.5 w-3.5" />
              Add to collection
            </Button>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {count > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onClear}
                className="h-7 text-[11px]"
              >
                Clear
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={onExit}
              className="h-7 text-[11px] gap-1"
              title="Exit selection mode"
            >
              <X className="h-3.5 w-3.5" />
              Done
            </Button>
          </div>
        </div>

        {picking && canEdit && count > 0 && (
          <div className="rounded-md border bg-muted/40 p-2 space-y-2">
            {loadingList ? (
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading collections…
              </span>
            ) : collections.length === 0 && !creating ? (
              <div className="text-[11px] text-muted-foreground italic">
                No collections yet — create one below.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {collections.map((c) => {
                  const isBusy = busy === c.id
                  const wasAdded = justAdded === c.id
                  return (
                    <button
                      key={c.id}
                      onClick={() => addToExisting(c)}
                      disabled={isBusy}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-border bg-background hover:border-primary/50 disabled:opacity-60 flex items-center gap-1.5"
                      title={c.description || c.name}
                    >
                      {isBusy
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : wasAdded
                          ? <Check className="h-3 w-3 text-emerald-600" />
                          : <Plus className="h-3 w-3" />}
                      <span className="truncate max-w-[160px]">{c.name}</span>
                      {c.item_count > 0 && (
                        <span className="text-muted-foreground">· {c.item_count}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {!creating ? (
              <div className="flex gap-2">
                <Button
                  size="sm" variant="ghost"
                  onClick={() => setCreating(true)}
                  className="h-7 gap-1.5 text-[11px]"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  New collection…
                </Button>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => setPicking(false)}
                  className="h-7 text-[11px]"
                >
                  Close
                </Button>
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitNew()
                    if (e.key === 'Escape') { setCreating(false); setNewName('') }
                  }}
                  placeholder="New collection name"
                  className="h-8 px-2 text-sm flex-1 rounded-md border border-border bg-background"
                />
                <Button
                  size="sm"
                  onClick={submitNew}
                  disabled={busy === 'new' || !newName.trim()}
                  className="h-8"
                >
                  {busy === 'new' && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  Create + add
                </Button>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => { setCreating(false); setNewName('') }}
                  className="h-8"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {error && <div className="text-[11px] text-destructive px-1">{error}</div>}
      </div>
    </div>
  )
}
