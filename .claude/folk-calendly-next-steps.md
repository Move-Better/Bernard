# Folk + Calendly — Next Steps Checklist

**Companion to:** [`.claude/folk-calendly-setup.md`](./folk-calendly-setup.md) (the full runbook).
**Drafted:** 2026-06-04. **Deadline:** June 30, 2026 (Phase 1 launches July 1).
**Owner:** Michael. Work through top-to-bottom; each block is independent enough to do in a 15–30 min sitting.

---

## Block 1 — Decisions to lock (5 min, do first)

- [ ] **Confirm demo email = `drq@withbernard.ai`** (Claude's default). Flip to `drq@movebetter.co` only if you want Move Better branding on the demo invite. All downstream signups use this email.
- [ ] **Confirm video tool** for the demo: Zoom or Google Meet. Pick whichever you already use for telehealth so you're not juggling logins on day-of.
- [ ] **Confirm availability window:** default in runbook is Tue/Wed/Thu 2–4pm ET, 3 slots/wk. Adjust if your clinic schedule conflicts.

## Block 2 — Calendly (~30 min)

- [ ] Sign up at https://calendly.com with the email from Block 1.
- [ ] Connect Google Calendar.
- [ ] Create event type `Bernard Demo · 30 min`, slug `bernard-demo`.
- [ ] Set the 5 booking-form questions per runbook §Part 1 step 5.
- [ ] Set availability per Block 1 decision (defaults in runbook §Part 1 step 4).
- [ ] Edit confirmation email to add the Loom recording note (runbook §Part 1 step 6).
- [ ] Turn on 24-hr + 1-hr reminders.
- [ ] **Record final URL** in runbook §"What Michael owes future-Michael".

## Block 3 — Folk (~60 min)

- [ ] Sign up at https://folk.app with the same email from Block 1.
- [ ] Create workspace `Bernard`.
- [ ] Create 3 pipelines with the exact stages from runbook §Part 2 step 3:
  - Outreach: Identified → Researched → DM Sent → Responded → Demo Booked
  - Demos: Demo Booked → Demo Held → Trial Started → Trial Active → Decision
  - Customers: Paid → Active → At Risk → Churned
- [ ] Add the 10 custom fields from runbook §Part 2 step 4 (incl. 4 UTM fields).
- [ ] Install Folk LinkedIn Chrome extension. **Don't bulk-import** — add per-prospect each Monday.
- [ ] Connect Folk ↔ Calendly:
  - Try native integration first (Folk Settings → Integrations → Calendly).
  - If missing, set up Zapier zap per runbook §Part 2 step 6 fallback.
- [ ] **Record final URL** in runbook §"What Michael owes future-Michael".

## Block 4 — End-to-end test (~10 min, do NOT skip)

Run the exact test from runbook §Part 4:

- [ ] Book a fake demo from your phone using a UTM-tagged Calendly link.
- [ ] Verify calendar invite + booking-form answers landed in your inbox.
- [ ] Verify contact + UTM fields populated in Folk → Demos → Demo Booked.
- [ ] Cancel test booking in Calendly + delete test contact in Folk.
- [ ] **Mark "End-to-end test: passed on YYYY-MM-DD"** in runbook §"What Michael owes future-Michael".

## Block 5 — Wire into weekly cadence (~5 min)

- [ ] Add a Monday 30-min "Outreach batch" block to your calendar (recurring). This is where the 10 DMs/wk happen — see runbook §Operating cadence.
- [ ] Add Sunday 30-min weekly review to your calendar (recurring) per [roadmap §Operating cadence](../../.claude/projects/-Users-qbook-Claude-Projects-Bernard/memory/project_bernard_revenue_roadmap.md).

## Block 6 — Cross-references

When this is done, also tick the row in the Phase 0 infra table in [`project_bernard_revenue_roadmap.md`](../../.claude/projects/-Users-qbook-Claude-Projects-Bernard/memory/project_bernard_revenue_roadmap.md) (the row already points at the runbook).

---

## Stop-and-reassess triggers

If any of these happen mid-setup, pause and bring it back to a Claude session instead of pushing through:

- Folk's native Calendly integration is missing AND Zapier free tier doesn't cover the fields — may need a different glue tool.
- Calendly UTM passthrough fails the end-to-end test — needs debugging before launch (broken attribution is worse than no attribution).
- You find yourself wanting to build something custom in Bernard to replace Folk or Calendly — that's a scope creep alarm; the buy-before-build call is locked.

---

## Resume prompt for next Claude session

> Picking up Folk + Calendly setup. Runbook is at `.claude/folk-calendly-setup.md`, next-steps checklist at `.claude/folk-calendly-next-steps.md`. Status: [paste which blocks are done]. Need help with: [specific block/question].
