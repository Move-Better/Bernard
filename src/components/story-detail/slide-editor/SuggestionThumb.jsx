import { Image as ImageIcon, Loader2, Check, Plus } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

// One lightweight suggestion thumbnail (avoids importing the heavy CandidateCard).
export default function SuggestionThumb({ clip, attached, attaching, onAttach }) {
  const thumb = clip.thumbnailUrl || clip.blobUrl || clip.url
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={attaching}
          onClick={onAttach}
          className={`group relative aspect-square overflow-hidden rounded-xl border-2 transition-all ${
            attached ? 'border-primary' : 'border-border hover:border-primary'
          }`}
        >
          {thumb
            ? <img src={thumb} alt="" className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center bg-muted"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>}
          <span className="absolute left-2 top-2 rounded-md bg-primary px-1.5 py-0.5 text-xs font-bold leading-tight text-primary-foreground">AI</span>
          <span className={`absolute inset-0 flex items-center justify-center bg-black/40 text-white transition-opacity ${attaching ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            {attaching ? <Loader2 className="h-7 w-7 animate-spin" /> : attached ? <Check className="h-7 w-7" /> : <Plus className="h-7 w-7" />}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{attached ? 'Already in this post — click to use it on this slide' : 'Use this photo'}</TooltipContent>
    </Tooltip>
  )
}
