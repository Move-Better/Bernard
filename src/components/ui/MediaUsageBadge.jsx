import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

// The media reuse counter — "how many posts is this photo/video already in?"
//
// One definition shared by the Library grid, the detail drawer and the picker,
// so the three surfaces can never disagree about what "used" means (the badge
// that shipped before this read media_assets.content_item_ids, a column no
// writer ever populated, so it rendered nothing on every asset). The count is
// derived server-side from content_items.media_urls — see the media_asset_usage
// view in migration 185.
//
// Deliberately ONE tone at every count. A severity ramp (amber past N uses)
// would be an invented threshold, and reuse isn't inherently bad — twice is
// often correct. The number is the signal; staff decide what's too much.

// Normalize the API's usage object. Rows that predate the counter, or a
// degraded usage lookup, arrive without it — those read as zero, not broken.
export function mediaUsage(asset) {
  const u = asset?.usage
  return {
    total:     Number(u?.total) || 0,
    published: Number(u?.published) || 0,
  }
}

// The human sentence, used as the tooltip here and as inline copy elsewhere.
export function usageSentence(asset) {
  const { total, published } = mediaUsage(asset)
  if (total === 0) return 'Not used in any post yet'
  const posts = total === 1 ? '1 post' : `${total} posts`
  if (published === 0) return `Used in ${posts} — none published yet`
  return `Used in ${posts} · ${published} published`
}

// Unused assets render nothing at all, so a library of fresh uploads stays
// clean and the badge only ever means "careful, this has been out before".
export default function MediaUsageBadge({ asset, className = '' }) {
  const { total } = mediaUsage(asset)
  if (total === 0) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`text-3xs font-medium bg-foreground/75 text-background px-1.5 py-0.5 rounded-full leading-none ${className}`}
        >
          used ×{total}
        </span>
      </TooltipTrigger>
      <TooltipContent>{usageSentence(asset)}</TooltipContent>
    </Tooltip>
  )
}
