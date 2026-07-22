// Per-atom system prompt builder. Each atom is a single focused piece of
// content — one platform, one angle, generated from the full interview
// transcript with the approved blog post passed in as editorial context.
// Returns null for unknown platform/angle combos so callers can bail early.
//
// Voice-fidelity note (PR for atoms-from-transcript): atoms used to be
// generated from the blog post alone, which guaranteed near-zero provenance
// overlap with the source transcript and produced two layers of LLM-driven
// voice loss (transcript → blog → atom). Atoms now receive the conversation
// as their primary source and the blog as a thematic guidepost. Each channel
// can quote different moments from the same interview rather than compressing
// the same blog summary five different ways.

import { lengthLine, leanOf } from './socialLengthTargets.js'

function buildVoicePhrasesBlock(phrases) {
  const list = Array.isArray(phrases) ? phrases : []
  if (!list.length) return ''
  const examples = list.slice(0, 8).map((p) => `  • ${p.phrase || ''}`).filter((l) => l.trim() !== '•').join('\n')
  if (!examples) return ''
  return `\n\nVOICE PHRASE ANCHORS — sentences this clinician has shipped in approved content. When a similar idea arises, prefer phrasing in this register rather than rewriting it in a generic clinical voice. These are examples, NOT required quotations — only echo when the meaning genuinely aligns:\n${examples}\n`
}

// The auto-extracted brand book (workspaces.brand_guidelines) mixes useful
// guardrails (KEY MESSAGES, AVOID) with two kinds of noise that actively hurt a
// TEXT prompt: (1) visual-only lines (BRAND COLORS / fonts) the model can echo as
// literal hex into copy, and (2) generic marketing-adjective voice lines
// ("BRAND VOICE: Bold, authoritative…", "TONE: confident expertise… celebratory
// energy") that are a worse, flatter version of the real workspaces.brand_voice
// narrative and pull output toward exactly the AI-marketing register we're trying
// to escape. Strip both line classes so the brand book contributes guardrails,
// not tone — the brand_voice narrative is the tone authority. Line-prefix match
// only, so free-form brand text is left untouched.
function stripBrandBookNoise(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !/^\s*(BRAND VOICE|TONE|BRAND COLORS?|HEADING FONT|BODY FONT|FONTS?)\s*[:-]/i.test(line))
    .join('\n')
    .trim()
}

// `campaignContext` — output of getTentpolePromptContext(campaign, ws) from
// api/_lib/tentpoleCampaignContext.js. Empty string when no campaign is
// active or when the active campaign's content_style is 'clinical'. When
// present, it overrides the default CTA framing in each per-platform
// instruction. Blog posts intentionally do NOT consume this — blogs are
// evergreen and outlast any single campaign window.
//
// Voice-fidelity rewrite (2026-05-28): the `tone`, `audienceLabel`, and
// `storyTypeLabel` parameters were producing voice drift. They're accepted
// but ignored. The CORE of every atom is a single point — a claim plus the
// why behind it, in the clinician's voice. The SURFACE (hook, intro, CTA,
// formatting) flexes per platform. The per-platform `instructions` block
// below IS the surface; voice fidelity is enforced by the preamble + voice
// phrase anchors. See .claude/design-interview-output-voice-fidelity.md.
// hasPublishedArticle — is THIS interview's blog piece actually live
// (content_items: platform='blog', status='published', resolved_url set)?
// The Instagram/TikTok "link in bio" CTA is a fabricated claim otherwise —
// there was never a bio-link mechanism in Bernard for it to point at. Callers
// resolve this via hasPublishedBlogArticle() in blogLinkStatus.js and pass it
// straight through; default false so an unverified caller never emits a claim
// that can't be substantiated.
// siblingBlock — excerpts of captions already drafted from THIS SAME interview,
// so the piece steers to an unused moment. One interview fans out into ~11 atoms
// that each used to be generated in isolation against one transcript, which made
// them converge on its single most vivid story. Built by resolveSiblingCaptionsBlock
// in producer/draftAtom.js; '' when this is the interview's first atom.
export function getAtomSystemPrompt(workspace, staffName, condition, platform, angle, voiceMode = 'practice', tone = 'smart', voiceNotes = '', brandGuidelines = '', voicePhrases = [], audienceLabel = null, storyTypeLabel = null, campaignContext = '', ownHistoryBlock = '', hasPublishedArticle = false, siblingBlock = '') {
  void tone; void audienceLabel; void storyTypeLabel
  const firstName = staffName.split(' ')[0]
  const isPersonal = voiceMode === 'personal'
  const lean = leanOf(workspace)

  // workspace.website is sometimes absent (e.g. a caller selecting a narrower
  // workspace row) — guard every interpolation so a missing site degrades to
  // "omit the URL" instead of leaking the literal string "undefined" into the
  // prompt, which the model then echoes verbatim into the caption.
  const website = workspace.website || ''

  // The "link in bio" landing page (see LinkPage.jsx / api/link-page.js)
  // always lists the workspace's live booking link when workspace.website is
  // set, so the BOOKING flavor of "link in bio" is true whenever a website
  // exists. The ARTICLE flavor is only true when this specific interview's
  // blog post is actually published — gated on hasPublishedArticle, never
  // assumed. Both fall back to a CTA that makes no link claim at all.
  const bioLinkForBooking = Boolean(website)
  const articleCtaLine = hasPublishedArticle
    ? 'Close with: "Full article at the link in bio 👆"'
    : 'Close with a scroll-stopping callback to the hook — no link claim (e.g. "Save this for later" or "Follow for more like this").'
  const quickWinCtaLine = hasPublishedArticle
    ? 'Close with: "More in the full article — link in bio 👆"'
    : 'Close with an encouragement to try it, no link claim (e.g. "Give it a try and let us know how it goes").'
  const clinicalInsightCtaLine = hasPublishedArticle
    ? 'Close with: "Full breakdown at the link in bio 👆"'
    : 'Close with a follow-for-more callback, no link claim (e.g. "Follow for more insights like this").'
  const bookingCtaLine = bioLinkForBooking
    ? 'End with: "Book your assessment — link in bio 👆"'
    : 'End with a booking invitation that does NOT claim a link (e.g. "DM us to book your assessment").'
  const tiktokMythBusterCloseLine = bioLinkForBooking
    ? `"If you're dealing with ${condition} in ${workspace.location_keyword ?? 'your area'}, follow for more — link in bio to book at ${workspace.display_name}."`
    : `"If you're dealing with ${condition} in ${workspace.location_keyword ?? 'your area'}, follow for more from ${workspace.display_name}."`
  const tiktokProcessCloseLine = bioLinkForBooking
    ? '"Book your first assessment — link in bio."'
    : '"Reach out to book your first assessment."'
  const linkedinUrlLine = website ? `Include URL ${website} at end. No hashtags.` : 'No hashtags. Do not include a URL.'
  const facebookUrlLine = website ? `Include the full URL ${website} on its own line near the end.` : 'Do not include a URL.'

  // Appended to every Instagram prompt. Instructs the AI to plan a multi-slide
  // carousel with per-slide text blocks. draft.js parses this JSON block as
  // the canonical source for content_items.slides.
  const instagramOverlayInstructions = `

After the caption and hashtags, add this separator on its own line:
---SLIDES---
Then output a valid JSON array (no prose, no markdown fences) with 3–5 slide objects describing the carousel plan. Each slide has a "template" (cover, explainer, demonstration, quote, or cta) and a "blocks" array of on-photo text blocks. Each block has a "role" (hook, body, caption, cta, attribution, or page), a "text" string, and optionally a "position" (top, top-left, top-right, center, center-left, center-right, bottom, bottom-left, bottom-right).

Template guidance:
- cover (slide 1): one hook block, optional page-number. Hook = scroll-stopping statement, 5–7 words, ALL CAPS.
- explainer (slides 2–N): hook + body (+ optional caption). Body = 1–2 sentences explaining the idea.
- demonstration: no text — the photo carries the slide.
- quote: a body block (the actual quote, italic) + an attribution block.
- cta (final slide): hook + body + cta. CTA = 3–5 word action phrase like "Book Your Free Assessment".

Aim for 3–5 slides total. The last slide should usually be a "cta" template. Don't repeat the same text across slides. Each slide's blocks should cohere with the slide's template defaults but you can omit/add blocks if it serves the story.

Example shape (do NOT copy verbatim — write fresh text per the caption):
[
  { "template": "cover",     "blocks": [{ "role": "hook", "text": "YOUR PIRIFORMIS MIGHT NOT BE TIGHT", "position": "center" }] },
  { "template": "explainer", "blocks": [{ "role": "hook", "text": "MRI SAYS HERNIATED", "position": "top" }, { "role": "body", "text": "But the structure isn't the problem — the pattern that stressed it is.", "position": "center" }] },
  { "template": "cta",       "blocks": [{ "role": "hook", "text": "READY TO MOVE PAST THE MRI?", "position": "top" }, { "role": "body", "text": "Book a free movement assessment.", "position": "center" }, { "role": "cta", "text": "Reserve Your Free Seat", "position": "bottom" }] }
]`

  const instructions = {
    instagram: {
      hook: `Write a single Instagram caption for ${workspace.display_name} about ${condition}.
${lengthLine('instagram', 'hook', lean)}
ANGLE: Open with the most scroll-stopping moment from the conversation — a myth-buster, bold claim, or surprising fact ${firstName ? `${firstName} actually said` : 'the clinician actually said'}. Make it impossible to scroll past.
${isPersonal ? `Write in ${firstName}'s first-person voice.` : `Use "we" and "our team" language.`}
${articleCtaLine}
Add a blank line, then 3–5 hashtags: condition-specific, movement, ${workspace.location_hashtag ?? '#physicaltherapy'}, ${workspace.brand_hashtag ?? ''}.
Do NOT include any URLs in the caption body.${instagramOverlayInstructions}`,

      quick_win: `Write a single Instagram caption for ${workspace.display_name} about ${condition}.
${lengthLine('instagram', 'quick_win', lean)}
ANGLE: Lead with one actionable tip or self-test the viewer can try right now at home — something concrete that ${firstName ? `${firstName} mentioned` : 'the clinician mentioned'} in the conversation. Make it genuinely useful on its own. Do NOT reference any specific patient, case, or individual's story — keep it general and educational (no PHI).
${isPersonal ? `Write in ${firstName}'s first-person voice.` : `Use "we" and "our team" language.`}
${quickWinCtaLine}
Add a blank line, then 3–5 hashtags: condition-specific, movement, ${workspace.location_hashtag ?? '#physicaltherapy'}, ${workspace.brand_hashtag ?? ''}.
Do NOT include any URLs in the caption body.${instagramOverlayInstructions}`,

      clinical_insight: `Write a single Instagram caption for ${workspace.display_name} about ${condition}.
${lengthLine('instagram', 'clinical_insight', lean)}
ANGLE: Open with the sharpest, most counterintuitive thing ${firstName ? firstName : 'the clinician'} actually said about ${condition} — the misconception they push back on — in their own framing. Do NOT use a templated "the one thing most people get wrong about…" opener; pull the real line from the conversation. Then deliver the key clinical insight ${firstName ? `${firstName} surfaced` : 'the clinician surfaced'} in the conversation.
${isPersonal ? `Write in ${firstName}'s first-person voice.` : `Use "we" and "our team" language.`}
${clinicalInsightCtaLine}
Add a blank line, then 3–5 hashtags: condition-specific, movement, ${workspace.location_hashtag ?? '#physicaltherapy'}, ${workspace.brand_hashtag ?? ''}.
Do NOT include any URLs in the caption body.${instagramOverlayInstructions}`,

      cta: `Write a single Instagram caption for ${workspace.display_name} about ${condition}.
${lengthLine('instagram', 'cta', lean)}
ANGLE: Direct invitation to book. Lead with a one-line hook that mirrors back the specific pattern or experience of someone dealing with ${condition} — not a generic "Are you suffering from pain?" opener. Briefly describe what the assessment at ${workspace.display_name} actually involves (movement screen, not just "a consult"). Make the ask feel like the natural next step after the insight you led with.
${isPersonal ? `Write in ${firstName}'s first-person voice.` : `Use "we" and "our team" language.`}
${bookingCtaLine}
Add a blank line, then 3–5 targeted local hashtags: ${workspace.location_hashtag ?? '#physicaltherapy'}, ${workspace.brand_hashtag ?? ''}, plus condition tags.
Do NOT include any URLs in the caption body.${instagramOverlayInstructions}`,
    },

    linkedin: {
      clinical_perspective: `Write a LinkedIn post for ${workspace.display_name} about ${condition}.
${lengthLine('linkedin', 'clinical_perspective', lean)}
ANGLE: Lead with what this clinic approaches differently about ${condition} — framed for clinicians, coaches, and referring providers.
${isPersonal
  ? `Write in ${firstName}'s first-person professional voice — this is my clinical perspective.`
  : `Frame as ${workspace.display_name}'s team perspective — "we" and "our team". Open directly on the specific clinical position this piece argues, in the language it was actually described with. The first line must be one that could ONLY belong to this conversation: no clinic-name preamble, and no stock announcement that we do things differently before any substance has landed.`}
Close by inviting colleagues into the conversation. Write that invitation fresh every time, in wording tied to what THIS post argued — never a stock sign-off.
${linkedinUrlLine}`,

      referring_provider: `Write a LinkedIn post for ${workspace.display_name} about ${condition}.
${lengthLine('linkedin', 'referring_provider', lean)}
ANGLE: Written specifically for referring providers — what should a GP, orthopedic surgeon, or sports medicine doc know before referring a ${condition} patient?
${isPersonal
  ? `Write in ${firstName}'s first-person professional voice.`
  : `Frame from ${workspace.display_name}'s clinical team perspective.`}
Close by opening the door to referring providers with questions or complex cases. Phrase it fresh every time, tied to the specifics of this post — never a stock sign-off.
${linkedinUrlLine}`,

      movement_principle: `Write a LinkedIn post for ${workspace.display_name} about ${condition}.
${lengthLine('linkedin', 'movement_principle', lean)}
ANGLE: Zoom out to the underlying movement principle or clinical reasoning that guides treatment. Educational for clinicians who don't specialize in this area.
${isPersonal
  ? `Write in ${firstName}'s first-person professional voice.`
  : `Frame from ${workspace.display_name}'s clinical team perspective.`}
${linkedinUrlLine}`,
    },

    facebook: {
      community: `Write a Facebook post for ${workspace.display_name} about ${condition}.
${lengthLine('facebook', 'community', lean)}
ANGLE: Community-first. Lead with the local angle — people in ${workspace.location_keyword ?? 'your area'} dealing with ${condition}. Neighbor-to-neighbor tone, not clinic broadcasting.
${isPersonal
  ? `Write in ${firstName}'s first-person voice — a clinician who cares about the local community.`
  : `Write as ${workspace.display_name} the clinic.`}
${facebookUrlLine}
End with a question that sparks comments. 1–2 hashtags max.`,

      educational: `Write a Facebook post for ${workspace.display_name} about ${condition}.
${lengthLine('facebook', 'educational', lean)}
ANGLE: Educational myth-buster. One surprising or commonly misunderstood fact about ${condition} that ${firstName ? firstName : 'the clinician'} raised, explained simply — lead with the fact itself, not a "did you know" wind-up.
${isPersonal
  ? `Write in ${firstName}'s first-person voice.`
  : `Write as ${workspace.display_name} the clinic.`}
${facebookUrlLine}
End with a question that invites comments. 1–2 hashtags max.`,
    },

    gbp: {
      local_authority: `Write a Google Business Profile post about ${condition} for ${workspace.display_name} in ${workspace.location_keyword ?? 'your area'}.
${lengthLine('gbp', 'local_authority', lean)}
ANGLE: Establish local authority.
VOICE FIRST: Open with 1–2 sentences that use the clinician's distinctive diagnostic framing from the VOICE PHRASE ANCHORS above — their specific clinical insight or "how" explanation about ${condition}. Do NOT open with a generic "At [clinic] we treat..." line.
Then connect that insight to the local context: what ${workspace.display_name} does differently for ${condition} patients in ${workspace.location_keyword ?? 'your area'}.
Use "we" and "our team" throughout.
Close with 1–2 sentences that echo the specific insight above before the booking ask — not a bare "book now." E.g. "If that pattern sounds familiar, a movement screen at ${workspace.display_name} is how we start untangling it: ${website || 'book online'}"
If the clinician described a specific patient or example in the conversation, USE it — a real, specific story is vivid and welcome here. Only avoid INVENTING a new patient, name, age, or recovery timeline that wasn't actually described.
No hashtags. Conversational, not salesy.`,

      patient_outcome: `Write a Google Business Profile post about ${condition} for ${workspace.display_name} in ${workspace.location_keyword ?? 'your area'}.
${lengthLine('gbp', 'patient_outcome', lean)}
ANGLE: Results framing.
VOICE FIRST: Open with 1–2 sentences in the clinician's authentic voice — pull a specific clinical mechanism or patient insight from the VOICE PHRASE ANCHORS above rather than leading with a generic outcomes statement.
Then pivot to results: what does recovery from ${condition} actually look like at ${workspace.display_name}? If the clinician described a specific patient outcome in the conversation, use it — a real, specific result lands harder than a generic one. Otherwise describe a realistic general outcome ("patients typically find…" or "the goal is…"). Either way, do NOT invent a patient, name, or timeline that wasn't in the conversation.
Use "we" and "our team" throughout.
Close with 1–2 sentences that connect the outcome above to the next step — not a bare "book now." E.g. "If you're ready to find out what recovery actually looks like for your situation: ${website || 'book online'}"
No hashtags. Conversational, results-focused.`,
    },

    tiktok: {
      myth_buster: `Write a 45–60 second TikTok / Instagram Reels script for ${workspace.display_name} about ${condition}.
${lengthLine('tiktok', 'myth_buster', lean)}
ANGLE: Lead with the most counterintuitive claim from the conversation. First 3 seconds must stop the scroll.

[HOOK — first 3 seconds]
One punchy sentence built from a real claim ${firstName ? firstName : 'the clinician'} actually made in the conversation — tension or a myth in their own words. Don't reach for a templated "everything you've been told about ${condition}" formula; pull the actual counterintuitive line from the transcript.

[BODY — 30–40 seconds]
3–4 short punchy points. 1–2 sentences each. Plain language. Add [ON SCREEN TEXT: ...] for text overlays.

[CLOSE — 10 seconds]
${tiktokMythBusterCloseLine}

CAPTION:
50–80 word TikTok caption with 5–6 hashtags. Brand as ${workspace.display_name}.`,

      process: `Write a 45–60 second TikTok / Instagram Reels script for ${workspace.display_name} about ${condition}.
${lengthLine('tiktok', 'process', lean)}
ANGLE: Show what the recovery process actually looks like step by step. Demystify the treatment.

[HOOK — first 3 seconds]
One punchy sentence that promises a clear answer. Example: "Here's what actually happens when you come in for ${condition} at ${workspace.display_name}."

[BODY — 30–40 seconds]
Walk through: assessment → first session → what improves first → full recovery. Short steps. Add [ON SCREEN TEXT: ...] for key steps.

[CLOSE — 10 seconds]
${tiktokProcessCloseLine}

CAPTION:
50–80 word TikTok caption with 5–6 hashtags. Brand as ${workspace.display_name}.`,
    },

    twitter: {
      hook: `Write a single tweet (X post) for ${workspace.display_name} about ${condition}.
${lengthLine('twitter', 'hook', lean)}
ANGLE: Pull the sharpest claim, myth-buster, or counterintuitive insight from the conversation. Make it quotable — the kind of line someone screenshots or quote-tweets.
${isPersonal ? `Write in ${firstName}'s first-person voice — punchy and direct.` : `Use plural "we"/"our team" but keep it punchy, not corporate.`}
No threading. No "1/" prefix. No emoji unless the conversation's tone is unmistakably casual.
At most 1–2 hashtags. Prefer NO link unless the punchline only lands with one — Twitter throttles posts with links.
Output ONLY the tweet body. Do not include "TWEET:" or any label.`,
    },

    threads: {
      community_take: `Write a single Threads post for ${workspace.display_name} about ${condition}.
${lengthLine('threads', 'community_take', lean)}
ANGLE: Conversational, opinion-forward. Open with a stance or observation that invites disagreement or "same here" replies — Threads rewards posts that spark replies, not broadcasts.
${isPersonal ? `Write in ${firstName}'s first-person voice — like you're posting from your phone, not a brand account.` : `Write as the clinic team but in a personal, conversational register — first names and "we" rather than third-person clinic-speak.`}
End with an open question or invitation to share experiences. No corporate hashtag stacks — at most 1–2 lowercase hashtags if they feel natural.
Do NOT include a URL — Threads users rarely click out; the goal is engagement.
Output ONLY the post body.`,
    },

    bluesky: {
      clinical_share: `Write a single Bluesky post for ${workspace.display_name} about ${condition}.
${lengthLine('bluesky', 'clinical_share', lean)}
ANGLE: Considered clinician-to-clinician share — assume the reader is another health professional, athlete, or unusually informed patient. The Bluesky audience skews technical and rewards specificity over hype.
${isPersonal ? `Write in ${firstName}'s first-person professional voice — like sharing a clinical observation with peers.` : `Write as the clinical team. Specific, not promotional.`}
NO hashtags (Bluesky culture doesn't use them).
NO link unless it's genuinely the post's purpose — and if so, put it on its own line at the end.
Lean slightly more clinical/precise than the source — this audience can handle technical specificity.
Output ONLY the post body.`,
    },

    mastodon: {
      educational: `Write a single Mastodon post (toot) for ${workspace.display_name} about ${condition}.
${lengthLine('mastodon', 'educational', lean)}
ANGLE: Plain-language educational, federated-community-conscious. The Mastodon audience values: clear writing, inclusive language, accessibility, and content warnings on potentially-distressing health topics.
${isPersonal ? `Write in ${firstName}'s first-person voice — like a clinician posting on their personal account.` : `Write as the clinic team in a community register, not a marketing register.`}
If ${condition} touches injury, pain, weight, eating, or mental health, prefix the post with a content warning line: \`CW: <one-phrase topic>\` on its own line, then a blank line, then the body.
Include alt-text guidance if a visual would normally accompany the post: add \`[image alt: ...]\` placeholder at the end.
At most 2–3 hashtags, written in CamelCase for screen-reader accessibility (e.g. #PhysicalTherapy not #physicaltherapy).
Output ONLY the post body (with the CW prefix and alt-text placeholder if applicable).`,
    },

    instagram_story: {
      story_teaser: `Write overlay text for a single Instagram Story frame for ${workspace.display_name} about ${condition}.
FORMAT: 5–8 words maximum. ALL CAPS. This text appears printed over a photo or branded card — it must grab attention in under a second and make someone tap the link sticker.
ANGLE: Distill the sharpest, most surprising claim or patient outcome from the conversation into one punchy line. Think billboard, not caption. No filler words ("here's why", "we share", "check out").
${isPersonal ? `Echo ${firstName}'s voice — a line they'd actually say out loud.` : `Use "we" language, but keep it punchy.`}
After the overlay text, on a new line output the label LINK_STICKER_TEXT: followed by 2–4 words for the sticker label (e.g. "Read more", "Book a visit", "Full story"). Keep it action-oriented.
Output ONLY the overlay text line, then the LINK_STICKER_TEXT line. No other text.`,
    },
  }

  const instruction = instructions[platform]?.[angle]
  if (!instruction) return null

  const voiceNotesTrimmed = (voiceNotes || '').trim()
  const voiceBlock = voiceNotesTrimmed
    ? `\n\nCLINICIAN VOICE PATTERNS — apply these consistently. They were learned from how this clinician edits drafts, so respecting them up-front saves a round of revisions:\n${voiceNotesTrimmed}\n`
    : ''

  // The practice's real voice narrative (workspaces.brand_voice) is the AUTHORITY
  // on register/tone — how this practice actually talks. Injected prominently so it
  // outweighs the generic brand-book adjectives and steers away from AI-marketing
  // voice. This was previously used only on blog/newsletter output, never on atoms.
  const brandVoiceNarrative = String(workspace.brand_voice || '').trim()
  const brandVoiceBlock = brandVoiceNarrative
    ? `\n\nHOW ${(workspace.display_name || 'THIS PRACTICE').toUpperCase()} ACTUALLY TALKS — write in THIS voice. It is the authority on tone, register, and instinct; match it. Everything below is subordinate to it:\n${brandVoiceNarrative.slice(0, 1400)}\n`
    : ''

  // Brand book contributes GUARDRAILS only (key messages + things to avoid) — the
  // generic voice/tone adjective lines and visual color/font lines are stripped so
  // they can't flatten the voice above. See stripBrandBookNoise.
  const brandGuidelinesTrimmed = stripBrandBookNoise(brandGuidelines)
  const brandBlock = brandGuidelinesTrimmed
    ? `\n\nBRAND GUARDRAILS — key messages and things to avoid, from ${workspace.display_name}'s brand book. These constrain WHAT you say; the voice above governs HOW you say it:\n${brandGuidelinesTrimmed}\n`
    : ''

  const voicePhrasesBlockStr = buildVoicePhrasesBlock(voicePhrases)

  return `You are turning a real conversation with ${staffName || 'the clinician'} about ${condition} into one ${platform} atom for ${workspace.display_name}.

CORE vs SURFACE — the rule:
- The CORE of this atom is a single point: a claim plus the why behind it, in ${staffName || 'the clinician'}'s actual voice. The core sentences must use their phrasing, not a smoother / more generic version.
- The SURFACE (hook, intro line, CTA, formatting, hashtags) flexes per platform. Platform-specific punch is fine and expected. The surface wraps the core; it never replaces it.

VOICE FIDELITY rules for the core:
- Quote ${staffName || 'the clinician'}'s words from the transcript verbatim where the meaning fits. The conversation is the primary source; the editorial summary (approved long-form post on this topic) is only thematic guidance.
- Never paraphrase a sentence ${staffName || 'the clinician'} said into a smoother version. If a sentence is hard to fit, split it at a natural breath point — don't rewrite the words.
- Preserve every strong claim or opinion in its original strength. Don't soften, balance, or hedge.

NO FABRICATION — use only what ${staffName || 'the clinician'} actually said:
- Do NOT invent specifics that aren't in the conversation: no patient histories or timelines ("six years of back pain"), no names, ages, numbers, statistics, outcomes, dates, events, or made-up patient anecdotes or characters. If you don't have a concrete detail, stay general — being less specific is always better than inventing one.
- Do NOT reshape a nuanced observation into a tidy "hero story" or a dramatic before/after that ${staffName || 'the clinician'} did not actually describe.

WRITE LIKE A REAL PERSON, NOT AI MARKETING — avoid the tells that make copy read as machine-generated:
- No formula openers: "The one thing most people get wrong…", "Here's the thing…", "Let's talk about…", "Ever wonder why…", "Did you know…".
- No X-not-Y antithesis slop: "It's not about trying harder, it's about moving smarter", "Not X. Just Y."
- No bolting the practice name onto the insight ("that's what we do at ${workspace.display_name}", "everything we do at…"). The point stands on its own; the practice name belongs only in an actual CTA, if at all.
- No hollow hype words: "game-changer", "unlock", "the secret to", "revolutionary", "transform your…", "level up".
- Let ${firstName || 'the clinician'}'s own way of explaining it carry the piece — their analogies, their asides, their exact words — not a polished content-marketing voice layered on top.

Your job: pick the moment in the conversation that best fits this platform and angle, build the core around that moment in their voice, and wrap it in the platform's surface format per the instructions below. Output ONLY the final content — no section markers, headers, labels, or meta-commentary.

PLAIN TEXT ONLY: Do not use markdown formatting — no *asterisks* for emphasis, no **double asterisks** for bold, no --- horizontal rules, no # headers. Social platforms render these as literal characters.

${instruction}
${brandVoiceBlock}${brandBlock}${voiceBlock}${voicePhrasesBlockStr}${ownHistoryBlock}${campaignContext ? `\n${campaignContext}\n\nThe CAMPAIGN FOCUS directive above OVERRIDES any default "book a visit" / "link in bio" CTAs in the per-platform instructions. Rewrite the CTA portion of this piece to match the campaign — including the exact URL and button phrasing when provided. Keep platform-specific structural rules (character limits, hashtag counts, overlay format) intact.\n\nCRITICAL — the CTA must flow from the content, not be bolted on: the campaign ask has to grow directly out of the specific point this piece just made. Bridge from the body's idea into the campaign in one continuous voice, so the reader feels a natural turn rather than a hard pivot to a sales line. Never drop the CTA in as a disconnected final sentence, and never let it read as a canned insert pasted after the real content — the last thought and the ask should belong to the same breath.\n` : ''}${siblingBlock}`
}
