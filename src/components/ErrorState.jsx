import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import Icon from '@/components/ui/Icon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Shared load-failure state. With `onRetry` it renders the destructive-tinted
// icon + Retry button variant (the canonical query-error treatment: Home,
// MediaHub, Moment Miner); without it, the original quiet muted variant.
export default function ErrorState({
  message = 'Something went wrong.',
  detail,
  onRetry,
  retrying = false,
  className,
  size = 'md',
}) {
  const padding = size === 'sm' ? 'py-12' : size === 'lg' ? 'py-28' : 'py-20'
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-center', padding, className)}>
      <Icon as={AlertCircle} size="xl" className={onRetry ? 'text-destructive/60' : 'text-muted-foreground'} />
      <p className={cn('text-sm', onRetry ? 'font-medium text-destructive' : 'text-muted-foreground')}>{message}</p>
      {detail ? <p className="text-xs text-muted-foreground max-w-sm">{detail}</p> : null}
      {onRetry ? (
        <Button size="sm" variant="outline" className="mt-2" onClick={onRetry} disabled={retrying}>
          {retrying ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
          )}
          Retry
        </Button>
      ) : null}
    </div>
  )
}
