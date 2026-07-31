// "Send back to the author" — the third On-hand verdict (migration 200).
//
// A producer can tell a quote is garbled but usually can't repair it: the
// transcript says what the recorder heard, and only the clinician knows what
// they actually meant. Approve ships the garble, Retire throws away a real
// idea over an ASR artifact. This routes it to the one person who can fix it.
//
// Shared client/server so the note cap is enforced in one place (db/moments.js
// validates against MOMENT_SEND_BACK_NOTE_MAX; the textarea counts against it).

export const MOMENT_SEND_BACK_NOTE_MAX = 500

// Shown under the textarea. Concrete on purpose — "what's wrong with it" gets
// a producer to write "runs two sentences together" instead of "unclear",
// which is the difference between a fixable note and a shrug.
export const MOMENT_SEND_BACK_PLACEHOLDER =
  "What looks wrong? e.g. “runs two sentences together halfway through” or “last clause got garbled”"
