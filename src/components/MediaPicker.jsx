import { useState, useEffect, useRef } from 'react'
import { useUser } from '@clerk/clerk-react'
import { Search, X, Loader2, Image, Video, Upload, Check, Play, Library, Layers, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listMedia, uploadMedia } from '@/lib/mediaLib'
import { listCollections } from '@/lib/collectionsLib'

// Picker for attaching media to a post. Three tabs:
//   1. Library     — all workspace media, filterable by kind + collection.
//   2. Collections — browse named collections, drill into one to pick from it.
//   3. Upload      — fresh upload that lands in the same library.
//
// The previous "Google Drive" tab and its proxy paths were removed when the
// Drive integration was retired (2026-05-08).

const PAGE_SIZE = 60

const KIND_OPTIONS = [
  { id: 'all',   label: 'All' },
  { id: 'photo', label: 'Photos' },
  { id: 'video', label: 'Videos' },
]

const KIND_COLORS = {
  campaign: 'bg-violet-100 text-violet-700',
  series:   'bg-blue-100 text-blue-700',
  session:  'bg-emerald-100 text-emerald-700',
  adhoc:    'bg-slate-100 text-slate-600',
}

const KIND_LABELS = {
  campaign: 'Campaign',
  series:   'Series',
  session:  'Session',
  adhoc:    'Ad-hoc',
}

export default function MediaPicker({ onSelect, onClose }) {
  const { user } = useUser()
  const [tab, setTab]             = useState('library')
  const [query, setQuery]         = useState('')
  const [kind, setKind]           = useState('all')
  const [collectionId, setCollectionId] = useState('')
  const [selected, setSelected]   = useState(null)
  const [libraryItems, setLibraryItems] = useState([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError]   = useState('')
  const [hasMore, setHasMore]     = useState(false)
  const [page, setPage]           = useState(0)
  const [collections, setCollections] = useState([])
  const [collectionsLoading, setCollectionsLoading] = useState(false)
  // activeCollection: the collection the user drilled into from the Collections tab.
  const [activeCollection, setActiveCollection] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef(null)
  const debounceRef  = useRef(null)

  async function loadLibrary({ q = '', kindFilter = 'all', colId = '', pageNum = 0, append = false } = {}) {
    setLibraryLoading(true)
    if (!append) setLibraryError('')
    try {
      const rows = await listMedia({
        q:            q || undefined,
        kind:         kindFilter !== 'all' ? kindFilter : undefined,
        collectionId: colId || undefined,
        limit:        PAGE_SIZE,
        offset:       pageNum * PAGE_SIZE,
      })
      setLibraryItems(prev => append ? [...prev, ...rows] : rows)
      setHasMore(rows.length === PAGE_SIZE)
    } catch (e) {
      setLibraryError(e.message)
    } finally {
      setLibraryLoading(false)
    }
  }

  async function loadCollections() {
    setCollectionsLoading(true)
    try {
      const data = await listCollections({ limit: 100 })
      setCollections(Array.isArray(data) ? data : (data?.collections ?? []))
    } catch {
      // non-fatal — dropdown just stays empty
    } finally {
      setCollectionsLoading(false)
    }
  }

  // Load collections once on mount.
  useEffect(() => { loadCollections() }, [])

  // Reload from page 0 when tab, kind, or collection dropdown changes.
  useEffect(() => {
    if (tab !== 'library') return
    setSelected(null)
    setPage(0)
    loadLibrary({ q: query, kindFilter: kind, colId: collectionId, pageNum: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, kind, collectionId])

  // Reset collection drill-down when leaving the Collections tab.
  useEffect(() => {
    if (tab !== 'collections') setActiveCollection(null)
  }, [tab])

  function handleQueryChange(e) {
    const val = e.target.value
    setQuery(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (tab === 'library') {
        setSelected(null)
        setPage(0)
        loadLibrary({ q: val, kindFilter: kind, colId: collectionId, pageNum: 0 })
      }
    }, 400)
  }

  function handleLoadMore() {
    const next = page + 1
    setPage(next)
    const colId = activeCollection ? activeCollection.id : collectionId
    loadLibrary({ q: query, kindFilter: kind, colId, pageNum: next, append: true })
  }

  function drillIntoCollection(col) {
    setActiveCollection(col)
    setSelected(null)
    setPage(0)
    setKind('all')
    loadLibrary({ kindFilter: 'all', colId: col.id, pageNum: 0 })
  }

  function backToCollections() {
    setActiveCollection(null)
    setLibraryItems([])
    setHasMore(false)
    setKind('all')
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setUploadError('')
    try {
      const blob    = await uploadMedia(file, { createdBy: user?.id || null })
      const isVideo = (file.type || blob.contentType || '').startsWith('video')
      onSelect({
        id:           crypto.randomUUID(),
        name:         file.name,
        mimeType:     file.type || blob.contentType,
        kind:         isVideo ? 'video' : 'image',
        type:         isVideo ? 'video' : 'image',
        thumbnailUrl: isVideo ? null : blob.url,
        url:          blob.url,
        size:         file.size,
      })
    } catch (err) {
      setUploadError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function selectLibraryAsset(asset) {
    const isVideo = asset.kind === 'video'
    const url     = asset.rendered_url || asset.blob_url
    onSelect({
      id:           asset.id,
      name:         asset.filename,
      mimeType:     asset.mime_type,
      kind:         isVideo ? 'video' : 'image',
      type:         isVideo ? 'video' : 'image',
      thumbnailUrl: asset.thumbnail_url || (isVideo ? null : url),
      url,
      size:         asset.size_bytes || undefined,
      mediaAssetId: asset.id,
    })
  }

  // Shared asset grid — used by both Library tab and Collections drill-down.
  function renderAssetGrid() {
    if (libraryError) {
      return <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 text-center">{libraryError}</div>
    }
    if (libraryLoading && libraryItems.length === 0) {
      return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    }
    if (libraryItems.length === 0) {
      return (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {kind !== 'all' || collectionId || query || activeCollection
            ? 'No media matches your filters.'
            : 'No media in your library yet. Use the Upload tab or visit the Media page to add some.'}
        </div>
      )
    }
    return (
      <>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {libraryItems.map((a) => {
            const isSelected = selected?.id === a.id
            const previewSrc = a.thumbnail_url || (a.kind === 'photo' ? (a.rendered_url || a.blob_url) : null)
            return (
              <button
                key={a.id}
                onClick={() => setSelected(isSelected ? null : a)}
                className={`relative rounded-lg overflow-hidden border-2 aspect-square transition-all ${
                  isSelected ? 'border-primary' : 'border-transparent hover:border-muted-foreground/30'
                }`}
              >
                {a.kind === 'video' ? (
                  <div className="relative h-full w-full">
                    {previewSrc ? (
                      <img src={previewSrc} alt={a.filename} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    ) : (
                      <div className="h-full bg-slate-800 flex flex-col items-center justify-center gap-1 px-1">
                        <Video className="h-5 w-5 text-slate-400 shrink-0" />
                        <span className="text-[9px] text-slate-400 text-center leading-tight line-clamp-3">{a.filename}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="h-7 w-7 rounded-full bg-black/55 flex items-center justify-center">
                        <Play className="h-3.5 w-3.5 text-white ml-0.5" />
                      </div>
                    </div>
                  </div>
                ) : previewSrc ? (
                  <img src={previewSrc} alt={a.filename} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                ) : (
                  <div className="h-full bg-muted flex items-center justify-center">
                    <Image className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}

                {(a.status === 'rendered' || a.status === 'approved') && (
                  <span className="absolute top-1 left-1 text-[9px] font-medium px-1 py-0.5 rounded bg-violet-100 text-violet-700">
                    {a.status === 'approved' ? 'Approved' : 'Branded'}
                  </span>
                )}

                {isSelected && (
                  <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                    <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                      <Check className="h-3.5 w-3.5 text-white" />
                    </div>
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {hasMore && (
          <div className="pt-4 pb-1 flex justify-center">
            <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={libraryLoading} className="text-xs">
              {libraryLoading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Loading…</>
                : 'Load more'}
            </Button>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold">Add Media</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-5 shrink-0">
          {[
            { id: 'library',     label: 'Library',     icon: Library },
            { id: 'collections', label: 'Collections', icon: Layers },
            { id: 'upload',      label: 'Upload',      icon: Upload },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-3 text-sm border-b-2 transition-colors -mb-px ${
                tab === id
                  ? 'border-primary text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>

        {/* ── Library tab ───────────────────────────────────────────────────── */}
        {tab === 'library' && (
          <>
            <div className="px-5 pt-3 pb-2.5 border-b shrink-0 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={handleQueryChange}
                  placeholder="Search your media library…"
                  className="pl-8 pr-8 h-8 text-sm"
                />
                {query && (
                  <button
                    onClick={() => { setQuery(''); setSelected(null); setPage(0); loadLibrary({ kindFilter: kind, colId: collectionId, pageNum: 0 }) }}
                    className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex gap-1">
                  {KIND_OPTIONS.map(({ id, label }) => (
                    <button
                      key={id}
                      onClick={() => setKind(id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        kind === id
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {collections.length > 0 && (
                  <select
                    value={collectionId}
                    onChange={e => setCollectionId(e.target.value)}
                    className="text-xs h-7 px-2 pr-6 rounded-md border bg-background text-foreground cursor-pointer appearance-none"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%236b7280\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
                  >
                    <option value="">All collections</option>
                    {collections.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}

                {(kind !== 'all' || collectionId) && (
                  <button
                    onClick={() => { setKind('all'); setCollectionId('') }}
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <X className="h-3 w-3" />Clear filters
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
              {renderAssetGrid()}
            </div>

            <div className="px-5 py-3 border-t flex items-center justify-between shrink-0">
              <p className="text-xs text-muted-foreground truncate max-w-[55%]" title={selected?.filename || selected?.name || ''}>
                {selected ? `Selected: ${selected.filename || selected.name}` : 'Pick a file from your library'}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                <Button size="sm" onClick={() => selected && selectLibraryAsset(selected)} disabled={!selected}>
                  Use This File
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ── Collections tab ───────────────────────────────────────────────── */}
        {tab === 'collections' && (
          <>
            {!activeCollection ? (
              /* Collection card grid */
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                {collectionsLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : collections.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground text-sm">
                    No collections yet. Create one from the Media Hub to organize your assets.
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {collections.map(col => (
                      <button
                        key={col.id}
                        onClick={() => drillIntoCollection(col)}
                        className="rounded-xl border bg-card hover:bg-accent/40 transition-colors text-left overflow-hidden group"
                      >
                        {/* Card header */}
                        <div className={`h-16 flex items-center justify-center ${KIND_COLORS[col.kind] || 'bg-slate-100 text-slate-600'} group-hover:opacity-90 transition-opacity`}>
                          <Layers className="h-7 w-7 opacity-60" />
                        </div>
                        {/* Card body */}
                        <div className="px-3 py-2.5">
                          <p className="text-sm font-medium leading-tight line-clamp-2 mb-1">{col.name}</p>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${KIND_COLORS[col.kind] || 'bg-slate-100 text-slate-600'}`}>
                              {KIND_LABELS[col.kind] || col.kind}
                            </span>
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              {col.item_count ?? 0} {col.item_count === 1 ? 'item' : 'items'}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Drill-down: assets inside the selected collection */
              <>
                {/* Breadcrumb + kind filter */}
                <div className="px-5 pt-3 pb-2.5 border-b shrink-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={backToCollections}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />Collections
                    </button>
                    <span className="text-muted-foreground text-xs">/</span>
                    <span className="text-sm font-medium truncate">{activeCollection.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">
                      {activeCollection.item_count ?? 0} {activeCollection.item_count === 1 ? 'item' : 'items'}
                    </span>
                  </div>

                  <div className="flex gap-1">
                    {KIND_OPTIONS.map(({ id, label }) => (
                      <button
                        key={id}
                        onClick={() => {
                          setKind(id)
                          setSelected(null)
                          setPage(0)
                          loadLibrary({ kindFilter: id, colId: activeCollection.id, pageNum: 0 })
                        }}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                          kind === id
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
                  {renderAssetGrid()}
                </div>

                <div className="px-5 py-3 border-t flex items-center justify-between shrink-0">
                  <p className="text-xs text-muted-foreground truncate max-w-[55%]" title={selected?.filename || selected?.name || ''}>
                    {selected ? `Selected: ${selected.filename || selected.name}` : 'Pick a file from this collection'}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                    <Button size="sm" onClick={() => selected && selectLibraryAsset(selected)} disabled={!selected}>
                      Use This File
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Upload tab ────────────────────────────────────────────────────── */}
        {tab === 'upload' && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
            <div
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`w-full border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
                uploading ? 'cursor-wait opacity-70' : 'cursor-pointer hover:border-primary/50 hover:bg-accent/20'
              }`}
            >
              {uploading
                ? <Loader2 className="h-10 w-10 text-muted-foreground/60 mx-auto mb-3 animate-spin" />
                : <Upload className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />}
              <p className="text-sm font-medium mb-1">
                {uploading ? 'Uploading…' : 'Click to upload a photo or video'}
              </p>
              <p className="text-xs text-muted-foreground">
                {uploading ? 'Saving to your media library' : 'JPG, PNG, HEIC, MP4, MOV — saved to your library and added to this post'}
              </p>
            </div>
            {uploadError && (
              <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 max-w-md text-center">
                {uploadError}
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleUpload} />
            <Button variant="outline" size="sm" onClick={onClose} disabled={uploading}>Cancel</Button>
          </div>
        )}

      </div>
    </div>
  )
}
