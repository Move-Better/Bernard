# Post editor audit, 2026-11-10

Follow-on to `.claude/simplicity-audit-2026-11-09.md`, which counted the post editor (`/publish/:id`, the third most used screen) but never walked it.

## The short version

One address opens five different screens, picked by the post's platform, format and attached media (`src/pages/StoryboardPublish.jsx`, `src/lib/editorArchetype.js`). Two of the five carry almost all the real work. One has not been reached by a real post since July, and four of the post types the shared editor is built for have never been created.

The five screens disagree on small things a person sees on every post: what the approve button says, how many voice scores there are, what the caption tool is called, and how you get back. None of this blocks approvals. It makes the busiest screen feel like four products.

## How this was measured

- Database: every Move Better post created in the last 90 days, grouped the way the router groups them (platform, format, whether a video is attached, whether any media is attached, whether it is scheduled or published).
- Walked in Q's Chrome, read-only: a LinkedIn video post (video editor), a blog draft (shared editor) and a published blog (receipt). Their `updated_at` was unchanged afterwards.
- Not walked: the slide editor. All 40 open drafts that would route there have no media yet, and the slide editor attaches photos the moment it opens one, so opening it is a write. Read from code instead.
- Not measured: views per editor. The PostHog key sits in the 1Password mount, which served nothing during this audit (the app was waiting to restart after an update).

## Which screen each post reaches (90 days, Move Better)

| Screen | When it opens | Posts | Of which locked |
|---|---|---|---|
| Slide editor | Instagram photo/carousel, photo or no-media posts on Facebook, LinkedIn, GBP | 70 | 22 |
| Video editor | Any post with an attached video: Reels, and video posts on LinkedIn, GBP, Facebook | 54 | 3 |
| Shared editor | Blog (and in principle email, ads, landing pages, and video posts with no clip yet) | 6 | 1 |
| Video Story composer | Instagram Story with a video | 0 | 0 |
| Receipt | Anything scheduled or published, whatever its type | 26 | n/a |

## Finding 1. Two of the four editors do the work

The slide editor and the video editor take 124 of the 130 posts. The shared editor takes 6, all blogs.

The video Story composer has no post in 90 days. Only 6 Instagram Stories exist in total, the newest from 1 July. Email, Google Ads, Meta/Instagram ads, landing pages, TikTok and YouTube have never been created at all, so those branches of the shared editor (the email canvas, the text-ad canvas, ad variants) have never been used.

## Finding 2. The approve button changes from screen to screen

- Video editor: "Approve", "Reject", and a separate "Save video" button beside an "All changes saved" note. Two save ideas on one bar.
- Blog: "Approve — sounds like me", "Reject", "Publish to website".
- Slide editor: approve and publish sit inline, but the schedule controls, export and metrics sit behind an unlabelled sliders icon ("Full publish panel").
- All of them show a disabled "Approve first" schedule button until you approve.

## Finding 3. Three voice scores on one blog

The blog editor shows "Sounds like you 72" in the top bar, then "97% in clinician's voice" and "27 verbatim phrases preserved" in the side panel. Three numbers that look like they measure the same thing and do not agree. The video post shows only the first ("Sounds like you 78").

## Finding 4. The same tool has different names

- The caption is "Words" in the slide editor and the blog editor, and "Caption" in the video editor.
- The video editor's rail has nine tabs: Caption, Clips, Clip, Media, Grade, Karaoke, Music, Script, Text. "Clips" and "Clip" sit next to each other. "Text" is a tab, a "+ Text" button above the timeline, and a "+ Text" track.
- `editorArchetype.js` declares the video rail as words, media, grade. The real video editor ignores that list, so the config reads like it controls something it does not.

## Finding 5. Two different titles for one post

The blog draft's top bar says "The Repetition Problem: Wh…"; the article under it is headed "Repetitive Pain: Why One Motion Didn't Hurt You, But a Thousand Did". The published blog's receipt says "When should I stop training if I am injured" above an article titled "When to Stop Training If You're Injured: Red Flags, Yellow Flags, and Ramping Back In". The top bar shows the source story's title, not the post's.

## Finding 6. Getting back works three ways

The editors use a back arrow. The receipt uses a "Back to Publish" text link, and is a normal padded page rather than full-screen like the editors, so opening a published post looks like leaving the editor. "Next up" (jump to the next draft that needs media) appears on the receipt and in the slide editor's publish panel, not in the video or blog editor.

## Finding 7. Video posts on LinkedIn, GBP and Facebook open the full Reel editor

36 of the 54 video-editor posts are not Reels: they are LinkedIn, GBP and Facebook posts carrying a video. They get the same nine-tab editor and the Vertical 9:16 / Portrait 4:5 / Landscape 4:3 choice as a Reel. That may be right; it is worth knowing that most "video editor" traffic is not Instagram.

## Small things

- Blog header reads "Blog · 0 media" and then "no media" beside it.
- 26 Instagram drafts stored as format "post" with no media open in the carousel editor; whether the header names them post or carousel was not checked live.

## Recommended order

| Option | Description | Est. Days | Est. Claude Cost |
|---|---|---|---|
| A. One approve bar | Same buttons, same words, same place in every editor: Approve, Reject, Schedule. Drop "Save video" in favour of the autosave note, or say what it does. Mockup first | 0.5 to 1 | USD 4 to 8 (Sonnet) |
| B. One voice number | Keep "Sounds like you"; move the other two into its popover. Mockup first | 0.5 | USD 2 to 4 (Sonnet) |
| C. Show the post's own title | Top bar and receipt use the post's headline, falling back to the story title | 0.25 | USD 1 to 3 (Sonnet) |
| D. Rename for consistency | Caption vs Words picked once; Clips/Clip renamed; one "Text" entry point. Rename table for sign-off | 0.5 | USD 2 to 5 (Sonnet) |
| E. Receipt matches the editors | Full-screen, back arrow, same header as the editor it replaces | 0.5 | USD 3 to 6 (Sonnet) |
| F. Remove unused branches | Video Story composer, and the email / ad / text-ad paths of the shared editor, behind a decision that nobody is about to use them | 1 | USD 4 to 8 (Sonnet) |

Recommendation: A and C first. They sit on the approve path every post goes through and are cheap. Then B and D together as one copy pass. E is tidiness. F needs Q's ruling, because those post types may be planned.

The case against: none of this changes how many posts get approved. The audit before this one found the approval queue has one approver; the editor is where that person spends their time, so small friction repeats, but it is not the bottleneck.

## Not covered

Views per editor (PostHog, pending the 1Password restart). The slide editor walked live. Phone width. What the shared editor shows for a video post with no clip yet.
