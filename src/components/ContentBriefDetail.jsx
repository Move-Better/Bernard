import { useEffect, useRef, useState } from 'react'
import { X, Loader2, Sparkles, Upload as UploadIcon, Check, Trash2, AlertTriangle, Send, Scissors, Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  updateContentPiece,
  deleteContentPiece,
  publishContentPiece,
  getContentPieceClip,
} from '@/lib/contentLib'
import { uploadMedia, getMediaAsset } from '@/lib/mediaLib'

const PLATFORMS = ['reels', 'feed', 'story', 'shorts', 'tiktok', 'gbp', 'newsletter']

// Edit-brief detail modal. Renders a single content_piece with edit fields,
// the source clip preview, and the actions: accept, reject, mark in-progress,
// upload finished file (return-upload), publish (later), delete.
//
// `brief` is the current content_pieces row, `onClose` dismisses, `onChange`
// is fired after any state change so the parent list refreshes.
export default function ContentBriefDetail({ brief, onClose, onChange }) {
  const [source, setSource] = useState(null)
  const [final, setFinal]   = useState(null)
  const [caption, setCaption]     = useState(brief.final_caption ?? brief.ai_caption ?? '')
  const [hashtags, setHashtags]   = useState(joinTags(brief.final_hashtags ?? brief.ai_hashtags))
  const [ctaText, setCtaText]     = useState(brief.final_cta_text ?? brief.ai_cta_text ?? '')
  const [ctaUrl, setCtaUrl]       = useState(brief.final_cta_url ?? '')
  const [platform, setPlatform]   = useState(brief.target_platform ?? brief.ai_suggested_platform ?? '')
  const [notes, setNotes]         = useState(brief.notes ?? '')
  const [saving, setSaving]       = useState(false)
  const [uploading, setUploading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [clipInfo, setClipInfo]   = useState(null)        // download-clip payload
  const [clipLoading, setClipLoading] = useState(false)
  const [consentRequest, setConsentRequest] = useState(null) // server's consent prompt
  const [publishOk, setPublishOk] = useState(null)        // success banner after publish
  const [error, setError]         = useState('')
  const fileRef                   = useRef(null)

  useEffect(() => {
    setCaption(brief.final_caption ?? brief.ai_caption ?? '')
    setHashtags(joinTags(brief.final_hashtags ?? brief.ai_hashtags))
    setCtaText(brief.final_cta_text ?? brief.ai_cta_text ?? '')
    setCtaUrl(brief.final_cta_url ?? '')
    setPlatform(brief.target_platform ?? brief.ai_suggested_platform ?? '')
    setNotes(brief.notes ?? '')
    setError('')
    setClipInfo(null)
    setConsentRequest(null)
    setPublishOk(null)
  }, [brief.id])

  // Hydrate the source media row + final asset (if any) for preview.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (brief.source_asset_id) {
          const s = await getMediaAsset(brief.source_asset_id)
          if (alive) setSource(s)
        }
        if (brief.final_asset_id) {
          const f = await getMediaAsset(brief.final_asset_id)
          if (alive) setFinal(f)
        }
      } catch {}
    })()
    return () => { alive = false }
  }, [brief.id])

  async function patch(body) {
    setSaving(true); setError('')
    try {
      await updateContentPiece(brief.id, body)
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveDraft() {
    return patch({
      finalCaption: caption,
      finalHashtags: splitTags(hashtags),
      finalCtaText: ctaText,
      finalCtaUrl: ctaUrl,
      targetPlatform: platform || null,
      notes,
    })
  }

  async function accept()       { await saveDraft(); await patch({ status: 'accepted' }) }
  async function reject()       { const r = prompt('Why reject? (optional)'); await patch({ status: 'rejected', rejectedReason: r || null }) }
  async function inProgress()   { await saveDraft(); await patch({ status: 'in_progress' }) }
  async function archive()      { await patch({ status: 'archived' }) }
  async function remove() {
    if (!confirm('Delete this brief? This cannot be undone.')) return
    setSaving(true); setError('')
    try {
      await deleteContentPiece(brief.id)
      onChange?.()
      onClose?.()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  async function handleLoadClipInfo() {
    setClipLoading(true); setError('')
    try {
      const info = await getContentPieceClip(brief.id)
      setClipInfo(info)
    } catch (e) {
      setError(e.message)
    } finally {
      setClipLoading(false)
    }
  }

  async function handlePublish({ confirmedConsent = false } = {}) {
    setPublishing(true); setError(''); setPublishOk(null)
    try {
      // saveDraft so the latest caption/hashtags/CTA make it into the publish.
      await saveDraft()
      const result = await publishContentPiece(brief.id, { consentConfirmed: confirmedConsent })
      setConsentRequest(null)
      setPublishOk(result)
      onChange?.()
    } catch (e) {
      if (e.requiresConsentConfirmation) {
        setConsentRequest({
          patient: e.details?.patient || null,
          speakerRole: e.details?.speakerRole || null,
          message: e.details?.message || 'Confirm written or recorded patient consent before publishing.',
        })
      } else {
        setError(e.message)
      }
    } finally {
      setPublishing(false)
    }
  }

  function copyToClipboard(text) {
    if (!text) return
    try { navigator.clipboard.writeText(text) } catch {}
  }

  async function handleReturnUpload(fileList) {
    const file = fileList?.[0]
    if (!file) return
    setUploading(true); setError('')
    try {
      // saveDraft first so the contractor's caption edits don't get lost.
      await saveDraft()
      await uploadMedia(file, {
        parentId: brief.source_asset_id,
        contentPieceId: brief.id,
      })
      // Server marks brief 'returned' + sets final_asset_id; refresh.
      onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const sourceUrl = source?.blob_url
  const finalUrl  = final?.blob_url
  const showPatientWarning = !!source?.patient_pseudonym || source?.speaker_role === 'patient_guest'

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <h2 className="font-semibold text-sm truncate">
              Edit brief — {source?.filename ?? brief.source_asset_id?.slice(0, 8)}
            </h2>
            <Badge variant="outline" className="text-[10px] uppercase">{brief.status}</Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-4">
            {showPatientWarning && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-900 dark:text-amber-200">Patient consent required</p>
                  <p className="text-amber-800 dark:text-amber-300/80 mt-0.5">
                    This source involves a patient ({source?.patient_pseudonym || 'patient guest'}). Verify written or recorded consent before publishing anything derived from this clip.
                  </p>
                </div>
              </div>
            )}

            {/* Source preview + AI-surfaced quote */}
            {sourceUrl && (
              <div className="bg-black rounded-md overflow-hidden">
                {source.kind === 'video' ? (
                  <video src={sourceUrl} controls className="w-full max-h-[40vh]" />
                ) : (
                  <img src={sourceUrl} alt="source" className="w-full max-h-[40vh] object-contain" />
                )}
              </div>
            )}

            {brief.source_quote && (
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Source quote</div>
                <p className="text-sm whitespace-pre-wrap">{brief.source_quote}</p>
              </div>
            )}

            {brief.ai_reasoning && (
              <p className="text-xs text-muted-foreground italic">"{brief.ai_reasoning}"</p>
            )}

            {/* Editable fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Target platform</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="text-sm h-8 px-2 rounded-md border border-border bg-background text-foreground w-full"
                >
                  <option value="">— choose —</option>
                  {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">CTA text</label>
                <Input value={ctaText} onChange={(e) => setCtaText(e.target.value)} className="h-8 text-sm" placeholder="e.g. Book at MoveBetter.co" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Caption</label>
              <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} className="text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Hashtags</label>
                <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} className="h-8 text-sm" placeholder="#MoveBetter #LowBack" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">CTA URL (optional)</label>
                <Input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} className="h-8 text-sm" placeholder="https://…" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Notes</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" placeholder="Anything for the editor…" />
            </div>

            {/* Editor handoff — pull source URL + trim range to open in CapCut */}
            {brief.status !== 'returned' && brief.status !== 'published' && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-xs font-medium flex items-center gap-1.5">
                      <Scissors className="h-3.5 w-3.5 text-primary" />
                      Open in CapCut
                    </div>
                    <div className="text-[11px] text-muted-foreground">Get the source URL + trim range to scrub to in your editor.</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleLoadClipInfo} disabled={clipLoading}>
                    {clipLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Scissors className="h-3.5 w-3.5 mr-1.5" />}
                    {clipInfo ? 'Refresh' : 'Get clip handoff'}
                  </Button>
                </div>
                {clipInfo && (
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground shrink-0">Source:</span>
                      <a href={clipInfo.videoUrl} target="_blank" rel="noopener noreferrer" className="text-primary truncate flex items-center gap-1 min-w-0">
                        <span className="truncate">{clipInfo.filename || clipInfo.videoUrl}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={() => copyToClipboard(clipInfo.videoUrl)}>
                        <Copy className="h-3 w-3" /> URL
                      </Button>
                    </div>
                    {(clipInfo.trimStart != null || clipInfo.trimEnd != null) ? (
                      <div className="text-muted-foreground">
                        Trim to <span className="font-medium text-foreground">{formatTime(clipInfo.trimStart)}</span>
                        {' – '}
                        <span className="font-medium text-foreground">{formatTime(clipInfo.trimEnd)}</span>
                      </div>
                    ) : (
                      <div className="text-muted-foreground italic">
                        No timestamp on this brief — scrub the source manually using the quote above as your cue.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Finished file return + preview */}
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium">Finished edit</div>
                  <div className="text-[11px] text-muted-foreground">Upload the file Philip exported from CapCut. It lands in the library tied back to the source.</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <UploadIcon className="h-3.5 w-3.5 mr-1.5" />}
                  Upload final
                </Button>
                <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => handleReturnUpload(e.target.files)} />
              </div>
              {finalUrl && (
                <div className="bg-black rounded-md overflow-hidden">
                  {final?.kind === 'video' ? (
                    <video src={finalUrl} controls className="w-full max-h-[30vh]" />
                  ) : (
                    <img src={finalUrl} alt="finished" className="w-full max-h-[30vh] object-contain" />
                  )}
                </div>
              )}
            </div>

            {/* Consent confirmation dialog inline — appears after a publish
                request is rejected with consent-required, surfaced as an
                inline panel rather than a modal so the editor can scroll
                back to the brief content while deciding. */}
            {consentRequest && (
              <div className="rounded-md border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/40 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-100">Confirm patient consent before publishing</p>
                    <p className="text-xs text-amber-800 dark:text-amber-200/80">
                      {consentRequest.message}
                      {consentRequest.patient && (
                        <> Patient: <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded text-[11px]">{consentRequest.patient}</code>.</>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setConsentRequest(null)} disabled={publishing}>Cancel</Button>
                  <Button size="sm" onClick={() => handlePublish({ confirmedConsent: true })} disabled={publishing}>
                    {publishing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    Confirm consent and publish
                  </Button>
                </div>
              </div>
            )}

            {/* Publish success surface */}
            {publishOk && (
              <div className="rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 p-3 text-xs space-y-1">
                <p className="font-medium text-emerald-900 dark:text-emerald-100 flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5" /> Published
                </p>
                {publishOk.kind === 'bundle' && (
                  <p className="text-emerald-800 dark:text-emerald-200/90">
                    Bundle downloaded as <code className="bg-emerald-100 dark:bg-emerald-900 px-1 rounded">{publishOk.filename}</code>. Upload the .mp4 to the platform manually; caption.txt and hashtags.txt are inside.
                  </p>
                )}
                {publishOk.kind === 'api' && publishOk.target === 'gbp' && (
                  <p className="text-emerald-800 dark:text-emerald-200/90">
                    Posted to GBP. Target id: <code className="bg-emerald-100 dark:bg-emerald-900 px-1 rounded text-[10px]">{publishOk.publishedTargetId}</code>
                  </p>
                )}
                {publishOk.kind === 'api' && publishOk.target === 'newsletter' && (
                  <p className="text-emerald-800 dark:text-emerald-200/90">
                    {publishOk.message || 'Staged for TDC copy-paste.'}
                  </p>
                )}
              </div>
            )}

            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0">
          <Button variant="ghost" size="sm" onClick={remove} disabled={saving} className="text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
          </Button>
          <div className="flex flex-wrap gap-2 justify-end">
            {brief.status !== 'rejected' && brief.status !== 'archived' && (
              <Button size="sm" variant="ghost" onClick={reject} disabled={saving}>Reject</Button>
            )}
            {brief.status === 'suggested' && (
              <Button size="sm" variant="outline" onClick={accept} disabled={saving}>
                <Check className="h-3.5 w-3.5 mr-1.5" /> Accept
              </Button>
            )}
            {(brief.status === 'accepted') && (
              <Button size="sm" variant="outline" onClick={inProgress} disabled={saving}>Mark in progress</Button>
            )}
            {brief.status === 'returned' && (
              <Button size="sm" variant="outline" onClick={archive} disabled={saving || publishing}>Archive</Button>
            )}
            <Button size="sm" variant={brief.status === 'returned' ? 'outline' : 'default'} onClick={saveDraft} disabled={saving || publishing}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save
            </Button>
            {brief.status === 'returned' && !!brief.final_asset_id && (
              <Button size="sm" onClick={() => handlePublish()} disabled={publishing || saving || !platform}>
                {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                {platform ? `Publish → ${platform}` : 'Publish'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function joinTags(arr) {
  if (!Array.isArray(arr)) return ''
  return arr.join(' ')
}
function splitTags(str) {
  return String(str || '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)
}
function formatTime(s) {
  if (s == null || Number.isNaN(s)) return '—'
  const total = Math.max(0, Math.round(Number(s)))
  const m = Math.floor(total / 60)
  const sec = total % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}
