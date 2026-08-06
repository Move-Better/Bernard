import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { PLATFORM_META } from '@/lib/contentMeta'

// The media reuse counter — "how many posts is this photo/video already in?"
//
// One definition shared by the Library grid, the detail drawer and the picker,
// so the three surfaces can never disagree about what "used" means (the badge
// that shipped before this read media_assets.content_item_ids, a column no
// writer ever populated, so it rendered nothing on every asset). The count is
// derived server-side from content_items.media_urls — see the media_asset_usage
// view in migration 185.
//
// Deliberately ONE tone at every count of PUBLISHED use. A severity ramp
// (amber past N uses) would be an invented threshold, and reuse isn't
// inherently bad — twice is often correct. The number is the signal; staff
// decide what's too much.
//
// Leads with PUBLISHED, not total (feedback bdae4d9d, Philip): a photo
// sitting in two drafts had never actually been in front of an audience, but
// "used ×2" read exactly like it had. Draft/rejected uses still show — as a
// distinct, quieter "N drafts" chip — rather than vanishing, since "this is
// already queued elsewhere" is still useful context, just not the same claim
// as "this has already gone out."

// Normalize the API's usage object. Rows that predate the counter, or a
// degraded usage lookup, arrive without it — those read as zero, not broken.
export function mediaUsage(asset) {
  const u = asset?.usage
  return {
    total:     Number(u?.total) || 0,
    published: Number(u?.published) || 0,
    // [{platform, count}], published-only, highest first — see media/list.js
    // withUsage and clipSearch.js fetchUsage, the two places this is built.
    platforms: Array.isArray(u?.platforms) ? u.platforms : [],
  }
}

function platformLabel(platform) {
  return PLATFORM_META[platform]?.label || platform
}

// The human sentence, used as the tooltip here and as inline copy elsewhere.
export function usageSentence(asset) {
  const { total, published, platforms } = mediaUsage(asset)
  if (total === 0) return 'Not used in any post yet'

  const drafts = Math.max(total - published, 0)
  const draftNote = drafts > 0
    ? ` — ${drafts} more ${drafts === 1 ? 'draft' : 'drafts'} queued`
    : ''

  if (published === 0) {
    const posts = total === 1 ? '1 post' : `${total} posts`
    return `Queued in ${posts}, not published yet`
  }

  const where = platforms.length
    ? platforms.map((p) => (p.count > 1 ? `${platformLabel(p.platform)} ×${p.count}` : platformLabel(p.platform))).join(', ')
    : `${published} ${published === 1 ? 'post' : 'posts'}`

  return `Published on ${where}${draftNote}`
}

// Unused assets render nothing at all, so a library of fresh uploads stays
// clean and the badge only ever means "careful, this has been out before".
export default function MediaUsageBadge({ asset, className = '' }) {
  const { total, published } = mediaUsage(asset)
  if (total === 0) return null

  // Zero published: a quiet outlined chip, not the same solid pill a real
  // publish gets — "queued elsewhere" and "already out" are different claims
  // and shouldn't look the same weight.
  if (published === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`text-3xs font-medium bg-background/80 text-muted-foreground border border-border px-1.5 py-0.5 rounded-full leading-none ${className}`}
          >
            {total} {total === 1 ? 'draft' : 'drafts'}
          </span>
        </TooltipTrigger>
        <TooltipContent>{usageSentence(asset)}</TooltipContent>
      </Tooltip>
    )
  }

  // Published: the bare count, no "published"/"live" wording — color carries
  // the meaning, the tooltip carries the detail (Q, 2026-08-06).
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`text-3xs font-semibold bg-success text-white px-1.5 py-0.5 rounded-full leading-none min-w-[1.1rem] text-center ${className}`}
        >
          {published}
        </span>
      </TooltipTrigger>
      <TooltipContent>{usageSentence(asset)}</TooltipContent>
    </Tooltip>
  )
}
