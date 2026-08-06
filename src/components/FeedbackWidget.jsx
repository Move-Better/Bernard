import { useState, useRef, useCallback, useEffect } from 'react'
import { useUser } from '@clerk/react'
import { MessageSquare, X, Camera, Paperclip, Send, CheckCircle, Loader2, Minus, GripVertical } from 'lucide-react'
import { useWorkspaceState } from '@/lib/WorkspaceContext'
import { apiFetch } from '@/lib/api'

// A full-resolution screen/tab capture (getDisplayMedia + PNG) routinely
// exceeds Vercel's ~4.5MB function body limit, so the submission 413s and
// the user just sees "Something went wrong" — the message they typed is
// lost along with the screenshot. Downscale + re-encode as JPEG before it
// ever reaches state, so every screenshot path stays well under the limit.
const MAX_SCREENSHOT_DIM = 1600
const SCREENSHOT_JPEG_QUALITY = 0.82

// Persisted panel position + minimized state. Users kept reporting the panel
// covering the exact content they were trying to show (and baking itself into
// the screenshot). It's now a draggable, minimizable floating panel that
// remembers where it was last left across sessions.
const STORAGE_KEY = 'feedbackWidget:v2'
const EDGE_GAP = 8 // keep this many px between the panel and the viewport edge

function encodeScreenshot(source, width, height) {
  const scale = Math.min(1, MAX_SCREENSHOT_DIM / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', SCREENSHOT_JPEG_QUALITY)
}

function loadPersisted() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return { pos: s.pos ?? null, minimized: !!s.minimized }
  } catch {
    return { pos: null, minimized: false }
  }
}

// anchor='floating' (default) keeps the legacy fixed bottom-right FAB.
// anchor='sidebar' renders an inline trigger meant to sit in the sidebar's
// bottom rail. In both modes the panel itself floats free (position: fixed)
// so it can be dragged anywhere and never gets trapped over page content.
export function FeedbackWidget({ anchor = 'floating', collapsed = false }) {
  const { user } = useUser()
  const { workspace: ws } = useWorkspaceState()

  const [open,       setOpen]       = useState(false)
  const [message,    setMessage]    = useState('')
  const [screenshot, setScreenshot] = useState(null) // data URL
  const [status,     setStatus]     = useState('idle') // idle | capturing | submitting | done | error

  const [pos,       setPos]       = useState(() => loadPersisted().pos)       // {left, top} in viewport px, or null → default corner
  const [minimized, setMinimized] = useState(() => loadPersisted().minimized)

  const fileInputRef = useRef(null)
  const movableRef   = useRef(null)   // the mounted panel or pill element, for size-aware clamping
  const dragCleanup  = useRef(null)   // tears down an in-flight drag's window listeners
  const movedRef     = useRef(false)  // true when the last pointer gesture was a drag, so the pill's click can ignore it

  const capturing = status === 'capturing'

  // ── persist position + minimized state ───────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ pos, minimized })) } catch { /* private mode */ }
  }, [pos, minimized])

  // ── dragging (shared by the panel header and the minimized pill) ──────────────
  const clampToViewport = useCallback((left, top, el) => {
    const w = el?.offsetWidth  ?? 320
    const h = el?.offsetHeight ?? 200
    const maxLeft = window.innerWidth  - w - EDGE_GAP
    const maxTop  = window.innerHeight - h - EDGE_GAP
    return {
      left: Math.round(Math.max(EDGE_GAP, Math.min(left, Math.max(EDGE_GAP, maxLeft)))),
      top:  Math.round(Math.max(EDGE_GAP, Math.min(top,  Math.max(EDGE_GAP, maxTop)))),
    }
  }, [])

  const onDragStart = useCallback((e) => {
    // Let real controls (minimize / close) work without starting a drag.
    if (e.target.closest('[data-fb-nodrag]')) return
    const el = e.target.closest('[data-fb-movable]')
    if (!el) return
    const rect = el.getBoundingClientRect()
    const startX = e.clientX, startY = e.clientY
    const baseLeft = rect.left, baseTop = rect.top
    movedRef.current = false

    const move = (ev) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true
      setPos(clampToViewport(baseLeft + dx, baseTop + dy, el))
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      dragCleanup.current = null
    }
    dragCleanup.current = end
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    e.preventDefault()
  }, [clampToViewport])

  // Tear down an in-flight drag if the widget unmounts mid-gesture.
  useEffect(() => () => { dragCleanup.current?.() }, [])

  // Keep the panel on-screen if the window shrinks under it.
  useEffect(() => {
    if (!pos) return
    const onResize = () => setPos((p) => (p ? clampToViewport(p.left, p.top, movableRef.current) : p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [pos, clampToViewport])

  // ── screen capture ──────────────────────────────────────────────────────────
  const captureScreen = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      fileInputRef.current?.click()
      return
    }
    // Hide the panel first so it isn't baked into the very screenshot the
    // user is trying to take. `status === 'capturing'` drives the opacity,
    // and awaiting a couple of frames guarantees the hide has painted before
    // we grab. (getDisplayMedia's own prompt gives plenty more slack.)
    setStatus('capturing')
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true })
      const track  = stream.getVideoTracks()[0]
      // grabFrame via ImageCapture API
      const frame  = await new ImageCapture(track).grabFrame()
      track.stop()
      stream.getTracks().forEach(t => t.stop())

      setScreenshot(encodeScreenshot(frame, frame.width, frame.height))
      setStatus('idle')
    } catch (e) {
      // User cancelled picker or browser lacks ImageCapture — fall back to file
      if (e.name !== 'AbortError') console.warn('[FeedbackWidget] capture failed:', e.message)
      setStatus('idle')
    }
  }, [])

  // ── file upload fallback ─────────────────────────────────────────────────────
  const handleFile = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    createImageBitmap(file)
      .then((bitmap) => setScreenshot(encodeScreenshot(bitmap, bitmap.width, bitmap.height)))
      .catch((err) => console.warn('[FeedbackWidget] file decode failed:', err?.message))
    e.target.value = ''
  }, [])

  // ── submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!message.trim() || status === 'submitting') return
    setStatus('submitting')
    try {
      await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:         message.trim(),
          screenshotDataUrl: screenshot ?? undefined,
          pageUrl:         window.location.href,
          userName:        user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.username : undefined,
          userEmail:       user?.primaryEmailAddress?.emailAddress,
          workspaceSlug:   ws?.slug,
        }),
      })
      setStatus('done')
      setTimeout(() => {
        setOpen(false)
        setMessage('')
        setScreenshot(null)
        setStatus('idle')
      }, 2000)
    } catch (e) {
      console.error('[FeedbackWidget] submit error:', e)
      setStatus('error')
    }
  }, [message, screenshot, status, user, ws])

  const close = useCallback(() => {
    if (status === 'submitting') return
    setOpen(false)
    setMinimized(false)
    setMessage('')
    setScreenshot(null)
    setStatus('idle')
  }, [status])

  const restore = useCallback(() => {
    // A drag that ended on the pill shouldn't also count as a click-to-open.
    if (movedRef.current) { movedRef.current = false; return }
    setMinimized(false)
  }, [])

  const sidebar = anchor === 'sidebar'

  // Explicit position once dragged; otherwise fall back to the default corner.
  const movableStyle  = pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined
  const cornerClass   = pos ? '' : 'bottom-5 right-5'
  const captureHidden = capturing ? 'opacity-0 pointer-events-none' : ''

  return (
    <div className={sidebar ? 'relative' : undefined}>
      {/* Trigger button */}
      {sidebar ? (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label={collapsed ? (open ? 'Close feedback' : 'Send feedback') : undefined}
          className={`flex items-center rounded-md text-sm font-medium transition-colors group relative w-full text-sidebar-foreground hover:bg-sidebar-active hover:text-white
            ${collapsed ? 'justify-center py-2 px-0' : 'gap-2.5 px-3 py-2'}`}
        >
          <MessageSquare className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="flex-1 truncate text-left">Feedback</span>}
          {collapsed && (
            <span className="absolute left-full ml-2 px-2 py-1 text-xs font-medium bg-popover border border-border text-popover-foreground rounded-md shadow-md
                             invisible group-hover:visible opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[200]
                             transition-opacity duration-150">
              Feedback
            </span>
          )}
        </button>
      ) : (
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Send feedback"
          className="fixed bottom-5 right-5 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
        </button>
      )}

      {/* Minimized pill — draggable; click (without dragging) reopens */}
      {open && minimized && (
        <button
          type="button"
          ref={movableRef}
          data-fb-movable
          onPointerDown={onDragStart}
          onClick={restore}
          style={movableStyle}
          aria-label="Reopen feedback"
          className={`fixed ${cornerClass} z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-2xl transition-opacity hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${captureHidden}`}
        >
          <GripVertical className="h-4 w-4 opacity-70" aria-hidden="true" />
          Feedback
        </button>
      )}

      {/* Panel */}
      {open && !minimized && (
        <div
          ref={movableRef}
          data-fb-movable
          style={movableStyle}
          className={`fixed ${cornerClass} z-50 w-80 rounded-xl border border-border bg-background shadow-2xl transition-opacity ${captureHidden}`}
        >
          {/* Header — drag handle */}
          <div
            onPointerDown={onDragStart}
            className="flex items-center gap-1.5 border-b border-border px-2 py-2.5 cursor-grab active:cursor-grabbing select-none"
          >
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
            <span className="flex-1 text-sm font-semibold">Send feedback</span>
            <button
              type="button"
              data-fb-nodrag
              onClick={() => setMinimized(true)}
              aria-label="Minimize feedback"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              data-fb-nodrag
              onClick={close}
              aria-label="Close feedback"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {status === 'done' ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <CheckCircle className="h-8 w-8 text-success" />
              <p className="text-sm font-medium">Thanks — got it!</p>
            </div>
          ) : (
            <div className="space-y-3 p-4">
              {/* Message */}
              <textarea
                aria-label="Describe the issue"
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Describe what happened or what looks wrong…"
                rows={4}
                disabled={status === 'submitting'}
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              />

              {/* Screenshot preview */}
              {screenshot && (
                <div className="relative">
                  <img
                    src={screenshot}
                    alt="Screenshot preview"
                    className="max-h-32 w-full rounded-md border border-border object-cover"
                  />
                  <button
                    onClick={() => setScreenshot(null)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Error */}
              {status === 'error' && (
                <p className="text-xs text-destructive">Something went wrong — please try again.</p>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                {/* Capture screen */}
                <button
                  onClick={captureScreen}
                  disabled={status !== 'idle'}
                  aria-label="Capture screen"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                >
                  {status === 'capturing'
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <Camera className="h-4 w-4" aria-hidden="true" />}
                </button>

                {/* File upload */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={status !== 'idle'}
                  aria-label="Attach image"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                >
                  <Paperclip className="h-4 w-4" aria-hidden="true" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFile}
                />

                <div className="flex-1" />

                {/* Send */}
                <button
                  onClick={handleSubmit}
                  disabled={!message.trim() || status !== 'idle'}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                >
                  {status === 'submitting'
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Send className="h-3 w-3" />}
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
