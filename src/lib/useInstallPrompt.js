import { useState, useEffect } from 'react'

const DISMISSED_KEY = 'pwa-install-dismissed'

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

function isIOSSafari() {
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window)
  // Safari on iOS — excludes Chrome/Firefox on iOS (they use a different UA)
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua)
  return isIOS && isSafari
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISSED_KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    function onBeforeInstall(e) {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  // Hide after a successful install
  useEffect(() => {
    function onInstalled() { setDismissed(true) }
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  async function prompt() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') setDeferredPrompt(null)
  }

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, '1') } catch { /* non-critical */ }
    setDismissed(true)
  }

  const standalone = isStandaloneMode()
  const ios = isIOSSafari()

  return {
    // Show banner when: not already installed, not dismissed, and either
    // the browser supports the prompt OR we're on iOS Safari (manual tip).
    showBanner: !standalone && !dismissed && (!!deferredPrompt || ios),
    canNativePrompt: !!deferredPrompt,
    isIOSSafari: ios,
    prompt,
    dismiss,
  }
}
