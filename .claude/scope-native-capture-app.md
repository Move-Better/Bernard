# Should we build a Bernard iPhone/Mac app? (The pocket interview)

**What this is:** A plan for Q to read and approve — not actual code. No app has been built.
**Date:** 2026-06-04 (rewritten to center on the pocket interview) · **Decision:** Q's call

---

## 1. The real goal

Q's goal, in his own words: **start an interview, put the phone in your pocket, and walk the dogs or drive to work.** A hands-free voice conversation — like a phone call with an interviewer who asks you about your day, your patients, your ideas, while you do something else.

That doesn't work on iPhone today, and it never will in the browser. The moment you pocket the phone or lock the screen, the phone shuts the browser tab down and the conversation dies. There's no browser trick that fixes this — a backgrounded web page always gets killed.

**Only a real app can do this.** A real app is allowed to keep its microphone and audio running in the background, the same way a phone call or a podcast keeps playing when you put your phone away.

So the app isn't really a "capture" tool. **Its main job is the pocket interview** — a voice conversation that survives your pocket, your drive, and even a real phone call coming in. Recording footage, photos, and quick voice memos come along as a bonus, but the interview is the point.

---

## 2. What the pocket interview has to do

Think of it as a phone call with an interviewer. To feel that natural, the app needs to:

1. **Keep going in the background.** Screen off, in your pocket, hands-free — the conversation keeps running. (This is the one thing only a real app can do.)
2. **Listen and talk back, all by voice.** Once you start, no tapping. It asks a question out loud, you answer, it asks the next one based on what you said.
3. **Know when you're done talking — by a long pause,** just like a person does. You stop, it waits a beat, then it responds. As a backstop, you can also just say **"I'm done"** to end the interview.
4. **Survive interruptions.** A real phone call comes in — the interview pauses, then picks back up when you're free. Same for losing signal for a minute.
5. **Never lose anything.** It saves the conversation continuously, so a crash, a dead battery, or accidentally closing the app never costs you the whole interview.
6. **Capture too (bonus).** Snap a photo or record footage at full quality, and drop quick voice memos — all uploaded reliably.

---

## 3. We already built a lot of the plumbing

Good news: the backend an app needs mostly already exists. We don't have to rebuild the hard server pieces — the app would reuse them.

| What it does | Already built? | How the app reuses it |
|---|---|---|
| **Running the interview conversation** | ✅ The website already runs the live back-and-forth interview. | The app talks to the same brain — it just provides a better, pocket-safe way to have the conversation. |
| **A personal key per person** | ✅ A 90-day key created per person. | The app saves it once at setup, then just carries it. |
| **Uploading files of any size** | ✅ A path that sends files straight to our storage. | The app uses the same path, and keeps uploading even after you close it. |
| **Turning audio into a draft** | ✅ Audio → written-out words → draft. | The app sends voice memos straight here. |

**The point:** the new work is mostly on the *phone side* — making the conversation hands-free and pocket-proof. The server side is largely done.

---

## 4. The three ways to build it

| Option | In plain terms | Est. Days | Est. Claude Cost |
|---|---|---|---|
| **A — Wrap the website in an app** | Put our website inside an app shell. | 8–14d | $40–100 (Opus) |
| **B — A purpose-built Apple app ⭐** | A focused app built with Apple's own tools, designed around the pocket interview. | 15–25d | $80–200 (Opus) |
| **C — A separate app built with Expo/React Native** | Same idea as B, but with a cross-platform toolkit. | 18–28d | $90–220 (Opus) |

**A — Wrap the website:** Tempting, but the one thing that matters — keeping a live voice conversation alive in your pocket — is the part a wrapped website handles worst. You'd fight the browser's background limits the whole way. Not the right tool for a hands-free voice app.

**B — Purpose-built Apple app (recommended):** Uses Apple's built-in tools the proper way, so the conversation genuinely keeps going in your pocket, handles a real phone call interrupting it, and listens hands-free. Reuses all the plumbing from Section 3. Handed out to the team through TestFlight (Apple's tool for sharing an app with your own people — no public App Store review to wait on). Clinical recordings go straight from the phone to our storage, so no outside company ever touches them.

**C — Expo / React Native:** Only worth it if we ever wanted Android too. Our team is all Apple, so that upside is wasted — and a hands-free background voice conversation is the finickiest thing to get right in this toolkit. Skip it.

> **Recommendation: Option B.** It's the only one that can truly deliver the pocket interview, it reuses what we've already built, it keeps recordings private, and TestFlight skips the App Store wait.

---

## 5. The honest hard parts (what could make this 15 days vs. 25)

I want to be straight about where the risk is, because this is a bigger build than a simple uploader:

- **Keeping the conversation alive in your pocket** is the make-or-break piece. Apps do this every day (phone calls, podcasts, voice assistants), so it's a known, solved problem — but it has to be set up carefully, and it's the thing to prove first.
- **Hands-free "knowing when you're done"** (the long-pause detection) needs tuning so it doesn't cut you off mid-thought or sit there too long. The "I'm done" backstop covers the edge cases while we get the timing right.
- **A real phone call interrupting the interview** has to be handled gracefully — pause, then resume. Standard, but needs testing.
- **Eyes-free, while driving** raises the bar: it has to work with zero looking at the screen. That's a design discipline, not extra code, but it shapes everything.

None of these are dealbreakers — they're all things real voice apps handle. But they're why this is "a real app," not a weekend project. My suggestion is to **prove the pocket-conversation piece first** (a small test that just keeps a voice conversation running in your pocket for 20 minutes through a dog walk) before building the rest. If that works, the rest is mostly known work.

---

## 6. Costs and risks to know

| Thing to know | Detail |
|---|---|
| **Apple fee** | $99/year, every year, to put any app on iPhones (even just for the team). |
| **App Store review** | Skippable for team use via TestFlight. Only needed if we ever offer it to outside customers. |
| **A second thing to maintain** | A permanent second piece alongside the website. The interview's "brain" stays shared (on the server), so the app mostly maintains the *phone* experience. |
| **Sign-in** | Handled by the personal key — you sign in once at setup. The key expires after 90 days, so the app needs a friendly "tap to set up again" message. |
| **Battery** | A 20–40 minute background voice conversation uses real battery (mic + talking + connection). Worth setting expectations; not a blocker. |
| **Recordings stay private** | A plus: everything goes phone → our storage directly, no outside company in the middle. |

---

## 7. Where this leaves us

- The **pocket interview is the killer feature**, and it genuinely **requires** the native app — no cheaper fix can deliver it.
- The cheap browser fixes (already in progress) still matter for *recording* safety, but they can't give you the pocket interview. So this app moves **up** the priority list rather than waiting behind them.
- **Recommended build: Option B**, ~15–25 days, with the pocket-conversation piece proven first as a quick test before committing to the full build.

### In one line
The native app's real job is the **hands-free pocket interview** — start it, pocket it, walk the dogs — which only a real app can keep alive; it reuses the interview brain and upload plumbing we already have, and the smart first step is a small test that proves a voice conversation can survive a dog walk in your pocket.
