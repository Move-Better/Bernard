import { getMediaAsset } from '@/lib/mediaLib'

// The VideoEditor's source asset query. Its own key ('src') so the
// source_clip-enriched asset can't be clobbered by MediaDetail's plain
// ['media-asset', id] cache entry.
//
// refetchOnMount 'always': the editor restores its saved edit ONCE, from
// asset.video_edit_draft, on open. The app default (staleTime 30s, gcTime 5min)
// meant reopening a clip within 5 minutes handed the restore the cached asset,
// carrying the draft as it was at the PREVIOUS open, not the edits autosaved
// since. Autosave then wrote that older edit back over the newer one (2026-11-18
// full audit, item 11). Always refetching on mount, together with
// isDraftReady() below, makes the restore read the server's current draft.
export function videoEditAssetQuery(assetId) {
  return {
    queryKey: ['media-asset', assetId, 'src'],
    queryFn: () => getMediaAsset(assetId, { withSourceClip: true }),
    enabled: !!assetId,
    retry: 1,
    refetchOnMount: 'always',
  }
}

// True once the asset has been (re)fetched since this editor mounted, so a
// cached copy from an earlier open can't seed the restore. A failed refetch
// also counts as fetched, so the editor still opens (on the cached copy)
// rather than hanging when the network is down.
export function isDraftReady(result) {
  return !!result?.data && !!result.isFetchedAfterMount
}
