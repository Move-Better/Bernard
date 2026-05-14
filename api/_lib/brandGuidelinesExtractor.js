// Extracts brand voice + tone guidelines from a brand book PDF.
// Called async via waitUntil in the brand-kit upload webhook — runs after
// the brand_assets row is committed so the webhook returns 200 immediately.
//
// Output is a plain-text block intended for direct injection into AI system
// prompts, not for display. Shape:
//
//   BRAND VOICE: …
//   TONE: …
//   KEY MESSAGES: …
//   AVOID: …
//
// If extraction fails for any reason (bad PDF, model error, timeout) this
// returns null so the caller can skip the DB write rather than storing garbage.

import { generateText } from 'ai'
import { getDocumentProxy, extractText } from 'unpdf'

// Rough character budget to keep the Claude call within token limits.
// A 20-page brand book runs ~30k chars of extracted text; we use 20k to
// ensure color/font pages near the back of the PDF are included.
const MAX_PDF_CHARS = 20_000

const HEX_RE = /^#[0-9a-f]{3,6}$/i

const EXTRACTION_PROMPT = `You are extracting brand guidelines from a brand book PDF to help an AI content writer produce on-brand copy.

Read the text below and output ONLY the following lines (no headers, no bullet points, no extra commentary):

BRAND VOICE: [2-4 adjectives or short phrases describing the brand's voice/personality, comma-separated]
TONE: [1-2 sentences describing the desired writing tone and emotional register]
KEY MESSAGES: [3-5 core brand messages or beliefs, separated by " | "]
AVOID: [3-5 things to never say or write, separated by " | "]
PRIMARY COLOR: [the single most prominent brand hex color (not black or white), e.g. #E36525 — output only the hex, or "Not specified"]
SECONDARY COLORS: [all remaining named brand colors as hex codes, comma-separated, e.g. #6E7072, #C35727, #F57E20 — include every named color from Primary and Secondary color pages, exclude black (#000000) and white (#FFFFFF), or "Not specified"]
HEADING FONT: [the primary heading/display typeface name, or "Not specified"]
BODY FONT: [the body copy typeface name, or "Not specified"]

Color extraction rules:
- Brand books typically list colors with HEX codes. Extract ALL of them.
- The primary/accent color is usually labeled as the main brand color or appears most in the logo.
- Secondary colors include all other named palette entries (darker, lighter variants, neutrals, accent greys, greens, etc.).
- Convert any RGB values to hex only if no hex is provided in the document.

If a section isn't addressed in the document, write "Not specified" for that line.
Output exactly 8 lines, no more.`

export async function extractBrandGuidelines(pdfBlobUrl) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('brandGuidelinesExtractor: AI_GATEWAY_API_KEY not set — skipping extraction')
    return null
  }

  let pdfText = ''
  try {
    const res = await fetch(pdfBlobUrl)
    if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    const pdf = await getDocumentProxy(buf)
    const { text: rawText } = await extractText(pdf, { mergePages: true })
    pdfText = (rawText || '').slice(0, MAX_PDF_CHARS).trim()
  } catch (e) {
    console.error('brandGuidelinesExtractor: PDF parse failed:', e?.message)
    return null
  }

  if (!pdfText) {
    console.error('brandGuidelinesExtractor: no text extracted from PDF (scanned image?)')
    return null
  }

  try {
    const { text } = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: `BRAND BOOK TEXT:\n\n${pdfText}` }],
      temperature: 0.1,
      maxTokens: 600,
    })
    const trimmed = text.trim()
    // Sanity-check: must have the four core section labels
    const valid = ['BRAND VOICE:', 'TONE:', 'KEY MESSAGES:', 'AVOID:'].every((label) =>
      trimmed.includes(label)
    )
    if (!valid) {
      console.error('brandGuidelinesExtractor: model output missing expected labels:', trimmed)
      return null
    }

    // Parse style fields for the brand_style row
    const primaryMatch   = trimmed.match(/^PRIMARY COLOR:\s*(.+)$/m)
    const secondaryMatch = trimmed.match(/^SECONDARY COLORS:\s*(.+)$/m)
    const headingMatch   = trimmed.match(/^HEADING FONT:\s*(.+)$/m)
    const bodyMatch      = trimmed.match(/^BODY FONT:\s*(.+)$/m)

    const primaryRaw   = primaryMatch?.[1]?.trim()
    const secondaryRaw = secondaryMatch?.[1]?.trim()
    const headingRaw   = headingMatch?.[1]?.trim()
    const bodyRaw      = bodyMatch?.[1]?.trim()

    const stylePatch = {}

    if (primaryRaw && primaryRaw !== 'Not specified' && HEX_RE.test(primaryRaw)) {
      stylePatch.accent_color = primaryRaw.toUpperCase()
    }

    if (secondaryRaw && secondaryRaw !== 'Not specified') {
      const secondaryHexes = secondaryRaw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => HEX_RE.test(s))
      if (secondaryHexes.length > 0) stylePatch.secondary_colors = secondaryHexes
    }

    if (headingRaw && headingRaw !== 'Not specified') stylePatch.heading_font = headingRaw
    if (bodyRaw    && bodyRaw    !== 'Not specified') stylePatch.body_font    = bodyRaw

    return { guidelines: trimmed, stylePatch }
  } catch (e) {
    console.error('brandGuidelinesExtractor: model call failed:', e?.message)
    return null
  }
}
