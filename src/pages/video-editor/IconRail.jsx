import { isOverlaySel } from './constants'
import EditorIconRail from '@/components/editor/IconRail'
import { Captions, FileText, Film, MessageSquareText, Music, Repeat, Scissors, Sparkles, Type } from 'lucide-react'

export function IconRail({ ctx }) {
  const { sel, selectKey, overlays, addOverlay, captionPiece, piece } = ctx
  const selKey = isOverlaySel(sel) ? 'overlay' : sel
  // 'overlay' selection lights the 'text' tool (overlays ARE the text layer).
  const active = selKey === 'overlay' ? 'text' : selKey
  const items = [
    // Post caption first when this clip belongs to a post — it's the text that
    // publishes below the video, and the thing users came here to review. Absent
    // in standalone clip editing (Moment Miner) where no post exists yet.
    ...(captionPiece ? [{ key: 'postcaption', icon: MessageSquareText, label: 'Caption' }] : []),
    { key: 'moments', icon: Scissors, label: 'Clips' },
    { key: 'clip', icon: Film, label: 'Clip' },
    // Swap the source video — only when embedded on a post (a piece to repoint).
    // Standalone clip editing (Moment Miner / Slate) edits an asset directly and
    // has no media_urls to swap.
    ...(piece ? [{ key: 'media', icon: Repeat, label: 'Media' }] : []),
    { key: 'grade', icon: Sparkles, label: 'Grade' },
    // On-screen karaoke words burned into the frame — distinct from the post
    // caption above (labeled to avoid the collision that lost users the caption).
    { key: 'caption', icon: Captions, label: 'Karaoke' },
    { key: 'music', icon: Music, label: 'Music' },
    { key: 'transcript', icon: FileText, label: 'Script' },
    { key: 'text', icon: Type, label: 'Text' },
  ]
  const pick = (k) => {
    if (k === 'text') { if (overlays.length) selectKey(`overlay:${overlays[overlays.length - 1].id}`); else addOverlay() }
    else selectKey(k)
  }
  return <EditorIconRail items={items} active={active} onPick={pick} />
}
