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
  RefreshCw, AlertCircle, ImageIcon, Megaphone, Wand2, Heart, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/PageHeader'
import { Room, SectionGuide, RoomSubhead } from '@/components/settings/Room'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import BrandAnchorsEditor from '@/components/BrandAnchorsEditor'

function formatDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return null
  }
}

export default function BrandIdentitySettings() {
  useDocumentTitle('Identity')
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
    const territory = Array.isArray(brief.territory) ? brief.territory : []
    const notThis = Array.isArray(brief.notThis) ? brief.notThis : []
    const anchors = Array.isArray(brief.visualAnchors) ? brief.visualAnchors : []
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-2xs text-muted-foreground/80">Settings · Brand · Identity</p>
            <PageHeader
              className="mt-0.5 mb-0"
              icon={Compass}
              title="Identity"
              subtitle={`What ${displayName} feels like — the brand brief Bernard uses to keep every image and post on-brand.`}
            />
            <p className="mt-1.5 text-2xs text-muted-foreground flex items-center gap-1.5">
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

        <SectionGuide
          items={[
            { id: 'id-territory', label: 'Territory', done: territory.length > 0 },
            { id: 'id-feel', label: 'The feeling', done: !!(brief.emotionalPromise || brief.tension) },
            { id: 'id-anchors', label: 'Visual anchors', done: anchors.length > 0 },
          ]}
        />

        <div className="space-y-4">
          {/* Territory — what the brand owns and avoids */}
          <Room
            id="id-territory"
            icon={Compass}
            title="Territory"
            purpose={`The words ${displayName} owns — and the ground it deliberately avoids.`}
          >
            <div>
              <RoomSubhead title="This is us" className="mb-2.5" />
              <div className="flex flex-wrap gap-2">
                {territory.map((t, i) => (
                  <span key={i} className="rounded-full bg-primary/10 px-3.5 py-1 text-sm font-semibold text-primary">{t}</span>
                ))}
              </div>
            </div>
            {notThis.length > 0 && (
              <div className="border-t border-border/50 pt-4">
                <RoomSubhead title="Not this" className="mb-2.5" />
                <div className="flex flex-wrap gap-2">
                  {notThis.map((t, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-3 py-1 text-sm font-medium text-destructive">
                      <X className="h-3 w-3" aria-hidden="true" /> {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Room>

          {/* The feeling — emotional register */}
          {(brief.emotionalPromise || brief.tension) && (
            <Room
              id="id-feel"
              icon={Heart}
              title="The feeling"
              purpose="The emotional register every post and image should land in."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {brief.emotionalPromise && (
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <div className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">The promise</div>
                    <p className="text-sm">{brief.emotionalPromise}</p>
                  </div>
                )}
                {brief.tension && (
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <div className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">The tension</div>
                    <p className="text-sm">{brief.tension}</p>
                  </div>
                )}
              </div>
            </Room>
          )}

          {/* Visual anchors — references + what they power */}
          <Room
            id="id-anchors"
            icon={ImageIcon}
            title="Visual anchors"
            purpose="Reference points that steer on-brand imagery."
          >
            <BrandAnchorsEditor anchors={anchors} />
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">What this powers now</div>
              <ul className="space-y-1.5 text-sm">
                <li className="flex gap-2"><Wand2 className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden="true" /><span>Steers AI image generation toward your territory and away from the &ldquo;not this&rdquo; list — instead of generic stock-healthcare looks.</span></li>
                <li className="flex gap-2"><Megaphone className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden="true" /><span>Sets the emotional register Bernard writes and styles posts in.</span></li>
                <li className="flex gap-2"><ImageIcon className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden="true" /><span>Your visual anchors become the reference points for on-brand imagery.</span></li>
              </ul>
            </div>
          </Room>
        </div>
      </div>
    )
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  return (
    <div className="py-2">
      <PageHeader
        className="mb-5"
        icon={Compass}
        title="Brand identity"
        subtitle={`What ${displayName} feels like — derived from a short conversation, then used to keep every image and post on-brand.`}
      />

      {/* Why do this — made obvious BEFORE starting (Q's request). */}
      <div className="rounded-xl p-4 mb-4 flex gap-3"
           style={{ background: 'hsl(var(--primary) / 0.06)', border: '1px solid hsl(var(--primary) / 0.20)' }}>
        <Wand2 className="h-5 w-5 shrink-0 text-primary mt-0.5" aria-hidden="true" />
        <div className="text-sm">
          <p className="font-semibold mb-0.5">Why do this?</p>
          <p className="text-muted-foreground">
            Without a brand brief, AI-generated images and posts default to generic, stock-healthcare looks.
            This ~10-minute conversation is what makes everything Bernard creates look unmistakably like {displayName} —
            and gives image generation real rails instead of guesses.
          </p>
        </div>
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
