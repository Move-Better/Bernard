import { ImageIcon, MessageCircle, Palette, Search, Type } from 'lucide-react'

// RAIL_META — the icon-rail sections that have a real working inspector panel in
// UnifiedEditor, keyed by the rail key an archetype declares in
// `ARCHETYPES[*].rail` (src/lib/editorArchetype.js).
//
// This lives in its own module (rather than inside UnifiedEditor.jsx) so the
// archetype↔rail contract is unit-testable without importing the whole editor
// component graph — see tests/lib/editorArchetypeRail.test.js. That test is the
// guard: UnifiedEditor's rail builder silently DROPS any archetype rail key with
// no entry here (`if (!RAIL_META[k]) return false`), so a key that looks
// plausible in the archetype config but is missing below produces a tab that
// simply never renders, with no error anywhere.
//
// That exact silent-drop has now shipped four times — blog `seo` (#2109/#2115),
// email `email` (#2114), ad `variants` (#2126), and video `caption` (this one,
// which left every Reel/TikTok/Short/YouTube draft with no way to edit its
// caption at all). Adding a rail key to an archetype means adding it here too,
// or the test fails.
export const RAIL_META = {
  words: { icon: MessageCircle, label: 'Words' },
  media: { icon: ImageIcon, label: 'Media' },
  photo: { icon: ImageIcon, label: 'Media' },
  text: { icon: Type, label: 'Text' },
  grade: { icon: Palette, label: 'Grade' },
  seo: { icon: Search, label: 'SEO' },
}

export default RAIL_META
