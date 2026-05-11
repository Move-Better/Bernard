// Both /api/generate and /api/stream require a Clerk Bearer token (Phase 1A
// security lockdown 2026-05-11). window.Clerk is the runtime browser handle
// exposed by @clerk/clerk-react.

async function getClerkToken() {
  if (typeof window === 'undefined') return null
  try {
    return await window.Clerk?.session?.getToken?.()
  } catch {
    return null
  }
}

async function authHeaders() {
  const token = await getClerkToken()
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function* streamMessage(messages, systemPrompt, { model } = {}) {
  const response = await fetch('/api/stream', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ messages, systemPrompt, model }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `API error ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return
      try {
        const parsed = JSON.parse(data)
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          yield parsed.delta.text
        }
      } catch {
        // skip malformed chunks
      }
    }
  }
}

export async function generateContent(messages, systemPrompt, { model } = {}) {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ messages, systemPrompt, model }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `API error ${response.status}`)
  }

  const data = await response.json()
  return data.content[0].text
}
