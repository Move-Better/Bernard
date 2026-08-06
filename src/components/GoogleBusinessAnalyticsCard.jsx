import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ConnectedBadge from '@/components/ui/ConnectedBadge'
import { apiFetch, apiFetchResponse } from '@/lib/api'
import { toast } from '@/lib/toast'

// Settings → Integrations card for Google Business Profile analytics (OAuth).
// Also reused directly on the Insights page's Google Business tab so a
// tenant can connect without leaving Insights.
//
// `row` (from GET /api/workspace/credentials, admin-only) drives the
// connect/reconnect/disconnect controls and account details. Non-admin
// viewers can't fetch that endpoint, so `connectedHint` — the member-
// readable `connected` flag from GET /api/insights/gbp-performance — is an
// optional fallback so the badge still reads correctly for them even
// though the (admin-only, and for them disabled anyway) buttons don't.

const GBP_ERROR_COPY = {
  access_denied:   'You declined the Google permission prompt — no changes saved.',
  exchange_failed: 'Google rejected the OAuth code. Try connecting again.',
  persist_failed:  'Connected to Google, but we couldn\'t save the credential. Try again or contact support.',
}

export default function GoogleBusinessAnalyticsCard({ row, loading, disabled, onChange, connectedHint, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const configured            = row ? true : Boolean(connectedHint)
  const connectedEmail        = row?.config?.account_email    || null
  const locationTitle         = row?.config?.location_title   || null
  const locationDetectFailed  = row?.config?.location_detection === 'failed'

  useEffect(() => {
    const status = searchParams.get('gbp')
    if (!status) return
    if (status === 'connected') {
      toast.success('Google Business Profile connected.')
      onChange?.()
    } else if (status === 'error') {
      const reason = searchParams.get('reason') || 'unknown'
      toast.error(GBP_ERROR_COPY[reason] || `Business Profile connect failed: ${reason}`)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('gbp')
    next.delete('reason')
    setSearchParams(next, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleConnect() {
    setConnecting(true)
    try {
      const data = await apiFetch('/api/integrations/gbp/connect', { method: 'POST' })
      if (!data?.url) throw new Error('No OAuth URL returned')
      window.location.assign(data.url)
    } catch (err) {
      setConnecting(false)
      if (err?.status === 503) {
        toast.error('Google OAuth isn\'t configured on this deployment yet.')
      } else if (err?.status === 403) {
        toast.error('Only workspace admins can connect Google Business Profile.')
      } else {
        toast.error(err?.message || 'Couldn\'t start the Google connect flow.')
      }
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Google Business Profile analytics for this workspace?')) return
    setDisconnecting(true)
    try {
      await apiFetchResponse('/api/integrations/gbp/disconnect', { method: 'DELETE' })
      toast.success('Google Business Profile disconnected.')
      onChange?.()
    } catch (err) {
      toast.error(err?.message || 'Couldn\'t disconnect Business Profile.')
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleRetryLocations() {
    setRetrying(true)
    try {
      const data = await apiFetch('/api/integrations/gbp/refresh-locations', { method: 'POST' })
      if (data?.ok) {
        toast.success(`Found ${data.locations?.length ?? 1} location(s).`)
        onChange?.()
      } else {
        toast.error(data?.error || 'Location detection failed — try reconnecting.')
      }
    } catch (err) {
      toast.error(err?.message || 'Location detection failed.')
    } finally {
      setRetrying(false)
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
              <p className="font-medium">Google Business Profile</p>
              {configured ? (
                <ConnectedBadge upper />
              ) : !loading ? (
                <span className="text-3xs uppercase tracking-wide bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Not connected</span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Read-only. Shows how many people view and click your GBP listing and posts — impressions, direction requests, call clicks.
            </p>
            {configured && (connectedEmail || locationTitle) && (
              <p className="text-xs text-muted-foreground mt-1">
                {connectedEmail && <>Connected as <span className="font-medium">{connectedEmail}</span>{locationTitle ? ' · ' : ''}</>}
                {locationTitle && <span className="font-medium">{locationTitle}</span>}
              </p>
            )}
            <div className="flex gap-1 mt-1.5 flex-wrap">
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Location analytics</span>
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Post views</span>
            </div>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 border-t pt-4">
          {!configured ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Click below to sign in with the Google account that owns your Business Profile listing. Bernard gets read-only access to performance data — we never post or modify anything.
              </p>
              <Button onClick={handleConnect} disabled={disabled || connecting}>
                {connecting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting to Google…</>
                ) : (
                  <>Connect with Google</>
                )}
              </Button>
              {disabled && <p className="text-xs text-muted-foreground mt-2">Admins only.</p>}
            </div>
          ) : (
            <div className="space-y-3">
              {locationDetectFailed && (
                <div className="rounded-lg bg-action/5 border border-action/30 px-3 py-2 text-sm text-foreground">
                  <p className="font-medium mb-1">Location data not loaded yet</p>
                  <p className="text-xs text-muted-foreground">The Google API rate-limited the location lookup during connect. Click below to retry — it only takes a second.</p>
                  <Button size="sm" className="mt-2" onClick={handleRetryLocations} disabled={retrying || disabled}>
                    {retrying ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Detecting locations…</> : 'Retry location detection'}
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={handleConnect} disabled={disabled || connecting}>
                  {connecting ? 'Reconnecting…' : 'Reconnect (switch account)'}
                </Button>
                <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={handleDisconnect} disabled={disabled || disconnecting}>
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              </div>
              {disabled && <p className="text-xs text-muted-foreground">Admins only.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
