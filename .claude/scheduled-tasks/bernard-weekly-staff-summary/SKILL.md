# Bernard Weekly Staff Summary Routine

**Objective:** Produce a combined plain-language PDF summary of the past 7 days of Bernard changes, with user-facing changes paired to relevant screenshots, plus a Gmail draft pointing to it.

**Trigger:** Weekly scheduled task (Sunday evening or Monday morning, non-interactive).

**Output:** 
- PDF: `.staff-update-screenshots/bernard-weekly-update-<YYYY-MM-DD>.pdf`
- Gmail draft: to placeholder; body points at the PDF file path with instructions to attach before sending

---

## Pipeline

### 1. Sync Bernard main

```bash
cd "/Users/qbook/Claude Projects/Bernard" && \
  git fetch origin -q && \
  git checkout main -q && \
  git pull --ff-only origin main -q
```

Use only local git tools. Do NOT use GitHub API / `gh` calls.

### 2. Get 7 days of commit history

```bash
git log --since="7 days ago" --pretty=format:"%h%n%s%n%b%n===END===" origin/main
```

Parse subject lines + full commit bodies (PR-squash bodies often contain the real description).

### 3. Filter to user-visible changes

Write one plain-language bullet per item. **Criteria for inclusion:**
- ✅ New feature, UI fix, new capability, workflow improvement, visual refresh
- ✅ Bug fix that users would notice (not internal refactor with no behavior change)
- ❌ Skip: refactors, CI/test changes, dependency bumps, internal audits, security hardening with no UI impact, docs-only, lint/config changes

**Tone:** Warm, plain language. No jargon, no PR numbers, no file paths, no technical terms. Assume staff who use Bernard day-to-day, not engineers.

### 4. Match screenshots to bullets

Check `.staff-update-screenshots/captions.jsonl` (one line per screenshot, JSON):
```json
{"file":"YYYY-MM-DD_PR###_slug.png","date":"YYYY-MM-DD","pr":###,"caption":"one plain-language sentence"}
```

**The PDF-build script keys `screenshot_map` on the literal caption string and looks up
`if bullet_text in screenshot_map`** — an exact match. Since bullets are freshly written
each run (not copy-pasted from `captions.jsonl`), an exact match is the exception, not the
rule. Match with this priority order, and **rewrite the bullet text passed into the PDF
script to equal the winning caption exactly** whenever a match is found (the renderer only
embeds on exact string equality, so the match has to be made real, not just noted):

1. **PR number** — if the bullet was generated from a commit whose PR number appears in
   `captions.jsonl`, that's the match, full stop, regardless of wording.
2. **Date + strong content overlap** — screenshot dated inside the 7-day window AND shares
   several distinctive nouns/verbs with the bullet (e.g. both mention "media usage counter").
3. **Caption content overlap alone** — same idea, no date signal (use sparingly, PDF/screenshot
   dates are the primary anchor).

If a bullet has no matching screenshot, render just the text — don't force a weak match.

### 4b. Screenshot capture — use `scripts/capture-screenshot.mjs`, NOT the Chrome MCP

Screenshots are normally captured at ship time (see CLAUDE.md → "Weekly staff-update
routine — capturing screenshots for the PDF") using **`scripts/capture-screenshot.mjs`**, a
local headless Playwright script that signs in as the `e2e@movebetter.co` fixture user and
writes PNGs directly to disk. This is the only working capture path — the Chrome-MCP +
html2canvas + `~/Downloads` route described in older docs **does not work in the agent
environment**: the MCP tab is permanently `visibilityState: "hidden"`, so every file-out
route (blob-URL download, clipboard, dataURL round-trip, local-server upload) fails silently.
Do not attempt it, live or headless. Full root-cause writeup: CLAUDE.md → "Why the
Chrome-MCP pipeline can't work here."

If this weekly run ever needs to capture a screenshot itself (bullet has no ship-time
screenshot but the UI element still exists), invoke the script directly:

```bash
cd "/Users/qbook/Claude Projects/Bernard" && T=$(mktemp) && cat .env.bernard.1pw > "$T" && \
  export CLERK_SECRET_KEY="$(awk -F= '/^CLERK_SECRET_KEY=/{print substr($0,index($0,"=")+1)}' "$T" | tr -d '\r')" && \
  rm -f "$T" && node scripts/capture-screenshot.mjs \
  --url https://movebetter.withbernard.ai/<page> \
  --selector '<css-or-has-text-selector>' \
  --scale 4 --delay 4000 \
  --out ".staff-update-screenshots/$(date +%F)_PR<NNNN>_<slug>.png"
```

Quality bar (Deep Thought reference PDF): a colored title plus tight, high-resolution crops
of just the one component each bullet is about — never a full page.

Rules:
- **Crop to the relevant element, NOT the whole page.** A full-page screenshot downscaled
  to fit the PDF becomes an unreadable blur — this is the #1 failure mode (hit 2026-07-16).
  Use `--selector` targeted at the specific card / control / row-group; never point it at
  `main` or omit it for a full-viewport shot.
- **Pick `--scale` so the raw crop is ≥ 950px wide** (the PDF's default `MAX_IMAGE_WIDTH`) —
  e.g. `--scale 4` for a ~250px CSS-wide tile. A too-small scale gets upscaled (soft) in the
  PDF. Capturing it right here is always better than patching it later with an
  `IMAGE_OVERRIDES` entry (5.3).
- **Avoid capturing a very wide element with lots of empty space in it.** A full-width strip
  scaled down to fit the page turns its text into an illegible sliver. Crop to the part that
  carries the point.
- **Use `--hide 'sel,sel'`** to remove distracting siblings instead of manual DOM surgery.
- **One representative element per bullet** — the single UI piece that best conveys the
  change.
- Only `CLERK_SECRET_KEY` is required as an env var (the fixture email has a hardcoded
  default). It's a real authenticated session — don't `--click` anything mutating
  (Approve/Publish/Delete/Send).

### 5. Build PDF with Python + Pillow

**Script location:** Inline Python in this routine.

**5.1 — write the bullets to a file, do NOT inline them.** Earlier versions substituted a
`BULLETS_JSON_PLACEHOLDER` into a `json.loads("""...""")` literal. Bullets routinely contain
apostrophes, double quotes and em-dashes, and one stray `"""` or backslash silently corrupts
the whole payload. Write the filtered bullets as a JSON array to `bullets.json` next to the
script instead; the script reads it directly.

**5.2 — the PDF is PAGINATED.** Do not render one tall image and save it as a single page.
At 20+ bullets that produces a ~3,400px-tall page that no one can read at fit-to-width. The
`Pager` class flows content across letter-ratio pages (1200x1553) and never splits a
screenshot across a page break — a block that does not fit starts a new page.

**5.3 — `IMAGE_OVERRIDES` exists because a fixed 950px width ruins two common shapes.**
The stock behavior scales every screenshot to 950px wide, which fails in both directions:

- **An ultra-wide strip becomes an unreadable sliver.** A 2962x86 schedule strip scaled to
  950 wide is 27px tall — the text is gone. Crop the dead space out to a `_crop.png`
  derivative and give it a `width` up to 1120 (page width minus padding).
- **A small native crop gets soft-upscaled.** A 512x512 tile blown up to 950 is visibly
  mushy. Cap its `width` at or near its native size instead.

Add an entry keyed on the filename from `captions.jsonl`; `file` substitutes a different
image, `width` overrides the target width. Both are optional. Prefer re-capturing at a
higher `--scale` (step 4b) when the UI still exists — an override is the fallback for a
screenshot already on disk.

**5.4 — verify the rendered pages, not just that the file exists.** `pdftoppm -png -r 110
-f N -l N <pdf> p` renders page N; read the PNG and confirm the text is legible and every
embedded screenshot is sharp. A PDF that saves successfully can still be unreadable.

```python
#!/usr/bin/env python3
import json
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

try:
    from PIL import JpegImagePlugin
    Image.SAVE['JPEG'] = JpegImagePlugin._save
except (ImportError, KeyError):
    pass

SCREENSHOTS_DIR = Path("/Users/qbook/Claude Projects/Bernard/.staff-update-screenshots")
PDF_FILENAME = f"bernard-weekly-update-{datetime.now().strftime('%Y-%m-%d')}.pdf"
PDF_PATH = SCREENSHOTS_DIR / PDF_FILENAME
CAPTIONS_FILE = SCREENSHOTS_DIR / "captions.jsonl"
BULLETS_FILE = Path(__file__).parent / "bullets.json"   # written in step 5.1

MAX_IMAGE_WIDTH = 950
BORDER_WIDTH = 2
BORDER_COLOR = (200, 200, 200)
PAGE_WIDTH = 1200
PAGE_HEIGHT = 1553          # letter ratio at 1200 wide
PADDING = 40
TEXT_COLOR = (0, 0, 0)
TITLE_COLOR = (40, 40, 40)
RUST = (156, 61, 30)
LINE_HEIGHT = 24
BULLET_MARGIN = 15

bullets = json.loads(BULLETS_FILE.read_text())

screenshot_map = {}
if CAPTIONS_FILE.exists():
    for line in CAPTIONS_FILE.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            screenshot_map[entry.get('caption')] = entry
        except json.JSONDecodeError:
            pass

try:
    title_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 34)
    text_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 15)
    bullet_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 15)
except (IOError, OSError):
    title_font = ImageFont.load_default()
    text_font = ImageFont.load_default()
    bullet_font = ImageFont.load_default()

_measure = ImageDraw.Draw(Image.new('RGB', (1, 1)))

# Per-file render overrides. The stock 950px width either blurs an ultra-wide
# strip into an unreadable sliver or soft-upscales a small native crop, so a few
# screenshots get a substitute file and/or their own target width.
IMAGE_OVERRIDES = {
    # 2962x86 strip with a large dead gap: use the tight crop, render near full width.
    '2026-07-22_PR2257_week-schedule-strip.png': {
        'file': '2026-07-22_PR2257_week-schedule-strip_crop.png',
        'width': 1120,
    },
    # 512x512 native: cap the upscale so it stays crisp.
    '2026-07-22_PR2282_media-usage-counter.png': {'width': 620},
}



def wrap_text(text, font, max_width):
    lines = []
    for para in text.split('\n'):
        if not para.strip():
            lines.append('')
            continue
        words = para.split(' ')
        current = []
        for word in words:
            test = ' '.join(current + [word])
            bbox = _measure.textbbox((0, 0), test, font=font)
            if (bbox[2] - bbox[0]) > max_width and current:
                lines.append(' '.join(current))
                current = [word]
            else:
                current.append(word)
        if current:
            lines.append(' '.join(current))
    return lines


class Pager:
    """Flow layout across fixed-size pages; blocks never split mid-image."""

    def __init__(self):
        self.pages = []
        self._new_page()

    def _new_page(self):
        self.img = Image.new('RGB', (PAGE_WIDTH, PAGE_HEIGHT), color=(255, 255, 255))
        self.draw = ImageDraw.Draw(self.img)
        self.y = PADDING
        self.pages.append(self.img)

    def ensure(self, height):
        if self.y + height > PAGE_HEIGHT - PADDING:
            self._new_page()

    def text(self, x, s, font, fill):
        self.draw.text((x, self.y), s, font=font, fill=fill)

    def hr(self):
        self.draw.line([(PADDING, self.y), (PAGE_WIDTH - PADDING, self.y)],
                       fill=(220, 220, 220), width=1)


def render_pdf(bullets, screenshot_map, output_path):
    p = Pager()

    p.text(PADDING, "Bernard Update", title_font, RUST)
    p.y += 48
    p.text(PADDING, datetime.now().strftime("%B %d, %Y"), text_font, TEXT_COLOR)
    p.y += 34
    p.hr()
    p.y += 22
    p.text(PADDING, "This week in Bernard:", text_font, TITLE_COLOR)
    p.y += 34

    text_width = PAGE_WIDTH - BULLET_MARGIN - PADDING * 2

    for bullet_text in bullets:
        wrapped = wrap_text(f"• {bullet_text}", bullet_font, text_width)
        p.ensure(len(wrapped) * LINE_HEIGHT + PADDING)
        for line in wrapped:
            p.text(PADDING + BULLET_MARGIN, line, bullet_font, TEXT_COLOR)
            p.y += LINE_HEIGHT
        p.y += PADDING

        entry = screenshot_map.get(bullet_text)
        if not entry:
            continue
        override = IMAGE_OVERRIDES.get(entry['file'], {})
        img_path = SCREENSHOTS_DIR / override.get('file', entry['file'])
        if not img_path.exists():
            print(f"Warning: missing screenshot file {img_path}")
            continue
        try:
            ss = Image.open(img_path).convert('RGB')
            w = min(override.get('width', MAX_IMAGE_WIDTH), PAGE_WIDTH - PADDING * 2)
            h = int(w * (ss.height / ss.width))
            max_h = PAGE_HEIGHT - PADDING * 2 - 40
            if h > max_h:                       # very tall crop: scale to fit a page
                h = max_h
                w = int(h * (ss.width / ss.height))
            ss = ss.resize((w, h), Image.Resampling.LANCZOS)
            bordered = Image.new('RGB', (w + BORDER_WIDTH * 2, h + BORDER_WIDTH * 2), BORDER_COLOR)
            bordered.paste(ss, (BORDER_WIDTH, BORDER_WIDTH))

            p.ensure(h + BORDER_WIDTH * 2 + PADDING)
            x = (PAGE_WIDTH - w - BORDER_WIDTH * 2) // 2
            p.img.paste(bordered, (x, p.y))
            p.y += h + BORDER_WIDTH * 2 + PADDING
            print(f"  embedded {entry['file']} ({w}x{h})")
        except Exception as e:
            print(f"Warning: could not load screenshot {img_path}: {e}")

    first, rest = p.pages[0], p.pages[1:]
    first.save(output_path, 'PDF', save_all=True, append_images=rest)
    return output_path, len(p.pages)


out, npages = render_pdf(bullets, screenshot_map, PDF_PATH)
print(f"✓ PDF saved: {out} ({npages} pages, {len(bullets)} bullets)")
```

**Execution:**
1. Write the filtered bullets as a JSON array to `bullets.json` beside the script
2. Run the script
3. Render every page with `pdftoppm` and read them — confirm legibility and sharp images
4. If a screenshot renders badly, add an `IMAGE_OVERRIDES` entry and re-run

**Known workaround:** PIL/Pillow on some systems throws `KeyError: 'JPEG'` on save. The script includes the import guard above.

### 6. Create Gmail draft

Use the **Gmail MCP** `create_draft` tool:
- **to:** `drquasney@gmail.com` (placeholder; user must replace before sending)
- **subject:** `"Bernard Update — " + today's date (MMMM DD, YYYY)`
- **body:**
  ```
  Weekly Bernard update for the team.
  
  See attached: [PDF file path from step 5]
  
  To send: Attach the PDF file, update recipients as needed, and hit Send.
  ```

**Constraint:** `to` is a required field, so set it to the sender's placeholder address with a note in the body to replace it. No programmatic way found yet to attach a file via Gmail MCP (reading the file into context costs ~1000 tokens per KB), so attachment is manual.

---

## Handling edge cases

### No user-visible changes this week
Skip the PDF/screenshot machinery. Create a short Gmail draft instead:

```
Subject: Bernard Update — [date]
Body: No notable changes to Bernard this week — everything's running as usual.
```

### Screenshots exist but PDF build fails
Log the Python error. Fall back to text-only PDF (no images, just the bullets). Note in the completion report that image rendering failed.

### Gmail MCP unavailable
Log the error. Print the bullet list + PDF path to the completion report. Note that manual draft creation is needed.

### Staff email addresses
Bernard staff are currently auth-managed (Clerk org membership) with no direct app DB email surface. The placeholder recipient in the Gmail draft is appropriate; leave it as-is and document that team distribution is a manual send step before completion.

---

## Verification checklist (every run)

Before considering this routine "complete," verify:
1. ✅ Every page renders and is readable — `pdftoppm -png -r 110 -f N -l N <pdf> p`, then
   read each PNG. "The file saved without error" is not verification.
2. ✅ A Gmail draft appears in the drafts folder with the expected subject + body
3. ✅ The draft points to the correct PDF file path
4. ✅ Screenshots (if any matched) appear embedded in the PDF, and each one is legible at
   its rendered size — check the wide strips and the small native crops specifically
   (see 5.3 `IMAGE_OVERRIDES`)

If the Gmail tool gets blocked by the safety classifier in a headless run, the routine will note that in the completion report and the draft creation will be a manual step.

---

## Files & Conventions

**Local storage:**
- Repo: `.staff-update-screenshots/` (gitignored)
- Pattern: `YYYY-MM-DD_PR###_short-slug.png`
- Index: `captions.jsonl` (one JSON line per screenshot)

**PDF output:**
- `bernard-weekly-update-<YYYY-MM-DD>.pdf`
- Placed in `.staff-update-screenshots/`

**Gmail draft:**
- Subject: `Bernard Update — [Month Day, Year]`
- Recipient: Placeholder (drquasney@gmail.com initially; user updates before send)
- Attachment: Manual (PDF file path noted in body)

---

## Notes

- This routine is read-only against the repo (git fetch/pull only; no commits/pushes).
- Screenshot captions are expected to be updated manually as UI changes ship (documented separately in Bernard's CLAUDE.md).
- The "no send" rule (draft-only) is deliberate — it gives Q a chance to review, add context, and customize recipients before distribution.
