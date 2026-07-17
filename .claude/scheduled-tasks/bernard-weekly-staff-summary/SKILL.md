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

Match each screenshot to a bullet by:
- Caption content overlap
- PR number (if bullet text mentions PR context)
- Date overlap (screenshot dated in the same 7-day window)

If a bullet has no matching screenshot, render just the text.

### 5. Build PDF with Python + Pillow

**Script location:** Inline Python in this routine.

```python
#!/usr/bin/env python3
import json
import os
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# Workaround: Ensure JPEG handler is available
try:
    from PIL import JpegImagePlugin
    Image.SAVE['JPEG'] = JpegImagePlugin._save
except (ImportError, KeyError):
    pass

# Config
SCREENSHOTS_DIR = Path("/Users/qbook/Claude Projects/Bernard/.staff-update-screenshots")
PDF_FILENAME = f"bernard-weekly-update-{datetime.now().strftime('%Y-%m-%d')}.pdf"
PDF_PATH = SCREENSHOTS_DIR / PDF_FILENAME

CAPTIONS_FILE = SCREENSHOTS_DIR / "captions.jsonl"
MAX_IMAGE_WIDTH = 950
BORDER_WIDTH = 2
BORDER_COLOR = (200, 200, 200)
PAGE_WIDTH = 1200
PADDING = 40
TEXT_COLOR = (0, 0, 0)
TITLE_COLOR = (40, 40, 40)
LINE_HEIGHT = 24
BULLET_MARGIN = 15

# Load bullets (passed as JSON)
bullets = json.loads("""BULLETS_JSON_PLACEHOLDER""")

# Load screenshot mappings
screenshot_map = {}
if CAPTIONS_FILE.exists():
    with open(CAPTIONS_FILE) as f:
        for line in f:
            try:
                entry = json.loads(line.strip())
                screenshot_map[entry.get('caption')] = entry
            except json.JSONDecodeError:
                pass

# Fonts (fallback to default if not available)
try:
    title_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 24)
    text_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
    bullet_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
except (IOError, OSError):
    title_font = ImageFont.load_default()
    text_font = ImageFont.load_default()
    bullet_font = ImageFont.load_default()

def wrap_text(text, font, max_width):
    """Wrap text to fit within max_width pixels."""
    lines = []
    for para in text.split('\n'):
        if not para.strip():
            lines.append('')
            continue
        words = para.split(' ')
        current_line = []
        for word in words:
            test_line = ' '.join(current_line + [word])
            bbox = ImageDraw.ImageDraw(Image.new('RGB', (1, 1))).textbbox((0, 0), test_line, font=font)
            test_width = bbox[2] - bbox[0]
            if test_width > max_width and current_line:
                lines.append(' '.join(current_line))
                current_line = [word]
            else:
                current_line.append(word)
        if current_line:
            lines.append(' '.join(current_line))
    return lines

def measure_content_height(bullets, screenshot_map, max_width):
    """Measure total height needed for all content."""
    height = PADDING * 2 + 60  # Title area
    
    for bullet_text in bullets:
        # Bullet text
        wrapped = wrap_text(f"• {bullet_text}", bullet_font, max_width - BULLET_MARGIN - PADDING * 2)
        height += len(wrapped) * LINE_HEIGHT + PADDING
        
        # Screenshot if available
        for caption in [bullet_text]:
            if caption in screenshot_map:
                img_path = SCREENSHOTS_DIR / screenshot_map[caption]['file']
                if img_path.exists():
                    img = Image.open(img_path)
                    aspect_ratio = img.height / img.width
                    img_width = min(MAX_IMAGE_WIDTH, max_width - PADDING * 2)
                    img_height = int(img_width * aspect_ratio)
                    height += img_height + BORDER_WIDTH * 2 + PADDING * 2
    
    return height

def render_pdf(bullets, screenshot_map, output_path, max_width=PAGE_WIDTH):
    """Render PDF with bullets and screenshots."""
    total_height = measure_content_height(bullets, screenshot_map, max_width - PADDING * 2)
    
    # Create image
    img = Image.new('RGB', (max_width, total_height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    
    y = PADDING
    
    # Title
    title = "Bernard Update — This Week"
    date_str = datetime.now().strftime("%B %d, %Y")
    draw.text((PADDING, y), title, font=title_font, fill=TITLE_COLOR)
    y += 40
    draw.text((PADDING, y), date_str, font=text_font, fill=TEXT_COLOR)
    y += 40
    draw.line([(PADDING, y), (max_width - PADDING, y)], fill=(220, 220, 220), width=1)
    y += 20
    
    draw.text((PADDING, y), "This week in Bernard:", font=text_font, fill=TITLE_COLOR)
    y += 30
    
    # Bullets
    for bullet_text in bullets:
        # Wrapped bullet text
        wrapped = wrap_text(f"• {bullet_text}", bullet_font, max_width - BULLET_MARGIN - PADDING * 2)
        for line in wrapped:
            draw.text((PADDING + BULLET_MARGIN, y), line, font=bullet_font, fill=TEXT_COLOR)
            y += LINE_HEIGHT
        
        y += PADDING
        
        # Screenshot if available
        for caption in [bullet_text]:
            if caption in screenshot_map:
                img_path = SCREENSHOTS_DIR / screenshot_map[caption]['file']
                if img_path.exists():
                    try:
                        ss_img = Image.open(img_path).convert('RGB')
                        aspect_ratio = ss_img.height / ss_img.width
                        img_width = min(MAX_IMAGE_WIDTH, max_width - PADDING * 2)
                        img_height = int(img_width * aspect_ratio)
                        ss_img = ss_img.resize((img_width, img_height), Image.Resampling.LANCZOS)
                        
                        # Add border
                        bordered = Image.new('RGB', (img_width + BORDER_WIDTH * 2, img_height + BORDER_WIDTH * 2), BORDER_COLOR)
                        bordered.paste(ss_img, (BORDER_WIDTH, BORDER_WIDTH))
                        
                        # Paste onto main image
                        x_offset = (max_width - img_width - BORDER_WIDTH * 2) // 2
                        img.paste(bordered, (x_offset, y))
                        y += img_height + BORDER_WIDTH * 2 + PADDING * 2
                    except Exception as e:
                        print(f"Warning: Could not load screenshot {img_path}: {e}")
    
    # Save as PDF
    img.convert('RGB').save(output_path, 'PDF')
    return output_path

# Execute (placeholder for bullets JSON)
output = render_pdf(bullets, screenshot_map, PDF_PATH)
print(f"✓ PDF saved: {output}")
```

**Execution:**
1. Serialize the filtered bullets as JSON
2. Substitute into the Python script
3. Run the script
4. Verify PDF exists and is readable

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

## Verification checklist (first run only)

Before considering this routine "complete," verify:
1. ✅ The PDF renders and is readable
2. ✅ A Gmail draft appears in the drafts folder with the expected subject + body
3. ✅ The draft points to the correct PDF file path
4. ✅ Screenshots (if any matched) appear embedded in the PDF

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
