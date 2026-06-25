import { useState, useRef, useCallback } from 'react'
import { useUser } from '@clerk/react'
import { MessageSquare, X, Camera, Paperclip, Send, CheckCircle, Loader2 } from 'lucide-react'
import { useWorkspaceState } from '@/lib/WorkspaceContext'
import { apiFetch } from '@/lib/api'

export function FeedbackWidget() {
  const { user } = useUser()
  const { workspace: ws } = useWorkspaceState()

  const [open,       setOpen]       = useState(false)
  const [message,    setMessage]    = useState('')
  const [screenshot, setScreenshot] = useState(null) // data URL
  const [status,     setStatus]     = useState('idle') // idle | capturing | submitting | done | error

  const fileInputRef = useRef(null)

  // ── screen capture ──────────────────────────────────────────────────────────
  const captureScreen = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      fileInputRef.current?.click()
      return
    }
    setStatus('capturing')
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true })
      const track  = stream.getVideoTracks()[0]
      // grabFrame via ImageCapture API
      const frame  = await new ImageCapture(track).grabFrame()
      track.stop()
      stream.getTracks().forEach(t => t.stop())

      const canvas = document.createElement('canvas')
      canvas.width  = frame.width
      canvas.height = frame.height
      canvas.getContext('2d').drawImage(frame, 0, 0)
      setScreenshot(canvas.toDataURL('image/png'))
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
    const reader = new FileReader()
    reader.onload = (ev) => setScreenshot(ev.target.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [])

  // ── submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!message.trim() || status === 'submitting') return
    setStatus('submitting')
    try {
      await apiFetch('/api/feedback', {
        method: 'POST',
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
    setMessage('')
    setScreenshot(null)
    setStatus('idle')
  }, [status])

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Send feedback"
        className="fixed bottom-5 right-5 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-80 rounded-xl border border-border bg-background shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">Send feedback</span>
            <button onClick={close} aria-label="Close feedback" className="text-muted-foreground hover:text-foreground">
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
    </>
  )
}
