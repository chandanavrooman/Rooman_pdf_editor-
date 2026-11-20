import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { COLOR_PRESETS, hexToRgb255, hsvToHex, normalizeHex, presetName, readableOn, rgbToHex, rgbToHsv, sameColor, type Hsv } from '@/lib/color'

/**
 * THE colour picker of Rooman PDF. Every colour setting in the app uses it (tool options, the editor's property bar and text toolbar).
 *
 *  - `value` / `onChange` carry lowercase '#rrggbb' strings, so a tool receives exactly the colour that was picked.
 *  - Compact by default: ten preset colours, a HEX box with a copy button and a live preview. "More colours" opens a spectrum,
 *    a hue slider and RGB boxes.
 *  - `variant="field"` is a labelled form control (swatch + HEX); `variant="swatch"` is just the swatch, for toolbars.
 *  - The popover lives in a portal, so no clipped or scrolling parent can cut it off, and it stays inside the window.
 */
export interface ColorPickerProps {
  value: string
  onChange: (hex: string) => void
  /** accessible name of the control, e.g. "Border colour" */
  label: string
  variant?: 'field' | 'swatch'
  /** id for the trigger button (so a visible <label htmlFor> can point at it) */
  id?: string
  testId?: string
  disabled?: boolean
}

const PANEL_W = 264

function useCurrent(value: string): string {
  return normalizeHex(value) ?? '#000000'
}

export function ColorPicker({ value, onChange, label, variant = 'field', id, testId, disabled }: ColorPickerProps) {
  const current = useCurrent(value)
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const dialogId = useId()

  const place = useCallback(() => {
    const t = trigger.current
    const p = panel.current
    if (!t || !p) return
    const r = t.getBoundingClientRect()
    const w = p.offsetWidth
    const h = p.offsetHeight
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8))
    let top = r.bottom + 6
    if (top + h > window.innerHeight - 8) top = r.top - h - 6 > 8 ? r.top - h - 6 : Math.max(8, window.innerHeight - h - 8)
    setPos((old) => (old && old.left === left && old.top === top ? old : { left, top }))
  }, [])

  // position the panel, and keep it in place when the page scrolls or the window changes size
  useLayoutEffect(() => {
    if (!open) return
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  // close on a click outside or on Escape
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const n = e.target as Node
      if (!panel.current?.contains(n) && !trigger.current?.contains(n)) setOpen(false)
    }
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
  }, [open])

  const close = (refocus = true) => {
    setOpen(false)
    setPos(null)
    if (refocus) trigger.current?.focus()
  }

  const triggerButton =
    variant === 'swatch' ? (
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${current.toUpperCase()}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        data-testid={testId}
        title={label}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="h-7 w-8 shrink-0 rounded-md border border-ink-300 bg-white p-0.5 transition hover:border-brand-500 disabled:opacity-50 dark:border-ink-600 dark:bg-ink-900"
      >
        <span className="block h-full w-full rounded-[3px] ring-1 ring-inset ring-black/15" style={{ background: current }} />
      </button>
    ) : (
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${current.toUpperCase()}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        data-testid={testId}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="flex h-10 items-center gap-2 rounded-lg border border-ink-300 bg-white pl-1.5 pr-2.5 text-sm transition hover:border-brand-500 disabled:opacity-50 dark:border-ink-700 dark:bg-ink-950"
      >
        <span className="h-7 w-7 shrink-0 rounded-md ring-1 ring-inset ring-black/15" style={{ background: current }} />
        <span className="font-mono text-xs tracking-wide">{current.toUpperCase()}</span>
        <ChevronDown className={`h-4 w-4 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
    )

  return (
    <>
      {triggerButton}
      {open &&
        createPortal(
          <Panel
            ref={panel}
            id={dialogId}
            label={label}
            value={current}
            onChange={(hex) => onChange(hex)}
            onClose={() => close()}
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
            onResize={place}
          />,
          document.body,
        )}
    </>
  )
}

const Panel = forwardRef<HTMLDivElement, { id: string; label: string; value: string; onChange: (hex: string) => void; onClose: () => void; style: CSSProperties; onResize: () => void }>(function Panel({ id, label, value, onChange, onClose, style, onResize }, ref) {
  const [text, setText] = useState(value.toUpperCase())
  const [bad, setBad] = useState(false)
  const [copied, setCopied] = useState(false)
  const [more, setMore] = useState(false)
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(hexToRgb255(value)!))
  const hexFocused = useRef(false)
  const swatches = useRef<(HTMLButtonElement | null)[]>([])
  const rgb = hexToRgb255(value)!

  // follow outside changes of the value (a preset click, the field above, undo ...), keeping the hue of a grey
  useEffect(() => {
    if (!hexFocused.current) setText(value.toUpperCase())
    setBad(false)
    setHsv((h) => (sameColor(hsvToHex(h), value) ? h : rgbToHsv(hexToRgb255(value)!)))
  }, [value])

  // the panel grows when "More colours" opens: re-place it so it stays on screen
  useLayoutEffect(() => onResize(), [more, onResize])

  const pick = (hex: string) => onChange(hex.toLowerCase())
  const fromHsv = (next: Hsv) => {
    setHsv(next)
    pick(hsvToHex(next))
  }

  const typeHex = (raw: string) => {
    setText(raw.toUpperCase())
    const n = normalizeHex(raw)
    setBad(raw.trim() !== '' && !n)
    if (n) pick(n)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value.toUpperCase())
    } catch {
      const t = document.createElement('textarea')
      t.value = value.toUpperCase()
      t.style.position = 'fixed'
      t.style.opacity = '0'
      document.body.appendChild(t)
      t.select()
      document.execCommand('copy')
      t.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  // arrow keys move between the preset swatches
  const swatchKey = (e: ReactKeyboardEvent, i: number) => {
    const n = COLOR_PRESETS.length
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? 5 : e.key === 'ArrowUp' ? -5 : 0
    if (!step) return
    e.preventDefault()
    swatches.current[(i + step + n) % n]?.focus()
  }

  // keep Tab inside the panel, and keep keystrokes away from the editor behind it (arrows would nudge a selected object)
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const items = [...(e.currentTarget.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]') ?? [])].filter((x) => !x.hasAttribute('disabled'))
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const name = presetName(value)
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label={label}
      data-testid="color-picker"
      className="fixed z-[200] rounded-2xl border border-ink-200 bg-white p-3 shadow-xl ring-1 ring-black/5 dark:border-ink-700 dark:bg-ink-900 dark:ring-white/5"
      style={{ ...style, width: `min(${PANEL_W}px, calc(100vw - 16px))` }}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
      onKeyDown={onKeyDown}
    >
      {/* preview */}
      <div className="mb-3 flex items-center gap-3">
        <span className="h-11 w-11 shrink-0 rounded-xl ring-1 ring-inset ring-black/15" style={{ background: value }} data-testid="color-preview" aria-hidden="true" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold leading-tight">{name ?? 'Custom colour'}</p>
          <p className="font-mono text-xs text-ink-500 dark:text-ink-400" data-testid="color-current">
            {value.toUpperCase()}
          </p>
        </div>
      </div>

      {/* presets */}
      <div className="grid grid-cols-5 gap-2" role="group" aria-label="Preset colours">
        {COLOR_PRESETS.map((p, i) => {
          const on = sameColor(p.hex, value)
          return (
            <button
              key={p.hex}
              ref={(el) => {
                swatches.current[i] = el
              }}
              type="button"
              aria-label={`${p.name} ${p.hex.toUpperCase()}`}
              aria-pressed={on}
              title={`${p.name} ${p.hex.toUpperCase()}`}
              data-testid={`preset-${p.name.toLowerCase().replace(/\s+/g, '-')}`}
              onClick={() => pick(p.hex)}
              onKeyDown={(e) => swatchKey(e, i)}
              className={`flex h-8 w-full items-center justify-center rounded-lg ring-1 ring-inset ring-black/15 transition hover:scale-105 ${on ? 'outline-2 outline-offset-2 outline-brand-500 dark:outline-brand-300' : ''}`}
              style={{ background: p.hex, outlineStyle: on ? 'solid' : undefined }}
            >
              {on && <Check className="h-4 w-4" style={{ color: readableOn(p.hex) }} aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      {/* hex */}
      <div className="mt-3">
        <label htmlFor={`${id}-hex`} className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
          HEX
        </label>
        <div className="flex gap-2">
          <input
            id={`${id}-hex`}
            data-testid="color-hex"
            className={`input !py-1.5 font-mono text-sm uppercase ${bad ? '!border-red-500' : ''}`}
            value={text}
            maxLength={8}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={bad}
            aria-describedby={bad ? `${id}-hexerr` : undefined}
            onFocus={() => (hexFocused.current = true)}
            onBlur={() => {
              hexFocused.current = false
              setText(value.toUpperCase()) // an unfinished or invalid entry goes back to the colour in use
              setBad(false)
            }}
            onChange={(e) => typeHex(e.target.value)}
          />
          <button type="button" className="btn-secondary btn-sm !px-2.5" onClick={copy} aria-label="Copy HEX value" title="Copy HEX value" data-testid="color-copy">
            {copied ? <Check className="h-4 w-4 text-brand-600" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        <p id={`${id}-hexerr`} role={bad ? 'alert' : undefined} className={`mt-1 text-xs ${bad ? 'font-medium text-red-600 dark:text-red-400' : 'sr-only'}`}>
          {bad ? 'Not a colour yet. Use 3 or 6 digits, like #1A9A8A.' : copied ? 'Copied' : ''}
        </p>
      </div>

      {/* advanced */}
      <button type="button" className="mt-2 flex w-full items-center justify-between rounded-lg px-1 py-1 text-xs font-medium text-brand-700 hover:bg-ink-50 dark:text-brand-300 dark:hover:bg-ink-800" aria-expanded={more} aria-controls={`${id}-more`} onClick={() => setMore((m) => !m)} data-testid="color-more">
        More colours
        <ChevronDown className={`h-4 w-4 transition-transform ${more ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {more && (
        <div id={`${id}-more`} className="mt-2 space-y-3" data-testid="color-advanced">
          <SpectrumArea hsv={hsv} onChange={fromHsv} />
          <div>
            <label htmlFor={`${id}-hue`} className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
              Hue
            </label>
            <input
              id={`${id}-hue`}
              data-testid="color-hue"
              type="range"
              min={0}
              max={360}
              step={1}
              value={Math.round(hsv.h)}
              onChange={(e) => fromHsv({ ...hsv, h: Number(e.target.value) })}
              className="h-3 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:shadow [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow"
              style={{ background: 'linear-gradient(to right,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)' }}
            />
          </div>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="RGB values">
            {(['r', 'g', 'b'] as const).map((k) => (
              <RgbBox key={k} channel={k} value={rgb[k]} onCommit={(n) => pick(rgbToHex(k === 'r' ? n : rgb.r, k === 'g' ? n : rgb.g, k === 'b' ? n : rgb.b))} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

/** One RGB number (0-255). Typing only commits a complete valid number; leaving the box puts the real value back. */
function RgbBox({ channel, value, onCommit }: { channel: 'r' | 'g' | 'b'; value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(String(value))
  }, [value])
  const bad = text !== '' && !(/^\d{1,3}$/.test(text) && Number(text) <= 255)
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
        {channel.toUpperCase()}
      </label>
      <input
        id={id}
        data-testid={`color-${channel}`}
        className={`input !px-2 !py-1.5 text-center text-sm tabular-nums ${bad ? '!border-red-500' : ''}`}
        inputMode="numeric"
        value={text}
        aria-invalid={bad}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false
          setText(String(value))
        }}
        onChange={(e) => {
          setText(e.target.value)
          if (/^\d{1,3}$/.test(e.target.value) && Number(e.target.value) <= 255) onCommit(Number(e.target.value))
        }}
      />
    </div>
  )
}

/** Saturation (left to right) and brightness (bottom to top) for the current hue. Drag it, or use the arrow keys (Shift = bigger steps). */
function SpectrumArea({ hsv, onChange }: { hsv: Hsv; onChange: (h: Hsv) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const set = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect()
    const s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))
    onChange({ h: hsv.h, s, v })
  }
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    set(e)
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) set(e)
  }
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const d = e.shiftKey ? 0.1 : 0.01
    const dx = e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0
    const dy = e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0
    if (!dx && !dy) return
    e.preventDefault()
    onChange({ h: hsv.h, s: Math.max(0, Math.min(1, hsv.s + dx)), v: Math.max(0, Math.min(1, hsv.v + dy)) })
  }
  return (
    <div
      ref={box}
      role="slider"
      tabIndex={0}
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsv.s * 100)}
      aria-valuetext={`Saturation ${Math.round(hsv.s * 100)} percent, brightness ${Math.round(hsv.v * 100)} percent`}
      data-testid="color-spectrum"
      className="relative h-32 w-full cursor-crosshair touch-none rounded-lg ring-1 ring-inset ring-black/15"
      style={{ background: `linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,hsl(${Math.round(hsv.h)},100%,50%))` }}
      onPointerDown={down}
      onPointerMove={move}
      onKeyDown={key}
    >
      <span className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/30" style={{ left: `${hsv.s * 100}%`, bottom: `${hsv.v * 100}%` }} />
    </div>
  )
}
