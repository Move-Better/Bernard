import * as React from 'react'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useSmartBack } from '@/lib/useSmartBack'

// Shared header shape for Settings subpages + Account, so heading size,
// back-button affordance, and icon placement can't drift page-to-page
// (2026-07-04 /auditfull: 10 settings pages + Account each hand-rolled
// their own header markup with no shared component).
const PageHeader = React.forwardRef(
  ({ className, title, subtitle, icon: Icon, backTo, children, ...props }, ref) => {
    const goBack = useSmartBack(backTo)
    return (
      <div ref={ref} className={cn('flex items-center justify-between gap-3 flex-wrap mb-4', className)} {...props}>
        <div className="flex items-center gap-3">
          {backTo ? (
            <Button variant="ghost" size="icon" onClick={goBack} aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : null}
          {Icon ? <Icon className="h-5 w-5 text-primary shrink-0" aria-hidden="true" /> : null}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle ? <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p> : null}
          </div>
        </div>
        {children ? <div className="flex items-center gap-2 flex-wrap">{children}</div> : null}
      </div>
    )
  }
)
PageHeader.displayName = 'PageHeader'

export { PageHeader }
