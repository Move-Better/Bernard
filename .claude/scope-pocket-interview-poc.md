# Proof-of-concept: can a voice interview survive a dog walk?

**What this is:** The go/no-go test to run *before* committing 15–25 days to the full native app.
**Date:** 2026-06-04 · **Decision after the test:** Q's call
**Parent doc:** `.claude/scope-native-capture-app.md`

---

## Why do this first

The full app has lots of pieces, but almost all of them are normal, known work. **One piece decides whether the whole idea works: can a hands-free voice conversation actually keep running while the phone is in your pocket, screen off, for a real walk or drive — including when a real phone call interrupts it?**

If that works, the rest of the app is mostly assembly. If it *doesn't* work the way you need, we want to find out in a few days for a few hundred dollars — not three weeks in.

So the proof-of-concept is deliberately ugly. It's not the real app. It's the smallest possible thing that answers the one question that matters.

---

## What the proof-of-concept actually is

A bare-bones test app on Q's iPhone (handed over via TestFlight) that does **only** this:

1. One button: **Start**.
2. It begins a real interview using our existing interview brain — asks a question out loud.
3. You answer. It waits for a **long pause**, then asks the next question. (The "I'm done" voice backstop is included so the test can end cleanly.)
4. **You lock the phone and put it in your pocket.** The conversation keeps going.
5. You go for a real 20-minute dog walk (and ideally a short drive).
6. Partway through, **someone calls you.** You take the call. When you hang up, the interview picks back up.
7. At the end, the full conversation is saved — nothing lost — and you can read the transcript.

No polish, no nice screens, no capture features, no settings. Just: does the conversation survive real life in your pocket?

---

## What "pass" looks like (the go/no-go bar)

The test **passes** if all of these hold on a real iPhone, screen locked, in a pocket:

| # | Must hold true | Why it matters |
|---|---|---|
| 1 | The conversation keeps running for a **full 20 minutes** backgrounded, screen off | This is the whole reason for a native app |
| 2 | It **hears you correctly** while the phone is pocketed (not just held to your face) | Eyes-free, hands-free is the point |
| 3 | The **long-pause detection feels natural** — it doesn't cut you off mid-thought, and doesn't leave awkward dead air | This is the part most likely to feel "off" and need tuning |
| 4 | A **real incoming phone call** pauses it, and it **resumes** cleanly after you hang up | Phones get calls; this can't break the interview |
| 5 | A brief **signal drop** (e.g. dead zone on the walk) doesn't kill the conversation | Walks and drives have dead zones |
| 6 | At the end, the **entire transcript is saved** — even if the app crashed or you force-closed it | "Never lose it" is non-negotiable |
| 7 | Battery use over 20–40 min is **reasonable** (a normal call's worth, not a meltdown) | Sets expectations; a dealbreaker only if it's extreme |

**Partial pass** (worth knowing): if 1, 4, 6 hold but 3 (pause timing) feels rough, that's fine — pause-tuning is expected work, and the "I'm done" backstop covers it meanwhile. The things that would make us **rethink** are failures on 1, 2, 4, or 6 — those are the "real life breaks it" failures.

---

## What we'd learn either way

- **If it passes:** green light. We know the hard part works, and the 15–25 day estimate for the full app is solid. We move to building the real thing.
- **If it half-passes** (works but pause timing or battery is rough): we know exactly what to budget extra time for, and whether the "I'm done" backstop is enough to live with while we tune.
- **If it fails** (can't stay alive in the pocket, or loses the conversation): we've saved ourselves three weeks and learned the idea needs a different shape — for a fraction of the cost.

---

## Rough cost of the test itself

| | Detail |
|---|---|
| **Time** | ~2–4 days to build the bare test app + get it onto Q's phone |
| **Claude cost** | ~$15–40 (Opus) |
| **Other costs** | The $99/yr Apple Developer account (needed anyway for the real app, so not wasted) |
| **What Q does** | One real dog walk + ideally one short drive with the phone pocketed, take a real call partway through, then tell me what felt right and what felt off |

---

## The one decision before I build it

The test reuses our **existing interview brain** (the same one the website uses), so the questions and flow are already real. The only genuinely new thing in the test is the **pocket-survival + pause-detection** layer.

**Recommended:** build this proof-of-concept as the next step. It's cheap, it's fast, and it's the honest gate before a real commitment. If you say go, I'll start by confirming the few Apple setup pieces (developer account access, getting a test build onto your phone) and then build the bare test.

### In one line
Before spending three weeks on the real app, spend three days proving the only risky part — that a hands-free voice interview can survive a real dog walk in your pocket, including a phone call interrupting it, without losing a word.
