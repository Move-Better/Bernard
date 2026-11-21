// @vitest-environment jsdom
//
// Render test for the VideoEditor draft restore (PR #2830, 2026-11-18 full
// audit item 11). Reopening a clip inside the query cache window must restore
// the NEWEST saved edit. The editor restores once, from asset.video_edit_draft,
// then autosaves, so restoring a stale cached draft writes the old edit back
// over the new one.
//
// This mounts the real <VideoEditor> under jsdom with a QueryClient built with
// the app's defaults and a cache seeded at the "previous open", then asserts on
// the trim the editor actually restored (read off the Canvas the editor hands
// its ctx to). Heavy children and network libs are stubbed; the restore effect,
// the 'src' asset query and the readiness gate are the real code.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const ASSET_ID = '9b2f1c3e-4d5a-4b6c-8d7e-0f1a2b3c4d5e'
const OLD_DRAFT = { startSec: 1.5, endSec: 4 } // what the previous open saw
const NEW_DRAFT = { startSec: 7.25, endSec: 12 } // autosaved after that

const seenTrims = vi.hoisted(() => [])
const mocks = vi.hoisted(() => ({ getMediaAsset: vi.fn(), updateMediaAsset: vi.fn() }))

vi.mock('@/lib/mediaLib', () => ({
  getMediaAsset: mocks.getMediaAsset,
  updateMediaAsset: mocks.updateMediaAsset,
}))

// The editor's own subcomponents: the Canvas stub exposes the restored trim.
vi.mock('@/pages/video-editor/Canvas', () => ({
  Canvas: ({ ctx }) => {
    const trim = `${ctx.startSec}-${ctx.endSec}`
    seenTrims.push(trim)
    return <div data-testid="trim">{trim}</div>
  },
}))
for (const path of [
  '@/pages/video-editor/HorizontalTimeline', '@/pages/video-editor/IconRail',
  '@/pages/video-editor/inspectors/CaptionInspector', '@/pages/video-editor/inspectors/ClipInspector',
  '@/pages/video-editor/inspectors/GradeInspector', '@/pages/video-editor/inspectors/MediaInspector',
  '@/pages/video-editor/inspectors/MomentsInspector', '@/pages/video-editor/inspectors/MusicInspector',
  '@/pages/video-editor/inspectors/OverlayInspector', '@/pages/video-editor/inspectors/PostCaptionInspector',
  '@/pages/video-editor/inspectors/TranscriptInspector',
]) {
  const name = path.split('/').pop()
  vi.doMock(path, () => ({ [name]: () => null }))
}
vi.mock('@/components/AdVideoExportModal', () => ({ default: () => null }))
vi.mock('@/components/editor/EditorChrome', () => ({ default: () => null }))
vi.mock('@/components/editor/EditorWorkflowBar', () => ({ default: () => null }))
vi.mock('@/components/editor/EditorMoreMenu', () => ({ default: () => null }))
vi.mock('@/components/moments/ClipDiscardReasons', () => ({ default: () => null }))
vi.mock('@/lib/clipsLib', () => ({
  getSegments: vi.fn(async () => ({ segments: [] })),
  renderWholeVideo: vi.fn(), findClips: vi.fn(), updateSegment: vi.fn(),
  exportClipToBroll: vi.fn(), startClipRenderJob: vi.fn(), getClipRenderJob: vi.fn(),
}))
vi.mock('@/lib/brandKitLib', () => ({ updateBrandStyle: vi.fn() }))
vi.mock('@/lib/editorRevisions', () => ({ listRevisions: vi.fn(async () => []), saveRevision: vi.fn(async () => {}) }))
vi.mock('@/lib/posthog', () => ({ posthogCapture: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(async () => ({})), apiFetchResponse: vi.fn() }))
vi.mock('@/lib/faceReframe', () => ({ detectFaceCenterX: vi.fn() }))
vi.mock('@/lib/queries', () => ({
  useContentItem: () => ({ data: null }),
  useUpdateContentItem: () => ({ mutate: vi.fn() }),
  useUpdateContentItemStatus: () => ({ mutate: vi.fn() }),
}))

const { default: VideoEditor } = await import('../../src/pages/VideoEditor.jsx')

// Same query defaults as src/App.jsx's QueryClient (staleTime 30s, gcTime 5min).
function appClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 5 * 60_000, refetchOnWindowFocus: false } } })
}

function openEditor(client) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/moments/clip/${ASSET_ID}`]}>
        <Routes><Route path="/moments/clip/:assetId" element={<VideoEditor />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => { seenTrims.length = 0; cleanup(); vi.clearAllMocks(); localStorage.clear() })

describe('VideoEditor draft restore on reopen (render)', () => {
  it('restores the newer server draft when the cache still holds the previous open', async () => {
    mocks.getMediaAsset.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20))
      return { id: ASSET_ID, video_edit_draft: NEW_DRAFT }
    })
    const client = appClient()
    // The previous open left a FRESH (well inside staleTime) cache entry.
    client.setQueryData(['media-asset', ASSET_ID, 'src'], { id: ASSET_ID, video_edit_draft: OLD_DRAFT })

    openEditor(client)

    await waitFor(() => expect(screen.getByTestId('trim').textContent).toBe('7.25-12'))
    expect(mocks.getMediaAsset).toHaveBeenCalledTimes(1)
    // The stale cached draft must never have been restored, even briefly:
    // that restore is what autosave would write back over the newer edit.
    expect(seenTrims).not.toContain('1.5-4')
  })
})
