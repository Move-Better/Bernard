# Bernard Staff Summary Routine (every 3 weeks)

**Objective:** Produce a combined plain-language PDF summary of the last ~3 weeks of
Bernard changes, with user-facing changes paired to relevant existing screenshots, plus a
Gmail draft pointing to it.

**Trigger:** This task's cron fires every Thursday, but it only does real work roughly
every 3rd firing — see step 0. Do not skip step 0.

**Rebuild note (2026-08-27):** This replaces the old `bernard-weekly-staff-summary` task,
which had gone silent (its last successful PDF was 2026-08-20; the following week's run
produced nothing, with no error surfaced anywhere). Two likely causes were removed in this
rebuild:
1. The old routine ran `git checkout main -q && git pull --ff-only`. The Bernard project
   root at `/Users/qbook/Claude Projects/Bernard` is a **shared working tree** — other
   sessions (human or Claude) routinely leave it on a feature branch with uncommitted work.
   A non-interactive `checkout`/`pull` there can fail outright with no one able to resolve
   it. This rebuild never checks out or mutates the project root — it reads `origin/main`
   history directly via `git fetch` + `git log origin/main`, which cannot collide with
   anyone else's working tree.
2. The old routine tried to CAPTURE new screenshots itself (1Password mount read +
   Playwright), inside the scheduled run. Per this repo's own `CLAUDE.md`, screenshot
   capture is a **ship-time** responsibility of whoever merges a UI PR, not something this
   routine should attempt — and the capture path depends on a 1Password `.1pw` mount that
   is documented to occasionally hang indefinitely with no timeout. This rebuild only reads
   `captions.jsonl` for screenshots that already exist; it never invokes
   `scripts/capture-screenshot.mjs` itself. If a bullet has no existing screenshot, it just
   ships without one — that's expected, not a failure.

If this routine goes silent again, check those two things first before assuming it's a new
bug.

**Output:**
- PDF: `.staff-update-screenshots/bernard-staff-update-<YYYY-MM-DD>.pdf`
- Gmail draft: to `drq@movebetter.co` (default; user may change before sending), pointing
  at the PDF file path

---

## Step 0 — cadence gate (run this FIRST, before touching git or building anything)

This task's cron fires weekly so the scheduler has a reliable clock, but the actual cadence
is **every 3 weeks (~21 days)**, enforced here rather than in cron (5-field cron cannot
express "every 3rd week" directly, and the exact-N-week interval matters more than hitting
a specific calendar date).

1. Marker file: `/Users/qbook/.claude/scheduled-tasks/bernard-staff-summary-3wk/.last-sent`
   — a single line, the ISO date (`YYYY-MM-DD`) of the last run that successfully produced
   a PDF.
2. If the marker file does not exist: proceed (first run since rebuild).
3. If it exists: compute days since that date. If **fewer than 19 days** have passed,
   this is a no-op — do nothing else. Do not run git commands, do not build a PDF, do not
   touch Gmail. Just stop. (19 rather than 21 gives a few days of slack for scheduler
   jitter without causing an early double-fire.)
4. If 19+ days have passed, proceed with the full pipeline below. Use the actual elapsed
   days (capped at 35, to bound worst-case PDF size if a run was missed) as the lookback
   window in step 2, instead of a hardcoded 21 — this avoids a coverage gap if a prior run
   was skipped or failed.
5. **Only write today's date to the marker file at the very end, after the PDF has been
   built AND verified readable (step 5.4).** If anything fails before that, leave the
   marker alone so the next weekly check-in retries a real run instead of silently skipping
   another cycle.

## Pipeline

### 1. Read recent commit history from `origin/main` (read-only, no checkout)

```bash
cd "/Users/qbook/Claude Projects/Bernard" && \
  git fetch origin main -q && \
  git log --since="<N> days ago" --pretty=format:"%h%n%s%n%b%n===END===" origin/main
```

Where `<N>` is the lookback window from step 0.4 (21 on a normal cycle, more if a run was
missed). **Never `git checkout`, `git pull`, or otherwise mutate the working tree in the
project root** — this reads `origin/main`'s history directly via the remote-tracking ref,
which needs no clean working tree and cannot collide with whatever branch a parallel
session has checked out there.

Parse subject lines + full commit bodies (PR-squash bodies often contain the real
description).

### 2. Filter to user-visible changes

Write one plain-language bullet per item. **Criteria for inclusion:**
- ✅ New feature, UI fix, new capability, workflow improvement, visual refresh
- ✅ Bug fix that users would notice (not internal refactor with no behavior change)
- ❌ Skip: refactors, CI/test changes, dependency bumps, internal audits, security
  hardening with no UI impact, docs-only, lint/config changes

**Tone:** Warm, plain language. No jargon, no PR numbers, no file paths, no technical
terms. Assume staff who use Bernard day-to-day, not engineers. With a 3-week window there
will typically be more items than the old weekly version — that's fine, the PDF paginates
(step 5.2). If the list is very long (30+ bullets), group related bullets from the same
area into one combined sentence rather than trimming real changes out.

### 3. Match screenshots to bullets — READ ONLY, never capture new ones

Check `.staff-update-screenshots/captions.jsonl` (one line per screenshot, JSON):
```json
{"file":"YYYY-MM-DD_PR###_slug.png","date":"YYYY-MM-DD","pr":###,"caption":"one plain-language sentence"}
```

**This routine does NOT run `scripts/capture-screenshot.mjs` or touch 1Password.**
Screenshot capture is a ship-time responsibility documented in this repo's `CLAUDE.md` —
whoever merges a user-visible UI PR is expected to have already added an entry to
`captions.jsonl`. If a bullet has no matching screenshot, render it as text only. Do not
attempt to generate one; that dependency (a 1Password `.1pw` mount + local Playwright) is
exactly what made the old routine fragile in a headless run.

**The PDF-build script keys `screenshot_map` on the literal caption string and looks up
`if bullet_text in screenshot_map`** — an exact match. Since bullets are freshly written
each run (not copy-pasted from `captions.jsonl`), an exact match is the exception, not the
rule. Match with this priority order, and **rewrite the bullet text passed into the PDF
script to equal the winning caption exactly** whenever a match is found (the renderer only
embeds on exact string equality, so the match has to be made real, not just noted):

1. **PR number** — if the bullet was generated from a commit whose PR number appears in
   `captions.jsonl`, that's the match, full stop, regardless of wording.
2. **Date + strong content overlap** — screenshot dated inside the lookback window AND
   shares several distinctive nouns/verbs with the bullet (e.g. both mention "media usage
   counter").
3. **Caption content overlap alone** — same idea, no date signal (use sparingly, PDF/
   screenshot dates are the primary anchor).

If a bullet has no matching screenshot, render just the text — don't force a weak match.

### 4. Build PDF with Python + Pillow

**Script location:** Inline Python in this routine.

**4.1 — write the bullets to a file, do NOT inline them.** Bullets routinely contain
apostrophes, double quotes and em-dashes, and one stray `"""` or backslash silently
corrupts a Python string literal built by substitution. Write the filtered bullets as a
JSON array to `bullets.json` next to the script instead; the script reads it directly.

**4.2 — the PDF is PAGINATED.** Do not render one tall image and save it as a single page.
The `Pager` class flows content across letter-ratio pages (1200x1553) and never splits a
screenshot across a page break — a block that does not fit starts a new page.

**4.3 — `IMAGE_OVERRIDES` exists because a fixed 950px width ruins two common shapes.**
The stock behavior scales every screenshot to 950px wide, which fails in both directions:

- **An ultra-wide strip becomes an unreadable sliver.** Crop the dead space out to a
  `_crop.png` derivative (if one already exists on disk) and give it a `width` up to 1120
  (page width minus padding).
- **A small native crop gets soft-upscaled.** Cap its `width` at or near its native size
  instead.

Add an entry keyed on the filename from `captions.jsonl`; `file` substitutes a different
image, `width` overrides the target width. Both are optional. This routine does not create
new crops itself (per step 3) — only use overrides for screenshots already on disk.

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
PDF_FILENAME = f"bernard-staff-update-{datetime.now().strftime('%Y-%m-%d')}.pdf"
PDF_PATH = SCREENSHOTS_DIR / PDF_FILENAME
CAPTIONS_FILE = SCREENSHOTS_DIR / "captions.jsonl"
BULLETS_FILE = Path(__file__).parent / "bullets.json"   # written in step 4.1

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

# Per-file render overrides. Keyed on the filename from captions.jsonl. Fill in only for
# screenshots already on disk that render badly at the stock 950px width (see 4.3).
IMAGE_OVERRIDES = {}


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


def render_pdf(bullets, screenshot_map, output_path, window_label):
    p = Pager()

    p.text(PADDING, "Bernard Update", title_font, RUST)
    p.y += 48
    p.text(PADDING, window_label, text_font, TEXT_COLOR)
    p.y += 34
    p.hr()
    p.y += 22
    p.text(PADDING, "Over the last few weeks in Bernard:", text_font, TITLE_COLOR)
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


# window_label should be filled in by the routine, e.g. "August 6 – August 27, 2026"
window_label = datetime.now().strftime("%B %d, %Y")
out, npages = render_pdf(bullets, screenshot_map, PDF_PATH, window_label)
print(f"✓ PDF saved: {out} ({npages} pages, {len(bullets)} bullets)")
```

Before running, replace the `window_label` line with the actual date range covered (start
date = today minus the lookback window from step 0.4, end date = today), e.g.
`"August 6 – August 27, 2026"` — this matters more here than it did weekly, since the
reader needs to know this covers 3 weeks, not 1.

**Execution:**
1. Write the filtered bullets as a JSON array to `bullets.json` beside the script
2. Run the script
3. Render every page with `pdftoppm` and read them — confirm legibility and sharp images
4. If a screenshot renders badly, add an `IMAGE_OVERRIDES` entry and re-run

**Known workaround:** PIL/Pillow on some systems throws `KeyError: 'JPEG'` on save. The
script includes the import guard above.

### 5. Create Gmail draft

Use the **Gmail MCP** `create_draft` tool:
- **to:** `drq@movebetter.co` (default; user may replace before sending)
- **subject:** `"Bernard Update — " + today's date (MMMM DD, YYYY)`
- **body:**
  ```
  Bernard update covering the last few weeks for the team.

  See attached: [PDF file path from step 4]

  To send: Attach the PDF file, update recipients as needed, and hit Send.
  ```

**Constraint:** `to` is a required field, so set it to `drq@movebetter.co` with a note in
the body that recipients can be updated before sending. No programmatic way found yet to
attach a file via Gmail MCP (reading the file into context costs ~1000 tokens per KB), so
attachment is manual.

**If the Gmail tool is unavailable, blocked, or errors:** do not let this block the run.
The PDF on disk is still the primary deliverable — note the Gmail failure in the completion
report and move on. Do not retry in a loop and do not treat a Gmail failure as a reason to
skip writing the marker file in step 0.5, as long as the PDF itself built and verified.

---

## Handling edge cases

### No user-visible changes in the window
Skip the PDF/screenshot machinery. Create a short Gmail draft instead:

```
Subject: Bernard Update — [date]
Body: No notable changes to Bernard over the last few weeks — everything's running as usual.
```

Still write the marker file (step 0.5) — an empty cycle is not a failed run.

### Screenshots exist but PDF build fails
Log the Python error. Fall back to text-only PDF (no images, just the bullets). Note in the
completion report that image rendering failed.

### Gmail MCP unavailable
Log the error. Print the bullet list + PDF path to the completion report. Note that manual
draft creation is needed. This alone must not prevent writing the marker file, provided the
PDF itself is done and verified.

### git fetch fails (network / auth issue)
This is the one failure that should genuinely abort the run without writing the marker —
without commit history there is nothing to summarize. Note the failure clearly in the
completion report so it's visible on the next check-in, and leave the marker untouched so
the following Thursday's gate check retries a real run rather than skipping another cycle.

### Staff email addresses
Bernard staff are currently auth-managed (Clerk org membership) with no direct app DB email
surface. The default recipient (`drq@movebetter.co`) in the Gmail draft is appropriate;
leave it as-is and document that team distribution is a manual send step before completion.

---

## Verification checklist (every real run — not the step-0 no-op cycles)

Before considering this routine "complete" for a given firing, verify:
1. ✅ Every page renders and is readable — `pdftoppm -png -r 110 -f N -l N <pdf> p`, then
   read each PNG. "The file saved without error" is not verification.
2. ✅ A Gmail draft appears in the drafts folder with the expected subject + body (unless
   Gmail was unavailable — see edge case above)
3. ✅ The draft points to the correct PDF file path
4. ✅ Screenshots (if any matched) appear embedded in the PDF, and each one is legible at
   its rendered size
5. ✅ The marker file at
   `/Users/qbook/.claude/scheduled-tasks/bernard-staff-summary-3wk/.last-sent` now contains
   today's date — this is the step most likely to be forgotten, and if it's skipped the
   next 6 weekly gate-checks will all silently no-op instead of firing on schedule.

If the Gmail tool gets blocked by the safety classifier in a headless run, the routine will
note that in the completion report and the draft creation will be a manual step.

---

## Files & Conventions

**Local storage:**
- Repo: `.staff-update-screenshots/` (gitignored)
- Pattern: `YYYY-MM-DD_PR###_short-slug.png`
- Index: `captions.jsonl` (one JSON line per screenshot)

**Cadence marker (not in the repo):**
- `/Users/qbook/.claude/scheduled-tasks/bernard-staff-summary-3wk/.last-sent`

**PDF output:**
- `bernard-staff-update-<YYYY-MM-DD>.pdf`
- Placed in `.staff-update-screenshots/`

**Gmail draft:**
- Subject: `Bernard Update — [Month Day, Year]`
- Recipient: `drq@movebetter.co` (default; user updates before send if needed)
- Attachment: Manual (PDF file path noted in body)

---

## Notes

- This routine is read-only against the repo (git fetch only — no checkout, no pull, no
  commits, no pushes, no working-tree mutation of any kind in the shared project root).
- Screenshot capture and captioning is a ship-time responsibility handled by whoever merges
  a user-visible UI PR (documented in this repo's `CLAUDE.md`). This routine only reads
  `captions.jsonl` — it never runs `scripts/capture-screenshot.mjs` and never touches the
  1Password mount.
- The "no send" rule (draft-only) is deliberate — it gives Q a chance to review, add
  context, and customize recipients before distribution.
- Cadence is enforced by the step-0 marker-file gate, not by cron alone, so it stays a true
  ~3-week interval regardless of scheduler jitter or an occasional missed/failed run.
