import { describe, expect, it } from 'vitest'
import { overlappedText, overlapWarning } from './overlap'
import { makeField, makeShape, DEFAULTS } from './objects'
import type { SnapItem } from './textSnap'

const run = (str: string, x: number, y: number, w: number, h = 12): SnapItem => ({ str, box: { x, y, w, h } })
const items = [run('Dashboard, Universal App Switcher, Theme Kit, Accessibility audits (WCAG', 212, 190, 318), run('Books', 64, 300, 30)]

describe('4(a) covering existing content always warns', () => {
  it('a text field over a line of text', () => {
    const f = makeField('text', 0, { x: 400, y: 188, w: 160, h: 24 }, 'text_1')
    const msg = overlapWarning(f, overlappedText(f, items))
    expect(msg).toMatch(/Text field covers existing text: “Dashboard, Universal App Switcher, T…”/)
    expect(msg).toMatch(/Undo/)
  })
  it('a big rectangle outline over the page says it sits over the text', () => {
    const r = makeShape('rect', 0, { x: 13, y: 50, w: 567, h: 577 }, { ...DEFAULTS.shape, fill: null })
    const msg = overlapWarning(r, overlappedText(r, items))
    expect(msg).toMatch(/Rectangle sits over existing text/)
    expect(msg).toMatch(/Books/)
  })
  it('a filled box says covers', () => {
    const r = makeShape('rect', 0, { x: 60, y: 295, w: 100, h: 30 }, { ...DEFAULTS.shape, fill: '#ffffff' })
    expect(overlapWarning(r, overlappedText(r, items))).toMatch(/Rectangle covers existing text: “Books”/)
  })
  it('empty space gives no warning, and a graze of under 10% does not either', () => {
    const f = makeField('text', 0, { x: 400, y: 600, w: 100, h: 24 }, 'text_2')
    expect(overlapWarning(f, overlappedText(f, items))).toBeNull()
    const graze = makeField('text', 0, { x: 64, y: 311, w: 100, h: 24 }, 'text_3') // 1pt into a 12pt-tall run
    expect(overlapWarning(graze, overlappedText(graze, items))).toBeNull()
  })
})
