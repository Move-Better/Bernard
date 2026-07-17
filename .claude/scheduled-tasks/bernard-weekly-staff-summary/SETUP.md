# Bernard Weekly Staff Summary — Setup Complete

**Date:** July 16, 2026  
**Implementation:** Ported from Deep Thought routine (2026-07-16)

---

## What was created

### 1. Routine definition
- **Location:** `.claude/scheduled-tasks/bernard-weekly-staff-summary/SKILL.md`
- **Purpose:** Generate a combined PDF (bullets + embedded screenshots) + Gmail draft of weekly Bernard changes
- **Trigger:** Weekly scheduled task (automated, non-interactive)

### 2. Screenshot storage & convention
- **Directory:** `.staff-update-screenshots/` (gitignored, local-only)
- **Files:**
  - `*.png` — UI screenshots with naming pattern `YYYY-MM-DD_PR###_short-slug.png`
  - `captions.jsonl` — Index of screenshots (one JSON line per image)
  - `README.md` — Guide for future sessions
- **Documentation:** Added to `CLAUDE.md` → "Weekly staff-update routine — capturing screenshots for the PDF"

### 3. Git & ignore
- **Updated `.gitignore`** to exclude `.staff-update-screenshots/` (local artifacts)
- **Routine accesses only `.git/` and `.staff-update-screenshots/`** — no app-code mutations

---

## How it works

### Weekly execution flow (automated)

1. Sync `origin/main` via local git (fetch + pull --ff-only)
2. Get 7 days of commits, parse subjects + bodies
3. Filter to user-visible changes only (no refactors, CI, docs, etc.)
4. Check `.staff-update-screenshots/captions.jsonl` for matching screenshots
5. Build a PDF with Python + Pillow:
   - Title + date
   - Wrapped bullet points
   - Embedded screenshots (resized ~950px, bordered) immediately under related bullets
   - Single file: `.staff-update-screenshots/bernard-weekly-update-<YYYY-MM-DD>.pdf`
6. Create Gmail draft:
   - To: `drquasney@gmail.com` (placeholder)
   - Subject: `"Bernard Update — [Month Day, Year]"`
   - Body: Plain text pointing to the PDF file path + note to attach before sending
7. **Never sends the email** — always draft-only, giving Q a chance to review and customize

### Ship-time responsibility (manual, as UI changes ship)

When you merge a UI change to `main`:
1. If it's user-visible (backend-only changes skip this):
   - Navigate to the changed screen in Q's real Chrome (via claude-in-chrome MCP)
   - Isolate the relevant UI element with `javascript_tool` (hide siblings)
   - Use html2canvas to render it
   - Trigger browser download to `~/Downloads/`
   - Move it into `.staff-update-screenshots/` with the naming pattern
   - Add one JSON line to `captions.jsonl` with the caption

See **`CLAUDE.md` → "Weekly staff-update routine — capturing screenshots for the PDF"** for detailed steps.

---

## First-run checklist

Before the first automated run (or to test the routine manually):

- [ ] Verify `.staff-update-screenshots/` directory exists
- [ ] Verify `.gitignore` includes `.staff-update-screenshots/`
- [ ] Verify `captions.jsonl` exists (can be empty initially)
- [ ] Test the Python PDF generation locally (run SKILL.md manually with sample bullets)
- [ ] Confirm the PDF renders correctly
- [ ] Verify Gmail MCP `create_draft` tool works and creates a draft in your account
- [ ] Check that the draft is created with placeholder recipient, correct subject, and file path in body

**Known limitations (accepted):**
- No programmatic file attachment to Gmail draft (costs ~1000 tokens per KB to read file content). User must drag/attach the PDF manually before sending.
- Staff email recipient is a placeholder (`drquasney@gmail.com`). Distribution list is a manual step — user customizes the `to:` field before sending.

---

## Files & locations

```
Bernard/
├── .claude/
│   └── scheduled-tasks/
│       └── bernard-weekly-staff-summary/
│           ├── SKILL.md              ← Routine definition (executable)
│           └── SETUP.md              ← This file
├── CLAUDE.md                         ← Updated with screenshot capture guide
├── .gitignore                        ← Updated
└── .staff-update-screenshots/        ← Local-only folder (gitignored)
    ├── README.md                     ← Guide for future sessions
    ├── captions.jsonl                ← Index of screenshots (starts empty)
    └── [screenshots + PDFs go here]
```

---

## Testing the routine

To test before scheduling:

```bash
cd "/Users/qbook/Claude Projects/Bernard" && \
  python3 /path/to/script.py  # Use inline Python from SKILL.md
```

Or invoke the routine from a session using the SKILL.md directly (follow the steps manually to verify each piece).

---

## Maintenance

- **Captions.jsonl**: Update whenever you capture a new screenshot (add one JSON line with file, date, PR, caption).
- **SKILL.md**: Update if the output format, PDF layout, or Gmail integration changes.
- **CLAUDE.md**: Already documents the ship-time screenshot capture process — no further updates needed unless the pipeline changes.

---

## Notes

- This is a port of the Deep Thought routine (2026-07-16) adapted for Bernard. The pipeline was tested and refined there; this implementation reuses the proven patterns.
- The routine is read-only against the repo — no commits, no pushes, no code mutations. It only reads git history and the local screenshots folder.
- No staff email surface exists in Bernard DB (staff are Clerk org members). The placeholder recipient approach matches Deep Thought's decision — the user customizes before send.
- The routine handles edge cases: no user-visible changes → draft-only summary, no screenshots → text-only PDF, tool failure → fallback or note in completion report.
