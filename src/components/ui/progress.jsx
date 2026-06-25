import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '@/lib/utils'

// shadcn-style Progress (Radix). Replaces hand-rolled `style={{ width: pct% }}`
// bars in UploadTray, ClipFinder, MediaPicker, etc. The fill eases between values
// (magicui-style) rather than jumping. Pass `value` 0–100; null/undefined renders
// an indeterminate-friendly empty track.
const Progress = React.forwardRef(({ className, value, ...props }, ref) => {
  const pct = Math.min(100, Math.max(0, Number(value) || 0))
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      value={pct}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
