import type { Margins } from './margins'

export const MM_TO_PT = 72 / 25.4

export type MarginMode = 'equal' | 'individual'
export interface MarginInput {
  mode: MarginMode
  equal: string
  top: string
  bottom: string
  left: string
  right: string
}
export type MarginErrors = Partial<Record<'equal' | 'top' | 'bottom' | 'left' | 'right', string>> & { general?: string }
export interface MarginCheck {
  /** the margins in points when every value is acceptable */
  margins: Margins | null
  errors: MarginErrors
}

const SIDES = ['top', 'bottom', 'left', 'right'] as const
const mm = (n: number) => (Math.round(n * 10) / 10).toString()

/** What the user typed -> margins in points, or a message per field. `smallest` is the smallest page (in mm) the margins must fit on. */
export function checkMargins(input: MarginInput, smallest?: { widthMm: number; heightMm: number }): MarginCheck {
  const errors: MarginErrors = {}
  const keys = input.mode === 'equal' ? (['equal'] as const) : SIDES
  const value: Record<string, number> = {}
  for (const k of keys) {
    const raw = (input[k] ?? '').trim()
    const label = k === 'equal' ? 'The margin' : `The ${k} margin`
    if (raw === '') errors[k] = `${label} is empty. Enter a number of millimetres.`
    else if (!/^[+]?(\d+\.?\d*|\.\d+)$/.test(raw)) errors[k] = /^-/.test(raw) ? `${label} cannot be negative.` : `${label} must be a number, like 10 or 12.5.`
    else value[k] = parseFloat(raw)
  }
  if (Object.keys(errors).length) return { margins: null, errors }
  const m = input.mode === 'equal' ? { top: value.equal, bottom: value.equal, left: value.equal, right: value.equal } : { top: value.top, bottom: value.bottom, left: value.left, right: value.right }
  if (smallest) {
    // at least 8 mm of page must be left to hold the content
    const room = 8
    if (m.left + m.right > smallest.widthMm - room) {
      const msg = `The left and right margins (${mm(m.left)} + ${mm(m.right)} mm) leave no room on a page ${mm(smallest.widthMm)} mm wide.`
      if (input.mode === 'equal') errors.equal = msg
      else errors.left = errors.right = msg
    }
    if (m.top + m.bottom > smallest.heightMm - room) {
      const msg = `The top and bottom margins (${mm(m.top)} + ${mm(m.bottom)} mm) leave no room on a page ${mm(smallest.heightMm)} mm tall.`
      if (input.mode === 'equal') errors.equal = errors.equal ?? msg
      else errors.top = errors.bottom = msg
    }
  }
  if (Object.keys(errors).length) return { margins: null, errors }
  return { margins: { top: m.top * MM_TO_PT, bottom: m.bottom * MM_TO_PT, left: m.left * MM_TO_PT, right: m.right * MM_TO_PT }, errors }
}
