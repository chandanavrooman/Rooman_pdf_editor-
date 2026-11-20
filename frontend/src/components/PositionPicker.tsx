import { useId } from 'react'
import type { Position } from '@/lib/pdfOps/stamp'

const ROWS: Position['v'][] = ['top', 'bottom']
const COLS: Position['h'][] = ['left', 'center', 'right']

/** 3×2 grid of radio buttons choosing where on the page text goes. */
export function PositionPicker({ value, onChange, legend = 'Position' }: { value: Position; onChange: (p: Position) => void; legend?: string }) {
  const name = useId()
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="inline-grid grid-cols-3 gap-1.5 rounded-xl border border-ink-200 bg-ink-50 p-2 dark:border-ink-700 dark:bg-ink-950">
        {ROWS.flatMap((v) =>
          COLS.map((h) => {
            const on = value.v === v && value.h === h
            return (
              <label key={`${v}-${h}`} className={`flex h-9 w-16 cursor-pointer items-center justify-center rounded-lg text-[11px] font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500 ${on ? 'bg-brand-600 text-white dark:bg-brand-400 dark:text-ink-950' : 'bg-white text-ink-600 hover:bg-ink-100 dark:bg-ink-800 dark:text-ink-200'}`}>
                <input type="radio" name={name} className="sr-only" checked={on} onChange={() => onChange({ v, h })} aria-label={`${v} ${h}`} />
                {v} {h[0].toUpperCase()}
              </label>
            )
          }),
        )}
      </div>
    </fieldset>
  )
}
