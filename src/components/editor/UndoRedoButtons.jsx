// UndoRedoButtons — paired with useUndoHistory, for the EditorChrome action slot.

import { Redo2, Undo2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export default function UndoRedoButtons({ canUndo, canRedo, onUndo, onRedo }) {
  return (
    <div className="flex items-center overflow-hidden rounded-md border border-border">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
            className="px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Undo</TooltipContent>
      </Tooltip>
      <div className="h-4 w-px bg-border" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo"
            className="px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Redo</TooltipContent>
      </Tooltip>
    </div>
  )
}
