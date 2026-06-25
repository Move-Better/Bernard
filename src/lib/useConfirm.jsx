import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { ConfirmDialog } from '@/components/ui/alert-dialog'

// Promise-based confirm() backed by the styled AlertDialog, replacing native
// window.confirm() (grey OS chrome, off-brand). Mount <ConfirmProvider> once near
// the app root; then in any component:
//
//   const confirm = useConfirm()
//   if (!(await confirm({ title: 'Delete this clip?', description: '…' }))) return
//
// Resolves true on confirm, false on cancel / dismiss. Destructive styling is the
// default (these are almost always deletes); pass destructive:false to opt out.
const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [opts, setOpts] = useState(null)
  const resolverRef = useRef(null)

  const confirm = useCallback((options) => (
    new Promise((resolve) => {
      resolverRef.current = resolve
      setOpts(options || {})
    })
  ), [])

  const settle = useCallback((result) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setOpts(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={opts != null}
        onOpenChange={(open) => { if (!open) settle(false) }}
        title={opts?.title || 'Are you sure?'}
        description={opts?.description}
        confirmLabel={opts?.confirmLabel}
        cancelLabel={opts?.cancelLabel}
        destructive={opts?.destructive ?? true}
        onConfirm={() => settle(true)}
      />
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return ctx
}
