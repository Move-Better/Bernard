import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Loader2, Upload, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useApplePerformance, useLocations } from '@/lib/queries'

// Settings → Integrations card for Apple Business Insights.
//
// Unlike the Google cards (OAuth), Apple's Insights API is partner-gated, so
// tenants opt in by uploading the monthly recap PDF Apple emails them (one per
// location). We parse the six Core metrics, show a preview, then save the
// numbers and DISCARD the PDF. `useApplePerformance` doubles as the status read.

const MONTH_FMT = { year: 'numeric', month: 'long' }
function monthLabel(iso) {
  if (!iso) return ''
  const [y, m] = String(iso).split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(undefined, MONTH_FMT)
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read_failed'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(file)
  })
}

export default function AppleBusinessInsightsCard({ disabled, onChange }) {
  const qc = useQueryClient()
  const { data: perf } = useApplePerformance()
  const { data: locations = [] } = useLocations()

  const [open, setOpen] = useState(false)
  const [locationId, setLocationId] = useState('')
  const [preview, setPreview] = useState(null)   // { period, metrics, ... , _pdfBase64, _filename }
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)

  const configured = perf?.connected
  const latest = perf?.latestMonth
  const multiLoc = locations.length > 1

  function parseErr(err) {
    if (err?.status === 422) return 'That doesn’t look like an Apple monthly Insights recap PDF.'
    if (err?.status === 403) return 'Only workspace admins can upload Apple Insights.'
    if (err?.status === 400) return 'Couldn’t read that file — make sure it’s the recap PDF.'
    return err?.message || 'Couldn’t read that PDF.'
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast.error('That PDF is too large (max 5 MB).'); return }
    setParsing(true)
    setPreview(null)
    try {
      const pdfBase64 = await readAsBase64(file)
      const data = await apiFetch('/api/integrations/apple/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64, filename: file.name, preview: true }),
      })
      setPreview({ ...data, _pdfBase64: pdfBase64, _filename: file.name })
    } catch (err) {
      toast.error(parseErr(err))
    } finally {
      setParsing(false)
    }
  }

  async function handleSave() {
    if (!preview?._pdfBase64) return
    setSaving(true)
    try {
      await apiFetch('/api/integrations/apple/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfBase64: preview._pdfBase64,
          filename: preview._filename,
          locationId: locationId || null,
        }),
      })
      toast.success(`Saved ${monthLabel(preview.period)} Apple Insights.`)
      setPreview(null)
      qc.invalidateQueries({ queryKey: ['apple-performance'] })
      onChange?.()
    } catch (err) {
      toast.error(parseErr(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-accent/30 transition-colors text-left"
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium">Apple Business Insights</p>
              {configured ? (
                <span className="text-3xs uppercase tracking-wide font-bold bg-success text-white px-2 py-0.5 rounded shadow-sm">Connected</span>
              ) : (
                <span className="text-3xs uppercase tracking-wide bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Not set up</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Upload the monthly recap Apple emails you to track place-card views, search taps, and interactions from Apple Maps.
            </p>
            {configured && latest && (
              <p className="text-xs text-muted-foreground mt-1">
                Latest recap <span className="font-medium">{monthLabel(latest)}</span>
              </p>
            )}
            <div className="flex gap-1 mt-1.5 flex-wrap">
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Monthly PDF upload</span>
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Per location</span>
            </div>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t pt-4">
          {disabled && <p className="text-xs text-muted-foreground">Admins only.</p>}

          {multiLoc && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Location</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                disabled={disabled}
                className="w-full mt-1 rounded-lg border bg-card px-3 py-2 text-sm"
              >
                <option value="">Select a location…</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.label || [l.city, l.region].filter(Boolean).join(', ')}</option>
                ))}
              </select>
            </div>
          )}

          {/* Upload */}
          <label
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-secondary/50 px-6 py-6 text-center ${disabled || parsing ? 'opacity-60' : 'cursor-pointer hover:bg-secondary'}`}
          >
            {parsing ? <Loader2 className="h-6 w-6 text-muted-foreground animate-spin mb-2" /> : <Upload className="h-6 w-6 text-muted-foreground mb-2" />}
            <span className="text-sm font-medium">{parsing ? 'Reading your PDF…' : 'Drop or choose your Apple recap PDF'}</span>
            <span className="text-xs text-muted-foreground mt-0.5">the monthly “Your … Insights” email, saved as PDF</span>
            <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={disabled || parsing} onChange={handleFile} />
          </label>

          {/* Parse preview → confirm before saving */}
          {preview && (
            <div className="rounded-xl border bg-secondary/60 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold">Read from your PDF — {monthLabel(preview.period)}</p>
                <span className="text-2xs text-success flex items-center gap-1"><Check className="h-3 w-3" /> looks like an Apple recap</span>
              </div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
                <PreviewStat label="Views" v={preview.metrics?.placeCardViews} />
                <PreviewStat label="Taps" v={preview.metrics?.tapsFromSearch} />
                <PreviewStat label="Directions" v={preview.metrics?.directions} />
                <PreviewStat label="Photos" v={preview.metrics?.photos} />
                <PreviewStat label="Website" v={preview.metrics?.website} />
                <PreviewStat label="Calls" v={preview.metrics?.call} />
              </div>
              {preview.warnings?.length > 0 && (
                <p className="text-2xs text-warning mt-2">Some fields couldn’t be read: {preview.warnings.join(' ')}</p>
              )}
              <div className="flex items-center gap-2 mt-3">
                <Button size="sm" onClick={handleSave} disabled={saving || (multiLoc && !locationId)}>
                  {saving ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Saving…</> : `Save ${monthLabel(preview.period)}`}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPreview(null)} disabled={saving}>Cancel</Button>
                {multiLoc && !locationId && <span className="text-2xs text-muted-foreground">Pick a location first.</span>}
              </div>
              <p className="text-2xs text-muted-foreground mt-2">The PDF is discarded after we read the numbers.</p>
            </div>
          )}

          {configured && (
            <p className="text-xs text-muted-foreground">
              {perf.monthsCount} month{perf.monthsCount === 1 ? '' : 's'} uploaded · latest {monthLabel(latest)}. See the numbers on the Insights page.
            </p>
          )}

          <details>
            <summary className="text-xs font-medium text-primary cursor-pointer">How do I get this PDF?</summary>
            <ol className="text-xs text-muted-foreground mt-2 ml-4 list-decimal space-y-1">
              <li>Open the monthly “Your [Month] Insights” email Apple sends to your admin address (or sign in at businessconnect.apple.com).</li>
              <li>Print / Save as PDF — one per location.</li>
              <li>Drop it here. We read the numbers and track them month over month.</li>
            </ol>
          </details>
        </div>
      )}
    </div>
  )
}

function PreviewStat({ label, v }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <b>{v == null ? '—' : v}</b>
    </div>
  )
}
