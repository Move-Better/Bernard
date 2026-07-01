// "Your voice clone" card on the Voice tab of Staff Profile.
//
// States derived from the staff row:
//   - opted_out:   voice_clone_opt_out = true  → hard lock, no training
//   - has_clone:   eleven_voice_id set + voice_clone_revoked_at IS NULL
//   - had_clone:   voice_clone_revoked_at IS NOT NULL (offers re-clone path)
//   - never_clone: neither — first-time CTA
//
// The "Allow voice cloning" switch at the bottom is the self-serve opt-out lock
// (CLAUDE.md: hard prohibition). Turning it OFF auto-deletes any existing clone
// (confirm dialog) and blocks future training; turning it back ON re-enables it.
//
// Owner-only — gated upstream in StaffProfile.

import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { Mic, Sparkles, ShieldOff, Loader2, Volume2, Square } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { apiFetch } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queries'
import { toast } from '@/lib/toast'
import { useConfirm } from '@/lib/useConfirm'
import { createTtsPlayer, primeAudioPlayback } from '@/lib/tts'

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return '' }
}

// Phoneme-varied script read back through the clone so a drifted or
// low-fidelity clone is easy to catch by ear before it ships in real content.
const SAMPLE_SCRIPT =
  "Hi, this is a quick sample of my cloned voice. The quick brown fox jumps over " +
  "the lazy dog, and a well-planned treatment plan takes patience, precision, and care. " +
  "If this doesn't sound like me, it's time to retrain."

export default function VoiceCloneCard({ staffMember }) {
  const queryClient = useQueryClient()
  const [revoking, setRevoking] = useState(false)
  const [togglingLock, setTogglingLock] = useState(false)
  const [sampleState, setSampleState] = useState('idle') // idle | loading | playing
  const confirm = useConfirm()
  const ttsRef = useRef(null)

  useEffect(() => {
    return () => {
      try { ttsRef.current?.cancel?.() } catch { /* noop */ }
    }
  }, [])

  const optedOut = !!staffMember?.voice_clone_opt_out
  const hasClone = !!staffMember?.eleven_voice_id && !staffMember?.voice_clone_revoked_at
  const hadClone = !!staffMember?.voice_clone_revoked_at && !staffMember?.eleven_voice_id
  const consentAt = staffMember?.voice_clone_consent_at

  const onRevoke = async () => {
    if (!staffMember?.id) return
    if (!(await confirm({
      title: 'Revoke this voice clone?',
      description: 'The voice will be deleted from ElevenLabs and content will stop using it.',
      confirmLabel: 'Revoke',
    }))) return
    setRevoking(true)
    try {
      await apiFetch('/api/voice-clone/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: staffMember.id }),
      })
      // Invalidate the staff cache so the card flips state.
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.all })
      toast.success('Voice clone revoked.')
    } catch (e) {
      toast.error(e?.message || 'Revoke failed.')
    } finally {
      setRevoking(false)
    }
  }

  const onPlaySample = () => {
    if (sampleState === 'playing' || sampleState === 'loading') {
      try { ttsRef.current?.cancel?.() } catch { /* noop */ }
      setSampleState('idle')
      return
    }
    if (!ttsRef.current) ttsRef.current = createTtsPlayer()
    // iOS audio-unlock — must run inside this click handler.
    primeAudioPlayback()
    setSampleState('loading')
    ttsRef.current.speak(SAMPLE_SCRIPT, {
      staffId: staffMember?.id,
      onStart: () => setSampleState('playing'),
      onEnd:   () => setSampleState('idle'),
      onError: () => {
        setSampleState('idle')
        toast.error('Could not play sample.')
      },
    })
  }

  // Switch represents "Allow voice cloning" → checked = NOT opted out.
  // `allow` is the new desired value of that switch.
  const onToggleAllow = async (allow) => {
    if (!staffMember?.id) return
    const optOut = !allow
    // Only the destructive direction (locking + deleting an existing clone)
    // needs a confirm. Re-enabling, or locking with no clone, is silent.
    if (optOut && hasClone) {
      if (!(await confirm({
        title: 'Turn off voice cloning?',
        description: 'This deletes your trained voice from ElevenLabs and stops any content from using it. You can train a new clone later if you turn this back on.',
        confirmLabel: 'Turn off & delete',
      }))) return
    }
    setTogglingLock(true)
    try {
      await apiFetch('/api/voice-clone/opt-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: staffMember.id, optOut }),
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.all })
      toast.success(optOut ? 'Voice cloning turned off.' : 'Voice cloning turned back on.')
    } catch (e) {
      toast.error(e?.message || 'Could not update your preference.')
    } finally {
      setTogglingLock(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
            optedOut ? 'bg-destructive/10 text-destructive' : hasClone ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}>
            {optedOut ? <ShieldOff className="h-5 w-5" /> : hasClone ? <Sparkles className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold">{optedOut ? 'Voice cloning is off' : 'Your voice clone'}</div>
            <div className="text-sm text-muted-foreground">
              {optedOut
                ? "You've turned off voice cloning for your account. Bernard can't create or use a clone of your voice."
                : hasClone
                ? 'Active. Bernard can narrate content in your voice.'
                : hadClone
                ? 'Revoked. You can train a new clone any time.'
                : 'Not trained yet. Read a short passage and Bernard can speak in your voice.'}
            </div>
          </div>
        </div>

        {!optedOut && hasClone && consentAt && (
          <div className="text-xs text-muted-foreground pl-13">
            Created {fmtDate(consentAt)}.
          </div>
        )}

        {optedOut ? (
          <div className="text-xs text-muted-foreground leading-relaxed rounded-lg bg-muted/60 border border-border px-3 py-2.5">
            Training is disabled while this is off. Turn it back on any time to train a new clone — your past content keeps the written voice model; only the audio clone is affected.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {hasClone ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={onPlaySample}>
                  {sampleState === 'loading' ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Loading…</>
                  ) : sampleState === 'playing' ? (
                    <><Square className="h-4 w-4 mr-1" fill="currentColor" /> Stop</>
                  ) : (
                    <><Volume2 className="h-4 w-4 mr-1" /> Play sample</>
                  )}
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to="/settings/voice-training">Re-train</Link>
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={onRevoke} disabled={revoking} className="text-destructive hover:text-destructive/80 hover:bg-destructive/10">
                  {revoking ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Revoking…</>
                  ) : (
                    <><ShieldOff className="h-4 w-4 mr-1" /> Revoke</>
                  )}
                </Button>
              </>
            ) : (
              <Button asChild size="sm">
                <Link to="/settings/voice-training">
                  <Sparkles className="h-4 w-4 mr-1" />
                  {hadClone ? 'Train a new clone' : 'Train my voice'}
                </Link>
              </Button>
            )}
          </div>
        )}

        {/* Opt-out lock — self-serve "do not clone my voice" */}
        <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-border">
          <div className="min-w-0">
            <div className="text-sm font-medium">Allow voice cloning</div>
            <div className="text-xs text-muted-foreground">
              {optedOut ? 'Currently off.' : 'Let Bernard create & use a clone of your voice.'}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {togglingLock && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Switch
              checked={!optedOut}
              disabled={togglingLock}
              onCheckedChange={onToggleAllow}
              aria-label="Allow voice cloning"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
