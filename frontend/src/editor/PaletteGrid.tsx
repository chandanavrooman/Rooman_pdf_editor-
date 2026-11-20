import { useState } from 'react'
import { Code2, Crosshair } from 'lucide-react'

/** Sejda-style swatch grid: seven colour families from dark to light, then black-to-white greys. */
export const PALETTE: string[][] = [
  ['#01579B', '#0277BD', '#0288D1', '#039BE5', '#03A9F4', '#29B6F6', '#4FC3F7', '#81D4FA', '#B3E5FC', '#E1F5FE'], // blue
  ['#1B5E20', '#2E7D32', '#388E3C', '#43A047', '#4CAF50', '#66BB6A', '#81C784', '#A5D6A7', '#C8E6C9', '#E8F5E9'], // green
  ['#F57C00', '#F9A825', '#FBC02D', '#FDD835', '#FFEB3B', '#FFEE58', '#FFF176', '#FFF59D', '#FFF9C4', '#FFFDE7'], // orange to yellow
  ['#B71C1C', '#C62828', '#D32F2F', '#E53935', '#F44336', '#EF5350', '#E57373', '#EF9A9A', '#FFCDD2', '#FFEBEE'], // red
  ['#4A148C', '#6A1B9A', '#7B1FA2', '#8E24AA', '#9C27B0', '#AB47BC', '#BA68C8', '#CE93D8', '#E1BEE7', '#F3E5F5'], // purple
  ['#3E2723', '#4E342E', '#5D4037', '#6D4C41', '#795548', '#8D6E63', '#A1887F', '#BCAAA4', '#D7CCC8', '#EFEBE9'], // brown
  ['#000000', '#212121', '#424242', '#616161', '#757575', '#9E9E9E', '#BDBDBD', '#E0E0E0', '#EEEEEE', '#FFFFFF'], // grey
]

const KEY = 'rooman.customColors'
const SLOTS = 8
const HEX = /^#?([0-9a-fA-F]{6})$/

export function loadCustomColors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, SLOTS) : []
  } catch {
    return []
  }
}
export function rememberCustomColor(hex: string): string[] {
  const next = [hex, ...loadCustomColors().filter((c) => c.toLowerCase() !== hex.toLowerCase())].slice(0, SLOTS)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private window: the colours are just not remembered */
  }
  return next
}

const cell = 'h-5 w-5 border border-ink-200 transition hover:scale-110 hover:border-ink-500 focus-visible:outline-2 focus-visible:outline-brand-500 dark:border-ink-700'

/** The palette popup: pick a swatch, type a hex code (&lt;/&gt;), use the eyedropper, or reuse one of your own colours. */
export function PaletteGrid({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  const [custom, setCustom] = useState<string[]>(loadCustomColors)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState(value)
  const dropper = typeof window !== 'undefined' && 'EyeDropper' in window
  const pickCustom = (hex: string) => {
    setCustom(rememberCustomColor(hex))
    onPick(hex)
  }
  const apply = () => {
    const m = HEX.exec(text.trim())
    if (m) pickCustom(`#${m[1].toUpperCase()}`)
  }
  return (
    <div data-testid="palette" className="w-[220px] p-1.5">
      <div className="grid grid-cols-10 gap-px" role="group" aria-label="Colours">
        {PALETTE.flat().map((c) => (
          <button key={c} type="button" aria-label={c} title={c} data-testid="swatch" aria-pressed={c.toLowerCase() === value.toLowerCase()} className={`${cell} ${c.toLowerCase() === value.toLowerCase() ? 'outline outline-2 outline-brand-500' : ''}`} style={{ background: c }} onClick={() => onPick(c)} />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-10 gap-px">
        <button type="button" aria-label="Type a colour code" title="Type a colour code (hex)" data-testid="palette-hex" aria-pressed={typing} className={`${cell} flex items-center justify-center bg-white dark:bg-ink-800 [&>svg]:h-3.5 [&>svg]:w-3.5`} onClick={() => setTyping((v) => !v)}>
          <Code2 />
        </button>
        <button
          type="button"
          aria-label="Pick a colour from the page"
          title={dropper ? 'Pick a colour from the page' : 'Your browser has no eyedropper'}
          data-testid="palette-dropper"
          disabled={!dropper}
          className={`${cell} flex items-center justify-center bg-white disabled:opacity-40 dark:bg-ink-800 [&>svg]:h-3.5 [&>svg]:w-3.5`}
          onClick={async () => {
            try {
              const r = await new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper().open()
              pickCustom(r.sRGBHex.toUpperCase())
            } catch {
              /* cancelled */
            }
          }}
        >
          <Crosshair />
        </button>
        {Array.from({ length: SLOTS }, (_, i) =>
          custom[i] ? (
            <button key={i} type="button" aria-label={`Your colour ${custom[i]}`} title={custom[i]} data-testid="custom-swatch" className={cell} style={{ background: custom[i] }} onClick={() => onPick(custom[i])} />
          ) : (
            <span key={i} className={`${cell} bg-white dark:bg-ink-800`} aria-hidden="true" />
          ),
        )}
      </div>
      {typing && (
        <form
          className="mt-1.5 flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            apply()
          }}
        >
          <input aria-label="Colour code" data-testid="palette-hex-input" className="input !w-24 !px-1.5 !py-0.5 text-xs uppercase" value={text} onChange={(e) => setText(e.target.value)} placeholder="#RRGGBB" maxLength={7} spellCheck={false} />
          <button type="submit" className="btn-secondary btn-sm !px-2 !py-0.5 text-xs" disabled={!HEX.test(text.trim())}>
            Use
          </button>
        </form>
      )}
    </div>
  )
}
