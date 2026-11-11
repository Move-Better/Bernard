import {
  Settings, Mic2, Radio, Puzzle, Palette, Users, CreditCard, MapPin,
  Sliders, Target, Zap, LayoutGrid, Shield, Compass, Brain, Music, Film, Bot,
} from 'lucide-react'

// One list drives both the desktop sidebar and the phone chip rail, so the
// two can never disagree about order or about who sees what. Grouped by job
// (simplicity audit G, 2026-11-10). Items without `everyone: true` are owner
// (admin) only; the pages also guard themselves.
export const SETTINGS_GROUPS = [
  {
    label: 'Clinic',
    items: [
      { to: '/settings/workspace',           label: 'General',            icon: Settings,   exact: true },
      { to: '/settings/workspace/locations', label: 'Locations',          icon: MapPin },
      { to: '/settings/workspace/billing',   label: 'Plan & billing',     icon: CreditCard, everyone: true },
    ],
  },
  {
    label: 'Posting',
    items: [
      { to: '/settings/integrations',            label: 'Integrations', icon: Puzzle, everyone: true },
      { to: '/settings/workspace/channels',      label: 'Channels',     icon: Radio },
      { to: '/settings/campaigns',               label: 'Campaigns',    icon: Target },
      { to: '/settings/workspace/auto-publish',  label: 'Auto-publish', icon: Zap },
    ],
  },
  {
    label: 'Brand',
    items: [
      { to: '/settings/brand-identity',  label: 'Identity',        icon: Compass },
      { to: '/settings/workspace/voice', label: 'Voice',           icon: Mic2 },
      { to: '/settings/brand-kit',       label: 'Look',            icon: Palette, everyone: true },
      { to: '/settings/photo-templates', label: 'Photo templates', icon: LayoutGrid },
      { to: '/settings/video-templates', label: 'Reel templates',  icon: Film },
      { to: '/settings/music',           label: 'Music',           icon: Music },
    ],
  },
  {
    label: 'Bernard',
    items: [
      { to: '/producer/settings',            label: 'Bernard’s settings', icon: Bot },
      { to: '/settings/workspace/interview', label: 'Interview setup',        icon: Sliders },
      { to: '/settings/practice-brain',      label: 'Clinic knowledge',       icon: Brain },
    ],
  },
  {
    label: 'Team',
    items: [
      { to: '/settings/members', label: 'Members & roles', icon: Users },
      { to: '/settings/access',  label: 'Permissions',     icon: Shield },
    ],
  },
]

// The groups a given viewer sees: owners see everything; everyone else sees
// only the items marked `everyone`, and a group with none left is dropped.
export function visibleSettingsGroups(isAdmin) {
  return SETTINGS_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => isAdmin || it.everyone) }))
    .filter((g) => g.items.length > 0)
}
