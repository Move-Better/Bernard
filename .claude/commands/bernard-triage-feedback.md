---
description: Read untriaged in-app feedback (the `feedback` Supabase table — the source of truth for Bernard's Feedback button), investigate each report against the codebase, produce a prioritized punch list, spawn a task chip per actionable item, and stamp the rows triaged. Report-only by default — does NOT open fix PRs (review-before-ship). Sister command to /bernard-audit (code sweep) and /bernard-checkup (health pass).
---

Invoke the `bernard-triage-feedback` skill (via the Skill tool) and follow it exactly. Pass along any arguments given after the command.
