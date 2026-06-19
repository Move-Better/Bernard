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
 * Download several files in sequence. Browsers suppress rapid back-to-back
 * programmatic downloads, so a small gap between each keeps them all from being
 * blocked.
 * @param {Array<{ url: string, filename?: string }>} items
 */
export async function downloadMany(items) {
  for (const { url, filename } of items) {
    downloadFromUrl(url, filename)
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}
