// Per-channel system prompts for Brief-sourced content generation.
// Briefs are workspace-level (no specific clinician), so these prompts use
// workspace voice/tone rather than staff-level voice fidelity.
//
// Each prompt receives the full brief object and returns a { system, user }
// pair ready to pass to generateText. Returns null for unsupported platforms
// so callers can skip gracefully.

// Format an optional event date for injection into prompts.
function fmtDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
  } catch { return null }
}

function fmtTime(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return null }
}

// Build a compact brief-context block to include in every prompt.
function briefBlock(brief) {
  const parts = [`Message:\n${brief.body}`]
  const d = fmtDate(brief.event_at)
  const t = fmtTime(brief.event_at)
  if (d) parts.push(`Event date: ${d}${t ? ` at ${t}` : ''}`)
  if (brief.location) parts.push(`Location: ${brief.location}`)
  if (brief.cta_url) parts.push(`CTA URL: ${brief.cta_url}`)
  if (brief.cta_label) parts.push(`CTA label: ${brief.cta_label}`)
  return parts.join('\n')
}

export function getBriefChannelPrompt(brief, platform, workspace) {
  const wsName    = workspace?.display_name || 'us'
  const brandTag  = workspace?.brand_hashtag  ? ` ${workspace.brand_hashtag}` : ''
  const locTag    = workspace?.location_hashtag ?? '#physicaltherapy'
  const ctaLine   = brief.cta_url
    ? `\nClose with: "${brief.cta_label || 'Learn more'}: ${brief.cta_url}"`
    : ''
  const ctx = briefBlock(brief)

  const VOICE_RULE = `Write in the voice of ${wsName} — warm, direct, human, community-focused. No corporate-speak, no excessive emojis. Keep it genuine.`

  switch (platform) {

    case 'instagram':
    case 'instagram_post':
      return {
        system: `You are writing a single Instagram caption for ${wsName}.
${VOICE_RULE}
PLAIN TEXT ONLY: no markdown, no asterisks, no headers.`,
        user: `Write an Instagram caption (~150 words) based on this brief.
${ctx}

Open with a scroll-stopping hook. Keep it personal and specific — real details, not vague promotion. Do NOT include a URL in the caption body (Instagram links don't work in captions).${ctaLine ? '\nClose with: "Link in bio 👆"' : ''}
Add a blank line, then 5–8 relevant hashtags ending with${brandTag ? ` ${brandTag} and` : ''} ${locTag}.
Output ONLY the caption and hashtags.`,
      }

    case 'instagram_story':
      return {
        system: `You are writing overlay text for a single Instagram Story frame for ${wsName}.
${VOICE_RULE}`,
        user: `Write overlay text for an Instagram Story based on this brief.
${ctx}

FORMAT: 5–8 words maximum. ALL CAPS. This text appears printed over a photo or branded card — it must grab attention in under a second.
Think billboard: short, punchy, no filler words.

After the overlay text, on a new line output:
LINK_STICKER_TEXT: <2–4 word action phrase for the link sticker label>

Output ONLY those two lines. Nothing else.`,
      }

    case 'facebook':
      return {
        system: `You are writing a Facebook post for ${wsName}.
${VOICE_RULE}
PLAIN TEXT ONLY: no markdown, no asterisks.`,
        user: `Write a Facebook post (~200 words) based on this brief.
${ctx}

Facebook allows links in the body — include the CTA URL naturally in the post${brief.cta_label ? ` using the label "${brief.cta_label}"` : ''}.
Be warm and community-focused. Include real details from the brief. Invite people to attend/act.
At most 2–3 hashtags at the end.
Output ONLY the post body.`,
      }

    case 'linkedin':
      return {
        system: `You are writing a LinkedIn post for ${wsName}.
${VOICE_RULE}
PLAIN TEXT ONLY: no markdown, no asterisks.`,
        user: `Write a LinkedIn post (~200 words) based on this brief.
${ctx}

Professional but human — this is an announcement, not a press release. Include the CTA${brief.cta_url ? ` (${brief.cta_url})` : ''} naturally.
At most 2–3 hashtags.
Output ONLY the post body.`,
      }

    case 'gbp':
      return {
        system: `You are writing a Google Business Profile post for ${wsName}.
${VOICE_RULE}`,
        user: `Write a Google Business Profile post (150–300 characters) based on this brief.
${ctx}

Short, factual, action-oriented. Include the key details (date, location, CTA) that searchers need. No hashtags.
Output ONLY the post text.`,
      }

    case 'twitter':
      return {
        system: `You are writing an X / Twitter post for ${wsName}.
${VOICE_RULE}`,
        user: `Write a tweet (max 280 characters including the URL) based on this brief.
${ctx}

Punchy and direct. Include the CTA URL${brief.cta_url ? ` (${brief.cta_url})` : ''} if it fits.
At most 1–2 hashtags.
Output ONLY the tweet text.`,
      }

    case 'threads':
      return {
        system: `You are writing a Threads post for ${wsName}.
${VOICE_RULE}`,
        user: `Write a Threads post (max 500 characters) based on this brief.
${ctx}

Conversational, community-forward. No link in body (Threads doesn't render links well). End with an open question or invitation.
Output ONLY the post body.`,
      }

    default:
      return null
  }
}

// Parse the overlay text and link sticker label from an instagram_story generation.
// Returns { overlayText, linkStickerText } or best-effort values.
export function parseStoryOutput(raw) {
  const lines = raw.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  const stickerIdx = lines.findIndex((l) => l.startsWith('LINK_STICKER_TEXT:'))
  const overlayText = stickerIdx > 0
    ? lines.slice(0, stickerIdx).join(' ')
    : lines[0] || raw.trim()
  const linkStickerText = stickerIdx >= 0
    ? lines[stickerIdx].replace(/^LINK_STICKER_TEXT:\s*/i, '').trim()
    : 'Learn more'
  return { overlayText, linkStickerText }
}

// Build a pre-populated text_card state for an instagram_story with no media.
// Matches the TextPostStudio state shape (src/lib/textCard.js).
export function buildStoryTextCard(brief, overlayText, linkStickerText) {
  const d = fmtDate(brief.event_at)
  const t = fmtTime(brief.event_at)
  const subtext = d ? `${d}${t ? ` · ${t}` : ''}${brief.location ? ` · ${brief.location}` : ''}` : (brief.location || null)
  return {
    layout:     'announce',
    background: { preset: 'brand' },
    headline:   overlayText,
    subtext:    subtext || '',
    cta:        linkStickerText || brief.cta_label || 'Learn more',
    size:       'lg',
    position:   'center',
    showName:   false,
  }
}
