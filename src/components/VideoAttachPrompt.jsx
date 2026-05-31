/**
 * VideoAttachPrompt
 *
 * Shown at the end of an audio interview when the clinician recorded themselves
 * on an iPhone (or similar) and wants to attach that video. Appears between the
 * "interview complete" card and navigation to /stories/:id.
 *
 * Flow:
 *   1. "Did you record video?" — Yes / Skip
 *   2. File picker (video/* only, single file)
 *   3. Upload progress bar (reuses uploadMedia from mediaLib)
 *   4. Optional trim-start slider: "interview starts at Xs in the video"
 *   5. On confirm → PATCH interview with video_media_asset_id + video_offset_seconds
 *   6. onDone() called → caller navigates to /stories/:id
 */

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Video, Upload, SkipForward, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { uploadMedia } from '@/lib/mediaLib'
import { updateInterview } from '@/lib/api'

// Formats seconds as M:SS
function fmtTime(secs) {
  const s = Math.round(secs)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function VideoAttachPrompt({ interviewId, staffName, onDone }) {
  const [step, setStep] = useState('ask') // ask | uploading | trim | saving | done | error
  const [file, setFile] = useState(null)
  const [videoDuration, setVideoDuration] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [assetId, setAssetId] = useState(null)
  const [offsetSeconds, setOffsetSeconds] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const fileInputRef = useRef(null)
  const abortRef = useRef(null)

  // Probe the video file for duration so the trim slider has a sensible max
  const probeVideoDuration = useCallback((f) => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(f)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url)
        resolve(isFinite(video.duration) ? video.duration : null)
      }
      video.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
      video.src = url
    })
  }, [])

  const handleFileChange = useCallback(async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('video/')) {
      setErrorMsg('Please select a video file.')
      return
    }
    setFile(f)
    setStep('uploading')
    setUploadProgress(0)
    setErrorMsg('')

    // Probe duration in parallel with upload start
    const durationPromise = probeVideoDuration(f)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const result = await uploadMedia(f, {
        purpose: 'interview',
        label: `${staffName} — interview video`,
        workspace_scoped: true,
      }, {
        abortSignal: controller.signal,
        onProgress: (e) => setUploadProgress(Math.round(e.percent ?? 0)),
      })

      const duration = await durationPromise
      setVideoDuration(duration)
      setAssetId(result.assetId)
      setUploadProgress(100)
      setStep('trim')
    } catch (err) {
      if (err?.name === 'AbortError') return
      setErrorMsg(err?.message || 'Upload failed. Please try again.')
      setStep('error')
    }
  }, [staffName, probeVideoDuration])

  const handleConfirm = useCallback(async () => {
    if (!assetId) return
    setStep('saving')
    try {
      await updateInterview(interviewId, {
        video_media_asset_id: assetId,
        video_offset_seconds: offsetSeconds,
      })
      setStep('done')
      setTimeout(() => onDone(), 1200)
    } catch (err) {
      setErrorMsg(err?.message || 'Could not save video link. Try again.')
      setStep('error')
    }
  }, [assetId, offsetSeconds, interviewId, onDone])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    onDone()
  }, [onDone])

  // ── Ask step ─────────────────────────────────────────────────────────────
  if (step === 'ask') {
    return (
      <div className="flex flex-col items-center gap-5 py-6 px-4 max-w-sm mx-auto text-center">
        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Video className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Did you record video?</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Attach your iPhone recording and it&apos;ll be part of your content library.
          </p>
        </div>
        <div className="flex gap-3 w-full">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleCancel}
          >
            <SkipForward className="h-4 w-4 mr-1.5" />
            Skip
          </Button>
          <Button
            className="flex-1"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-1.5" />
            Add video
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="sr-only"
          onChange={handleFileChange}
        />
      </div>
    )
  }

  // ── Uploading step ────────────────────────────────────────────────────────
  if (step === 'uploading') {
    return (
      <div className="flex flex-col items-center gap-5 py-6 px-4 max-w-sm mx-auto text-center">
        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Upload className="h-6 w-6 text-primary animate-pulse" />
        </div>
        <div className="w-full">
          <p className="text-sm font-medium mb-2">
            Uploading {file?.name ?? 'video'}…
          </p>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{uploadProgress}%</p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleCancel}>
          <X className="h-3.5 w-3.5 mr-1" />
          Cancel
        </Button>
      </div>
    )
  }

  // ── Trim step ─────────────────────────────────────────────────────────────
  if (step === 'trim') {
    const maxOffset = videoDuration ? Math.max(0, videoDuration - 10) : 0
    return (
      <div className="flex flex-col gap-5 py-6 px-4 max-w-sm mx-auto">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-medium">Video uploaded</p>
            <p className="text-xs text-muted-foreground">{file?.name}</p>
          </div>
        </div>

        {videoDuration && videoDuration > 15 && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">When did the interview start?</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Drag to trim out any setup time at the beginning of the recording.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={maxOffset}
                step={1}
                value={offsetSeconds}
                onChange={(e) => setOffsetSeconds(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="text-sm font-mono w-12 text-right tabular-nums">
                {fmtTime(offsetSeconds)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Interview content starts at {fmtTime(offsetSeconds)} in the recording
              {videoDuration ? ` (total: ${fmtTime(videoDuration)})` : ''}.
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={handleCancel}>
            Skip
          </Button>
          <Button className="flex-1" onClick={handleConfirm}>
            Save &amp; continue
          </Button>
        </div>
      </div>
    )
  }

  // ── Saving step ───────────────────────────────────────────────────────────
  if (step === 'saving') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 px-4 max-w-sm mx-auto text-center">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
          <Video className="h-5 w-5 text-primary animate-pulse" />
        </div>
        <p className="text-sm text-muted-foreground">Saving…</p>
      </div>
    )
  }

  // ── Done step ─────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 px-4 max-w-sm mx-auto text-center">
        <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        </div>
        <p className="text-sm font-medium">Video attached</p>
      </div>
    )
  }

  // ── Error step ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center gap-4 py-6 px-4 max-w-sm mx-auto text-center">
      <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertCircle className="h-5 w-5 text-destructive" />
      </div>
      <div>
        <p className="text-sm font-medium">Upload failed</p>
        <p className="text-xs text-muted-foreground mt-1">{errorMsg}</p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" size="sm" onClick={handleCancel}>Skip for now</Button>
        <Button size="sm" onClick={() => { setStep('ask'); setErrorMsg('') }}>Try again</Button>
      </div>
    </div>
  )
}
