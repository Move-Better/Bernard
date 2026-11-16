import TopicBacklogPanel from '@/components/TopicBacklogPanel'

// /topics — the topic backlog: what to interview about next. Visitor questions
// from the website's chat land here (source 'vigil_signal'), as do hand-added
// and AI-suggested topics. Restored 2026-11-16 (the panel had no page since the
// #375 cleanup); the Monday visitor-question email links here. Full-bleed root,
// per the house rule.
export default function Topics() {
  return (
    <div className="py-6">
      <TopicBacklogPanel />
    </div>
  )
}
