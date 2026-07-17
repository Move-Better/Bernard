import { Palette } from 'lucide-react'
import BrandKit from '@/components/BrandKit'
import { PageHeader } from '@/components/ui/PageHeader'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

// Live Brand Kit ("Look") settings page — mounts the BrandKit component against
// the real backend (assets via /api/brand-kit/list, mutations via the role/
// style/asset endpoints). The same component renders the design preview at
// /settings/brand-kit-preview with `mockup={true}`. The page header lives here
// (the shared component has none) so Look gets the same orientation as the
// sibling Brand pages, Identity and Voice.
export default function BrandKitSettings() {
  useDocumentTitle('Look')
  return (
    <div className="space-y-6">
      <div>
        <p className="text-2xs text-muted-foreground/80">Settings · Brand · Look</p>
        <PageHeader
          className="mt-0.5 mb-0"
          icon={Palette}
          title="Look"
          subtitle="Your logos and brand assets — and which one Bernard reaches for on each channel."
        />
      </div>
      <BrandKit variant="settings" />
    </div>
  )
}
