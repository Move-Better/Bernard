// Where "Talk to Bernard" goes. One place, so the sidebar, the phone top bar,
// the search palette and the Create page cannot disagree (simplicity audit C,
// 2026-11-10).
//
// Workspaces with the live voice call land on its topic screen; nothing
// records until the person picks a topic and presses start. Everyone else gets
// the same interview as a text chat. A browser that blocks the microphone is
// handled inside the live call page itself, which offers the text chat.
export function talkToBernardHref(workspace) {
  return workspace?.realtime_voice_enabled === true ? '/new/live-interview' : '/new/interview'
}
