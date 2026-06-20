import { useEffect, useRef, useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { Pipette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useWorkspace } from '@/lib/WorkspaceContext'

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

function normalize(hex) {
  if (!hex) return '#000000'
  const v = hex.trim()
  return v.startsWith('#') ? v : `#${v}`
}

export function ColorPickerPopover({ value, onChange, swatchClassName = 'h-8 w-12', ariaLabel = 'Pick color', extraSwatches = [] }) {
  const workspace = useWorkspace?.() ?? null
  const brandStyle = workspace?.brand_style || {}
  const brandSwatches = [...new Set([
    ...(brandStyle.primary_colors || []),
    ...(brandStyle.secondary_colors || []),
    ...(brandStyle.accent_color ? [brandStyle.accent_color] : []),
    ...extraSwatches,
  ])]

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(normalize(value))
  const [hexInput, setHexInput] = useState(normalize(value))
  // True while the native EyeDropper is open, so Radix's close-on-interact-
  // outside doesn't dismiss the popover (and reset the draft) mid-pick.
  const eyedroppingRef = useRef(false)

  // When closed, re-sync draft to the committed value. Radix fires onOpenChange
  // (false) on Escape / outside-click, so this also gives "cancel on dismiss".
  useEffect(() => {
    if (!open) {
      setDraft(normalize(value))
      setHexInput(normalize(value))
    }
  }, [value, open])

  function commit() {
    onChange(draft.toUpperCase())
    setOpen(false)
  }

  function cancel() {
    setDraft(normalize(value))
    setHexInput(normalize(value))
    setOpen(false)
  }

  function onHexInputChange(e) {
    const v = e.target.value
    setHexInput(v)
    if (HEX_RE.test(v)) setDraft(normalize(v))
  }

  const eyeDropperSupported = typeof window !== 'undefined' && 'EyeDropper' in window

  async function pickWithEyeDropper() {
    if (!eyeDropperSupported) return
    eyedroppingRef.current = true
    try {
      const result = await new window.EyeDropper().open()
      if (result?.sRGBHex) {
        setDraft(result.sRGBHex)
        setHexInput(result.sRGBHex)
      }
    } catch {
      // user cancelled — no-op
    } finally {
      eyedroppingRef.current = false
    }
  }

  const guardEyedropper = (e) => { if (eyedroppingRef.current) e.preventDefault() }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={`${swatchClassName} rounded border cursor-pointer block`}
          style={{ background: normalize(value) }}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[232px] p-3"
        onInteractOutside={guardEyedropper}
        onFocusOutside={guardEyedropper}
        onPointerDownOutside={guardEyedropper}
      >
        {brandSwatches.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {brandSwatches.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => { setDraft(normalize(c)); setHexInput(normalize(c)) }}
                className="w-6 h-6 rounded border border-border hover:scale-110 transition-transform shrink-0"
                style={{ background: c }}
              />
            ))}
          </div>
        )}
        <HexColorPicker color={draft} onChange={(c) => { setDraft(c); setHexInput(c) }} style={{ width: '100%', height: 160 }} />
        <div className="mt-2 flex items-center gap-2">
          <div className="h-7 w-9 rounded border shrink-0" style={{ background: draft }} />
          <input
            value={hexInput}
            onChange={onHexInputChange}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
            className="flex h-7 w-full rounded-md border bg-background px-2 text-xs font-mono"
            placeholder="#000000"
            spellCheck={false}
          />
          {eyeDropperSupported && (
            <button
              type="button"
              onClick={pickWithEyeDropper}
              title="Pick color from screen"
              aria-label="Pick color from screen"
              className="h-7 w-7 rounded border flex items-center justify-center hover:bg-accent shrink-0"
            >
              <Pipette className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-2xs" onClick={cancel}>Cancel</Button>
          <Button size="sm" className="h-7 text-2xs" onClick={commit}>Done</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
