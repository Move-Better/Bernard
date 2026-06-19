// @ts-check
// Shared client download helpers. Vercel Blob public URLs are CORS-enabled, so a
// direct <a download> works without buffering the file into browser RAM (which
// kills tabs on large videos).

/**
 * Trigger a browser download of a public URL with a chosen filename.
 * @param {string} url
 * @param {string} [filename]
 */
export function downloadFromUrl(url, filename) {
  const link = document.createElement('a')
  link.href = url
  link.download = filename || ''
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/**
 * Force-download a (small) file by fetching it into a blob and saving via a
 * same-origin object URL. The plain <a download> above is ignored by browsers
 * when the href is cross-origin (our blob URLs live on *.blob.vercel-storage.com,
 * a different origin than the app), so it navigates instead of downloading.
 * Vercel Blob URLs are CORS-enabled, so the fetch succeeds. Use this only for
 * small assets (images) — it buffers the whole file into memory, so large
 * videos must keep using downloadFromUrl to avoid killing the tab.
 * @param {string} url
 * @param {string} [filename]
 */
export async function downloadBlobFile(url, filename) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    downloadFromUrl(objectUrl, filename)
  } finally {
    // Revoke after the click has had time to start the save.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
  }
}

/**
 * Download several small files (images) in sequence. Browsers suppress rapid
 * back-to-back programmatic downloads, so a small gap between each keeps them
 * all from being blocked.
 * @param {Array<{ url: string, filename?: string }>} items
 */
export async function downloadMany(items) {
  for (const { url, filename } of items) {
    await downloadBlobFile(url, filename)
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}
