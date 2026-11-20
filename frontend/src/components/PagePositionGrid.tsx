import { useId } from 'react'
import type { Position } from '@/lib/pdfOps/stamp'

const ROWS: Position['v'][] = ['top', 'bottom']
const COLS: Position['h'][] = ['left', 'center', 'right']
const NAMES: Record<string, string> = {
  'top-left': 'Top left',
  'top-center': 'Top centre',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-center': 'Bottom centre',
  'bottom-right': 'Bottom right',
}

/**
 * Where on the page the text goes: a 3 × 2 grid, each choice a little page with the text drawn where it will land.
 * Native radio buttons underneath, so it works with the keyboard (arrow keys) and screen readers.
 */
export function PagePositionGrid({ value, onChange, legend = 'Position', what = 'the number' }: { value: Position; onChange: (p: Position) => void; legend?: string; what?: string }) {
  const name = useId()
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="grid max-w-sm grid-cols-3 gap-2" data-testid="position-grid">
        {ROWS.flatMap((v) =>
          COLS.map((h) => {
            const key = `${v}-${h}`
            const on = value.v === v && value.h === h
            return (
              <label
                key={key}
                className={`relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-1 py-2.5 text-center text-xs font-medium transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500 ${
                  on ? 'border-brand-500 bg-brand-50 text-brand-800 shadow-sm dark:border-brand-400 dark:bg-brand-900/30 dark:text-brand-100' : 'border-ink-200 text-ink-600 hover:border-ink-300 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800/60'
                }`}
              >
                <input type="radio" name={name} className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" checked={on} onChange={() => onChange({ v, h })} aria-label={`${NAMES[key]}: put ${what} at the ${NAMES[key].toLowerCase()} of the page`} data-testid={`pos-${key}`} />
                {/* the miniature page */}
                <span className="relative block h-[58px] w-[42px] rounded-[3px] bg-white shadow-sm ring-1 ring-ink-300 dark:ring-ink-500" aria-hidden="true">
                  {[11, 17, 23, 29, 35].map((top, i) => (
                    <span key={top} className="absolute left-[7px] block h-[2px] rounded-full bg-ink-200 dark:bg-ink-300" style={{ top, right: i === 4 ? 17 : 7 }} />
                  ))}
                  <span
                    className={`absolute block h-[4px] w-[10px] rounded-[1px] ${on ? 'bg-brand-600' : 'bg-ink-500'}`}
                    style={{ [v]: 4, ...(h === 'left' ? { left: 4 } : h === 'right' ? { right: 4 } : { left: 16 }) }}
                  />
                </span>
                {NAMES[key]}
              </label>
            )
          }),
        )}
      </div>
    </fieldset>
  )
}
