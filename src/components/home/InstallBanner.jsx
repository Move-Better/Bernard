import { Share, X, Download } from 'lucide-react'
import { useInstallPrompt } from '@/lib/useInstallPrompt'

export default function InstallBanner() {
  const { showBanner, canNativePrompt, isIOSSafari, prompt, dismiss } = useInstallPrompt()

  if (!showBanner) return null

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
      <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 shrink-0 mt-0.5">
        {isIOSSafari
          ? <Share className="h-4 w-4 text-primary" />
          : <Download className="h-4 w-4 text-primary" />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground">Add Bernard to your home screen</p>
        {isIOSSafari ? (
          <p className="text-muted-foreground mt-0.5">
            Tap the <Share className="inline h-3.5 w-3.5 mb-0.5" /> Share button at the bottom of Safari, then choose <strong>Add to Home Screen</strong>.
          </p>
        ) : (
          <p className="text-muted-foreground mt-0.5">
            Install the app for quick access — works offline and opens without the browser.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        {canNativePrompt && (
          <button
            type="button"
            onClick={prompt}
            className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
