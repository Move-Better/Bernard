// The post's OWN title, for the editor top bar and the published view.
//
// Post editor audit option C (2026-11-10, mockup signed off 2026-11-11). Before
// this the top bar named the story the post came from (`topic`), or, in the
// video editor, the video FILE ("Person correcting hip hinge with hands on
// hips"). Neither is what the post says, and two posts from one story read
// identically. First match wins:
//   1. a blog: the article's heading
//   2. a post with slides: the cover slide's words (all-capitals shown in
//      normal case, known short terms like ACL kept)
//   3. any other post: the caption's first sentence; two sentences when the
//      first is under five words ("Not a waiting list."), cut at 80 characters
//   4. nothing usable: the story's name, as before
// The story's name moves to a small "From story: …" line (postStoryLine).

import { stripStoryDatePrefix } from '@/lib/storyTitle'

export const POST_TITLE_MAX = 80

// Terms that must stay in capitals when cover text is shown in normal case.
const KEEP_CAPS = new Set(['ACL', 'MCL', 'PCL', 'LCL', 'TMJ', 'MRI', 'ITB', 'DOMS', 'SI', 'PT', 'USA'])

function firstHeading(content) {
  if (typeof content !== 'string') return ''
  const m = content.match(/^#{1,6}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

// "KNEE PAIN ON AND OFF LIKE A SWITCH" → "Knee pain on and off like a switch".
// Only touches text with no lowercase letters, so a deliberately cased cover
// ("Your back doesn't have a strength problem.") is left exactly as written.
export function normalCase(text) {
  if (!text || /[a-z]/.test(text) || !/[A-Z]/.test(text)) return text
  let first = true
  return text.split(/(\s+)/).map((tok) => {
    if (/^\s+$/.test(tok)) return tok
    const core = tok.replace(/[^A-Za-z]/g, '')
    let out
    if (KEEP_CAPS.has(core)) out = tok
    else if (/^I(['’][A-Z]+)?$/.test(tok.replace(/[^A-Za-z'’]/g, ''))) out = tok.replace(/['’][A-Z]+/, (m) => m.toLowerCase())
    else {
      const lower = tok.toLowerCase()
      out = first ? lower.replace(/[a-z]/, (c) => c.toUpperCase()) : lower
    }
    if (core) first = false
    return out
  }).join('')
}

function coverText(slides) {
  if (!Array.isArray(slides) || !slides.length) return ''
  const blocks = Array.isArray(slides[0]?.blocks) ? slides[0].blocks : []
  const withText = blocks.filter((b) => typeof b?.text === 'string' && b.text.trim())
  const pick = withText.find((b) => b.role === 'hook') || withText[0]
  return pick ? pick.text.replace(/\s+/g, ' ').trim() : ''
}

function cut(text, max = POST_TITLE_MAX) {
  if (text.length <= max) return text
  const head = text.slice(0, max - 1)
  const lastSpace = head.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? head.slice(0, lastSpace) : head).replace(/[\s,;:—–-]+$/, '')}…`
}

// The caption's opening: first sentence, or the first two when the first is
// too short to say anything.
export function captionOpening(content) {
  if (typeof content !== 'string') return ''
  const firstPara = content.trim().split(/\n\s*\n/)[0] || ''
  const line = firstPara.replace(/^#{1,6}\s+/gm, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
  if (!line) return ''
  const sentences = line.match(/[^.!?]+[.!?]+["”’)]*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || [line]
  let opening = sentences[0]
  if (opening.split(/\s+/).length < 5 && sentences[1]) opening = `${opening} ${sentences[1]}`
  return opening
}

export function postTitle(piece) {
  if (!piece) return 'Untitled draft'
  const story = stripStoryDatePrefix(piece.topic)
  if (piece.platform === 'blog') {
    const h = firstHeading(piece.content)
    if (h) return h
  } else {
    const cover = coverText(piece.slides)
    if (cover) return cut(normalCase(cover))
    const opening = captionOpening(piece.content)
    if (opening) return cut(opening)
  }
  return story || firstHeading(piece.content) || 'Untitled draft'
}

// "From story: Low back pain", or null when the title already IS the story name.
export function postStoryLine(piece) {
  const story = stripStoryDatePrefix(piece?.topic)
  if (!story) return null
  return story === postTitle(piece) ? null : `From story: ${story}`
}
