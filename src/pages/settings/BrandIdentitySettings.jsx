// Settings → Brand identity. The durable home for the brand brief derived by
// the brand-discovery interview. Empty state launches the interview; populated
// state shows the brief read-only with a "Retake" action. Founder-only.
//
// The brief is read straight off the workspace (workspaces.brand_brief, surfaced
// by /api/workspace/me via select=*). It's written by the brand-discovery
// synthesizer, never patched here — "edit" for v1 is a retake.
import { useNavigate } from 'react-router-dom'
import {
  Compass, Sparkles, Mic, PauseCircle, FileCheck2, CheckCircle2,
  RefreshCw, Info, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import BrandBriefView from '@/components/BrandBriefView'

function formatDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return null
  }
}

export default function BrandIdentitySettings() {
  useDocumentTitle('Brand identity')
  const navigate = useNavigate()
  const workspace = useWorkspace()
  const { role, isLoading } = useUserRole()

  const displayName = workspace?.display_name || 'your practice'
  const brief = workspace?.brand_brief && typeof workspace.brand_brief === 'object' ? workspace.brand_brief : null
  const hasBrief = !!(brief && Array.isArray(brief.territory) && brief.territory.length > 0)

  if (!isLoading && role && role !== 'admin') {
    return (
      <div className="py-8">
        <Card>
          <CardContent className="pt-6 text-center space-y-2">
            <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Brand identity is only available to workspace admins.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Populated state ────────────────────────────────────────────────────────
  if (hasBrief) {
    const updated = formatDate(brief.synthesized_at)
    return (
      <div className="py-2 max-w-3xl">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Compass className="h-5 w-5 text-primary" />
              Brand identity
            </h1>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              Defined from your interview{updated ? <> · <span className="italic">last updated {updated}</span></> : null}
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0 gap-1.5"
            onClick={() => navigate('/brand-discovery')}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retake interview
          </Button>
        </div>

        <BrandBriefView brief={brief} />

        <div className="mt-3 rounded-xl p-3 text-xs text-muted-foreground flex items-center gap-2"
             style={{ background: 'hsl(var(--info) / 0.06)', border: '1px solid hsl(var(--info) / 0.25)' }}>
          <Info className="h-3.5 w-3.5 shrink-0" style={{ color: 'hsl(var(--info))' }} aria-hidden="true" />
          To change the brief, retake the interview — it&apos;s the same conversation, and your new answers replace this.
        </div>
      </div>
    )
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  return (
    <div className="py-2 max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Compass className="h-5 w-5 text-primary" />
          Brand identity
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          What {displayName} feels like — derived from a short conversation, then used to keep every image and post on-brand.
        </p>
      </div>

      <div
        className="rounded-2xl border border-border p-6 text-center"
        style={{ background: 'linear-gradient(180deg, hsl(var(--card)), hsl(var(--primary) / 0.05))' }}
      >
        <div className="h-12 w-12 rounded-full bg-primary/10 mx-auto flex items-center justify-center mb-3">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold">Let&apos;s find your brand&apos;s voice — out loud</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1.5">
          A ~10-minute spoken conversation. Bernard asks 7 questions about how {displayName} should feel —
          what&apos;s true, what would feel wrong, who your patients really are. You just talk.
        </p>

        <div className="grid sm:grid-cols-3 gap-3 max-w-2xl mx-auto mt-5 text-left">
          <FeatureCard icon={<Mic className="h-4 w-4 text-primary" />} title="Spoken, not typed"
            body="Your real words surface the brand. Type fallback if needed." />
          <FeatureCard icon={<PauseCircle className="h-4 w-4 text-primary" />} title="Pause anytime"
            body="Resume right where you left off. Nothing's published." />
          <FeatureCard icon={<FileCheck2 className="h-4 w-4 text-primary" />} title="Get a brand brief"
            body="Territory, what it's NOT, the promise, the tension, references." />
        </div>

        <Button size="lg" className="mt-6 gap-2" onClick={() => navigate('/brand-discovery')}>
          <Mic className="h-4 w-4" />
          Start brand discovery
        </Button>
        <p className="text-xs text-muted-foreground mt-2.5">Next: a quick mic &amp; speaker check.</p>
      </div>
    </div>
  )
}

function FeatureCard({ icon, title, body }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-1.5">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  )
}
