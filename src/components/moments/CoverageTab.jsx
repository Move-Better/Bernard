import { Lightbulb, MessageCircleQuestion } from 'lucide-react'
import CoveragePanel from '@/components/moments/CoveragePanel'

/**
 * The /moments "Coverage" tab — the existing footage/topic CoveragePanel plus
 * the planner's own topic gaps: topic_backlog rows with source='bank_gap',
 * written when weekly planning finds ZERO usable moments for a campaign topic
 * (api/_lib/momentPlan.js checkCampaignBankCoverage). Each gap is an
 * "ask about this next interview" prompt, not an alert.
 */
export default function CoverageTab({ gaps }) {
  const list = Array.isArray(gaps) ? gaps : []
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2">
          <MessageCircleQuestion className="h-3.5 w-3.5" />
          Planner gaps
        </h2>
        {list.length === 0 ? (
          <div className="rounded-lg bg-muted/50 border border-border p-3.5 text-sm text-muted-foreground">
            No gaps — every planned slot found a matching moment. When the
            planner misses (say, a campaign topic with nothing on hand), the
            topic appears here.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {list.map((g) => (
              <div key={g.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
                <Lightbulb className="h-4 w-4 shrink-0 text-action" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{g.topic}</p>
                  <p className="text-2xs text-muted-foreground mt-0.5">
                    Nothing on hand yet — ask about this next interview.
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <CoveragePanel />
    </div>
  )
}
