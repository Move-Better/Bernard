import {
  FileText, Send, CheckCircle2, Sparkles,
  BarChart3, Scissors, Filter, LayoutGrid, Target, Calendar,
} from 'lucide-react'

// Per-page Help content registry.
//
// Each entry feeds <PageHelp pageKey="..."/>. Keep copy in plain language:
// lead with what the page DOES, define any jargon inline, no acronyms.
//
// Shape:
//   title  — modal heading
//   intro  — one-paragraph "what this page is for"
//   steps  — ordered list, each { icon, title, body }
//   notes  — optional callout boxes at the bottom, each { title, body }
//
// To add a page: add an entry here, then drop <PageHelp pageKey="yourKey" />
// next to that page's title.
export const HELP_CONTENT = {
  home: {
    title: 'Home — how it works',
    intro:
      'Home is your personal starting point. It shows what is waiting on you right now and the fastest path to start something new. Think of it as the front desk: it points you to the right room rather than holding the work itself.',
    steps: [
      {
        icon: Send,
        title: 'Start an interview',
        body: 'The main button kicks off a new interview — the conversation that turns what you know into finished posts. Everything in the pipeline begins here.',
      },
      {
        icon: FileText,
        title: 'See what needs your attention',
        body: 'Buckets surface work that is ready for the next step: stories waiting for posts to be written, pieces ready to send out, and clinicians who are due for their next interview.',
      },
      {
        icon: CheckCircle2,
        title: 'Pick up in-progress interviews',
        body: 'If you left an interview half-finished, a strip at the top lets you jump back in. Each strip shows the clinician, the date, and a direct link back to where you left off.',
      },
      {
        icon: Sparkles,
        title: 'Get a running start on topics',
        body: 'Suggested topics give you a starting point when you are not sure what to talk about next. The system looks at what has already been captured and surfaces areas that would round out the content mix.',
      },
    ],
    notes: [
      {
        title: 'Where the work actually lives',
        body: 'Home links out; it does not store. Drafts and finished posts live on Stories, raw video clips are cut on Moments, and the clinic-wide board lives on Overview. Home is just the shortest path to each.',
      },
    ],
  },

  moments: {
    title: 'Moments — how it works',
    intro:
      'Moments is what your practice has said, ready to use — verbatim excerpts mined from your conversations and videos. Bernard composes your week from these; you steer by browsing what is on hand, reviewing new video moments, and retiring anything you would not say.',
    steps: [
      {
        icon: Sparkles,
        title: 'Browse what is on hand',
        body: 'The On hand tab lists every usable moment with its score, source story, and how often it has been used. Search, filter by type or staff, and sort — the strongest lead.',
      },
      {
        icon: Scissors,
        title: 'Review new video moments',
        body: 'New from video is the cutting desk: AI-proposed moments from your source videos, ready to review and trim. Save the keepers as clips to your Library, or cut your own.',
      },
      {
        icon: FileText,
        title: 'Retire what you would not say',
        body: 'From a row’s ⋯ menu, retire a moment to stop future use — quietly. Pieces already planned from it keep their drafts, and a retired moment can be restored any time.',
      },
      {
        icon: BarChart3,
        title: 'Check Coverage for gaps',
        body: 'Coverage shows per-staff capture activity, topic coverage, and any topics the weekly planner could not find a matching moment for — worth asking about next interview.',
      },
    ],
    notes: [
      {
        title: 'The weeks-on-hand number',
        body: 'The header figure is your usable moments divided by a week’s planned posting slots — how long the current stock lasts at the current pace. A 20-minute conversation restocks roughly a month.',
      },
      {
        title: 'Consent first',
        body: 'Videos with a pending or revoked patient consent show a warning badge and cannot be clipped until the consent status is resolved. Resolve consent from the staff profile or the Media Library.',
      },
    ],
  },

  stories: {
    title: 'Stories — how it works',
    intro:
      'Stories is your working list of every piece of content in the practice — from a freshly captured interview to a published post. Filter it down to what you need, then open any card to push it to the next stage.',
    steps: [
      {
        icon: Filter,
        title: 'Filter down to what you need',
        body: 'The chip row narrows the list by staff, platform, stage, location, campaign, and more. "Mine only" limits the view to your own stories; "Real moments" filters to voice memos and seminar captures.',
      },
      {
        icon: Target,
        title: 'Follow a piece through its stages',
        body: 'Every story moves through Capture → Drafting → Review → Scheduled → Published. Use the Stage filter to focus on one step at a time, or watch the badge counts to see where work is piling up.',
      },
      {
        icon: CheckCircle2,
        title: 'Act on what is awaiting review',
        body: 'When stories are waiting on your approval, a chip at the top shows the count and links straight to the review queue — the fastest way to clear the bottleneck without paging through the full list.',
      },
      {
        icon: FileText,
        title: 'Open a story to work on it',
        body: 'Click any card to open the Storyboard, where you write posts, attach media, approve drafts, and schedule or publish. All the editing happens there, not on this list.',
      },
    ],
    notes: [
      {
        title: 'Need the clinic-wide pipeline view?',
        body: 'Stories is your personal working list. The clinic-wide Pipeline, Calendar, and Themes views — showing every story across all staff — live on the Overview page, which is accessible to owners and producers.',
      },
    ],
  },

  overview: {
    title: 'Overview — how it works',
    intro:
      'Overview is the clinic-wide board for owners and producers: a week-by-week recap of what the practice published, captured, and spent — plus the team’s capture rhythm, the publishing calendar, and campaigns. It’s built to be screen-shared in the weekly all-staff meeting.',
    steps: [
      {
        icon: Calendar,
        title: 'Step through weeks',
        body: 'The recap is a calendar week (Mon–Sun). Use the arrows in its header to open any past week — Monday’s meeting presents last week, finished and final. Every stat shows how it moved vs the week before, and the 12-week band doubles as a picker: click a bar to open that week.',
      },
      {
        icon: LayoutGrid,
        title: 'Right now vs. history',
        body: 'Published, captured, drafted, and cost belong to the selected week. The "Right now" row (scheduled next, in review) and the team cards always show the present — they don’t move when you step back in time.',
      },
      {
        icon: Target,
        title: 'Did it work?',
        body: 'Each week’s recap highlights the top post by measured reach, with a link into Insights for the full performance picture. The team block tracks capture streaks — consistency, not volume.',
      },
    ],
    notes: [
      {
        title: 'Owner and producer only',
        body: 'Overview is only accessible to owners, producers, and directors. Individual clinicians use Home and Stories to track their own work — Overview is the top-down management surface.',
      },
    ],
  },
}

export const HELP_PAGE_KEYS = Object.keys(HELP_CONTENT)
