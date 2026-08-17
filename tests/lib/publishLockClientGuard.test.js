import { describe, it, expect, vi, beforeEach } from 'vitest'

// The CLIENT half of the publish lock.
//
// The server half (tests/lib/publishLock.test.js + contentRouteEnforcesPublishLock)
// was already correct when a producer hit this on 2026-08-10 — the writes WERE
// being refused. What was missing is what the client does with the refusal:
//
//   1. It toasted the raw reason key ("locked_scheduled") at the producer.
//   2. It did nothing to the stale cache that let the editor mount in the first
//      place. The publish pipeline commits scheduled/published via sb() directly,
//      bypassing the PATCH route, so nothing invalidates the client's copy of the
//      row. StoryboardPublish's lock gate reads that stale copy, keeps rendering
//      the editor, the editor keeps autosaving, and every autosave 409s. A failed
//      save never advances the autosave baseline and never invalidated anything,
//      so the only thing that could refresh the cache was a SUCCESSFUL save —
//      which is exactly what the lock makes impossible. A toast per debounce
//      window, with no way out.
//
// So the two things worth pinning are that the client still RECOGNIZES the
// server's refusal (a rename on either side must go red, not silent), and that
// recognizing it refetches instead of shouting.

const toastError = vi.fn()
const toastWarning = vi.fn()
vi.mock('@/lib/toast', () => ({
  toast: { error: toastError, success: vi.fn(), warning: toastWarning, message: vi.fn() },
}))

let capturedMutationOptions = null
const invalidateQueries = vi.fn()
const setQueryData = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useMutation: (opts) => {
    capturedMutationOptions = opts
    return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }
  },
  useQuery: () => ({ data: undefined, isLoading: false }),
  useInfiniteQuery: () => ({ data: undefined, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries, setQueryData }),
  keepPreviousData: Symbol('keepPreviousData'),
}))

const {
  checkPatchAgainstLock,
  isLockRejection,
  LOCK_REJECTION_REASONS,
  LOCKED_STATUSES,
  FROZEN_PATCH_FIELDS,
} = await import('@/lib/publishLock')
const { useAppMutation } = await import('@/lib/useAppMutation')

beforeEach(() => {
  toastError.mockClear()
  toastWarning.mockClear()
  invalidateQueries.mockClear()
  setQueryData.mockClear()
  capturedMutationOptions = null
})

/**
 * The error the client actually receives, assembled from the two real hops:
 * api/_routes/db/content.js does `res.status(409).json({ error: verdict.reason })`,
 * and apiError.js's throwApiError turns that into an ApiError carrying both the
 * status and the parsed payload.
 */
function rejectionFromServer(currentStatus, patch) {
  const verdict = checkPatchAgainstLock(currentStatus, patch)
  if (verdict.ok) return null
  return { name: 'ApiError', status: 409, payload: { error: verdict.reason }, message: verdict.reason }
}

describe('the client recognizes what the server refuses', () => {
  it('accepts every rejection the real lock can produce', () => {
    // One patch per frozen field, against every locked status — so a field or a
    // status added later is covered without touching this test.
    const cases = []
    for (const status of LOCKED_STATUSES) {
      for (const field of FROZEN_PATCH_FIELDS) {
        const err = rejectionFromServer(status, { [field]: 'x' })
        if (err) cases.push({ status, field, err })
      }
      // The two non-field rejections: a status move and a reschedule.
      for (const patch of [{ status: 'draft' }, { scheduledAt: null }]) {
        const err = rejectionFromServer(status, { ...patch, content: 'x' })
        if (err) cases.push({ status, field: Object.keys(patch)[0], err })
      }
    }

    // Non-vacuity: a rotted loop that produces no cases would otherwise pass
    // this test trivially, forever, while guarding nothing.
    expect(cases.length).toBe(LOCKED_STATUSES.length * (FROZEN_PATCH_FIELDS.length + 2))

    for (const { status, field, err } of cases) {
      expect(isLockRejection(err), `${status} / ${field} went unrecognized`).toBe(true)
    }
  })

  it('covers every declared reason, so neither list can grow alone', () => {
    const produced = new Set(
      LOCKED_STATUSES.map((s) => checkPatchAgainstLock(s, { content: 'x' }).reason),
    )
    expect([...produced].sort()).toEqual([...LOCK_REJECTION_REASONS].sort())
  })

  it('names the status that actually refused', () => {
    // The set check above is blind to the MAPPING: swapping which status yields
    // which reason keeps the set identical, and nothing else in the suite
    // noticed (verified by mutation — the whole suite stayed green with the two
    // inverted). The reason is what the route logs when it blocks a write, so an
    // inverted pair sends the next person debugging at the wrong state.
    expect(checkPatchAgainstLock('scheduled', { content: 'x' }).reason).toBe('locked_scheduled')
    expect(checkPatchAgainstLock('published', { content: 'x' }).reason).toBe('locked_published')
    // The non-field branches derive it separately — pin those too.
    expect(checkPatchAgainstLock('scheduled', { scheduledAt: null }).reason).toBe('locked_scheduled')
    expect(checkPatchAgainstLock('published', { status: 'draft' }).reason).toBe('locked_published')
  })
})

describe('it does not swallow anything else', () => {
  it.each([
    ['a 500 from the same route', { status: 500, payload: { error: 'Update failed' } }],
    ['a 400 validation error', { status: 400, payload: { error: 'invalid_id' } }],
    ['a 409 for some other conflict', { status: 409, payload: { error: 'version_conflict' } }],
    ['a 409 with no payload', { status: 409 }],
    ['a network error with no status', { message: 'Failed to fetch' }],
  ])('rejects %s', (_label, err) => {
    expect(isLockRejection(err)).toBe(false)
  })

  it.each([null, undefined, 'locked_scheduled', 409])('rejects the non-object %s', (err) => {
    expect(isLockRejection(err)).toBe(false)
  })
})

describe('useAppMutation suppresses one class of error, not all of them', () => {
  const lockErr = { status: 409, payload: { error: 'locked_published' } }
  const serverErr = Object.assign(new Error('Update failed'), { status: 500 })

  it('stays quiet when the predicate matches', () => {
    useAppMutation({ errorMessage: "Couldn't update content", silent: isLockRejection })
    capturedMutationOptions.onError(lockErr, { id: 'p1' }, undefined)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('still toasts every error the predicate does not match', () => {
    useAppMutation({ errorMessage: "Couldn't update content", silent: isLockRejection })
    capturedMutationOptions.onError(serverErr, { id: 'p1' }, undefined)
    expect(toastError).toHaveBeenCalledWith("Couldn't update content", { description: 'Update failed' })
  })

  it('runs the caller onError either way — suppression is about the toast only', () => {
    const onError = vi.fn()
    useAppMutation({ silent: isLockRejection, onError })
    capturedMutationOptions.onError(lockErr, { id: 'p1' }, undefined)
    capturedMutationOptions.onError(serverErr, { id: 'p1' }, undefined)
    expect(onError).toHaveBeenCalledTimes(2)
  })

  it('keeps honouring a plain boolean silent', () => {
    useAppMutation({ silent: true })
    capturedMutationOptions.onError(serverErr, {}, undefined)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('toasts by default', () => {
    useAppMutation({ errorMessage: 'Nope' })
    capturedMutationOptions.onError(serverErr, {}, undefined)
    expect(toastError).toHaveBeenCalled()
  })
})

describe('useUpdateContentItem heals the stale cache that caused the storm', () => {
  const lockErr = { status: 409, payload: { error: 'locked_scheduled' } }
  // A transient 5xx that has already burned the retry budget. This is the
  // self-recovering blip from feedback 9b080c3e (movebetter/Philip, 2026-08-17):
  // a caption PATCH 5xx'd for minutes, then the row saved + published fine.
  const transientErr = Object.assign(new Error('Update failed'), { status: 500 })
  // A genuine client-side rejection (bad request) — not a lock, not transient.
  const clientErr = Object.assign(new Error('invalid_id'), { status: 400 })

  async function mountUpdateContentItem() {
    const { useUpdateContentItem } = await import('@/lib/queries')
    useUpdateContentItem()
    return capturedMutationOptions
  }

  it('refetches the piece so the editor can be replaced by the receipt', async () => {
    const opts = await mountUpdateContentItem()
    opts.onError(lockErr, { id: 'piece-1' })
    // contentItems.all is a key PREFIX of detail(id), so this reaches the open
    // editor's own row as well as every list still showing it as editable.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contentItems'] })
  })

  it('only a lock refetches — a transient 5xx does not touch the cache', async () => {
    const opts = await mountUpdateContentItem()
    opts.onError(transientErr, { id: 'piece-1' })
    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('shows the producer nothing for a lock — this is the toast storm', async () => {
    const opts = await mountUpdateContentItem()
    opts.onError(lockErr, { id: 'piece-1' })
    expect(toastError).not.toHaveBeenCalled()
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('surfaces a transient 5xx as a CALM warning, never a red error', async () => {
    const opts = await mountUpdateContentItem()
    opts.onError(transientErr, { id: 'piece-1' })
    expect(toastError).not.toHaveBeenCalled()
    expect(toastWarning).toHaveBeenCalledWith(
      "Couldn't save just now",
      expect.objectContaining({ description: expect.stringContaining('still here') }),
    )
  })

  it('still shows a red error for a genuine 4xx — a real failure stays visible', async () => {
    const opts = await mountUpdateContentItem()
    opts.onError(clientErr, { id: 'piece-1' })
    expect(toastError).toHaveBeenCalledWith("Couldn't update content", { description: 'invalid_id' })
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('never retries a refusal the server will repeat', async () => {
    const opts = await mountUpdateContentItem()
    expect(opts.retry(0, lockErr)).toBe(false)
  })

  it('retries a transient 5xx across the widened budget, then stops', async () => {
    const opts = await mountUpdateContentItem()
    expect(opts.retry(0, transientErr)).toBe(true)
    expect(opts.retry(3, transientErr)).toBe(true)
    expect(opts.retry(4, transientErr)).toBe(false)
  })
})
