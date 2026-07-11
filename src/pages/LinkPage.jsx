import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

// Public "link in bio" landing page — <slug>.withbernard.ai/link. No auth,
// no app chrome. This is what an Instagram/TikTok bio link actually points
// at, so it must always be reachable and always reflect real published
// content — see api/_routes/link-page.js and blogLinkStatus.js, which gate
// whether a caption is even allowed to say "link in bio" in the first place.
export default function LinkPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/link-page', { auth: false })
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
        <p className="text-sm text-muted-foreground">This page isn&apos;t available.</p>
      </div>
    )
  }

  if (!data) return <div className="min-h-screen bg-background" />

  const { displayName, logo, bookingUrl, website, posts } = data

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-md mx-auto px-6 py-12 text-center">
        {logo && (
          <img src={logo} alt={displayName} className="h-14 w-auto mx-auto mb-4 object-contain" />
        )}
        <h1 className="text-xl font-bold">{displayName}</h1>

        <div className="mt-8 space-y-3">
          {bookingUrl && (
            <a
              href={bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-xl border-2 border-primary bg-primary text-primary-foreground font-semibold py-3 px-4 hover:opacity-90 transition-opacity"
            >
              Book an Assessment
            </a>
          )}

          {posts.length === 0 && (
            <p className="text-sm text-muted-foreground py-6">
              New articles are on the way — check back soon.
            </p>
          )}

          {posts.map((post) => (
            <a
              key={post.url}
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-xl border border-border text-left py-3 px-4 hover:border-primary transition-colors"
            >
              <span className="text-sm font-medium">{post.title}</span>
            </a>
          ))}
        </div>

        {website && (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-8 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            See all posts →
          </a>
        )}
      </div>
    </div>
  )
}
