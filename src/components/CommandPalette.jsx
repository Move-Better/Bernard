import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Building2, BarChart3, CalendarRange, Newspaper, Pickaxe,
  Megaphone, FolderOpen, BookOpen, PenLine, Mic2, Settings, Palette, Plug, Plus, Mic,
} from 'lucide-react'
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from '@/components/ui/command'

// Global ⌘K / Ctrl+K command palette — fuzzy-jump to any page or quick action.
// Mounted once in the authed shell (Layout). Mirrors the sidebar nav so the two
// stay in step; if a nav destination is added, add it here too.
const ACTIONS = [
  { icon: Plus, label: 'New post', to: '/new', shortcut: 'N' },
  { icon: Mic, label: 'New interview', to: '/new' },
]
const GO_TO = [
  { icon: LayoutDashboard, label: 'Home', to: '/' },
  { icon: Building2, label: 'Overview', to: '/overview' },
  { icon: BarChart3, label: 'Insights', to: '/analytics' },
  { icon: CalendarRange, label: 'Your week', to: '/week' },
  { icon: Newspaper, label: 'Stories', to: '/stories' },
  { icon: Pickaxe, label: 'Moments', to: '/moments' },
  { icon: Megaphone, label: 'Ads', to: '/ads' },
  { icon: FolderOpen, label: 'Library', to: '/library' },
  { icon: BookOpen, label: 'Book', to: '/book' },
  { icon: PenLine, label: 'Write', to: '/write' },
  { icon: Mic2, label: 'Pre-Visit', to: '/pre-visit' },
]
const SETTINGS = [
  { icon: Settings, label: 'Workspace settings', to: '/settings/workspace' },
  { icon: Palette, label: 'Brand kit', to: '/settings/brand-kit' },
  { icon: Plug, label: 'Integrations', to: '/settings/integrations' },
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const go = useCallback((to) => { setOpen(false); navigate(to) }, [navigate])

  const renderItems = (items) =>
    items.map(({ icon: Icon, label, to, shortcut }) => (
      <CommandItem key={label} value={label} onSelect={() => go(to)}>
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span>{label}</span>
        {shortcut ? <CommandShortcut>{shortcut}</CommandShortcut> : null}
      </CommandItem>
    ))

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to a page or action…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Actions">{renderItems(ACTIONS)}</CommandGroup>
        <CommandGroup heading="Go to">{renderItems(GO_TO)}</CommandGroup>
        <CommandGroup heading="Settings">{renderItems(SETTINGS)}</CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
