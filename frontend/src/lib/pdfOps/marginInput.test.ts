import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { applyMargins, inkBounds, type PageRenderer } from './margins'
import { checkMargins, MM_TO_PT, type MarginInput } from './marginInput'
import { renderPixels } from '@/test/nodeRender'

const FIX = (n: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../tests/fixtures/${n}`, import.meta.url))))
const SC = 4
const render: PageRenderer = async (pdf, i) => ({ ...(await renderPixels(pdf, i, SC)), scale: SC })
const A4 = { widthMm: 210, heightMm: 297 }
const eq = (v: string): MarginInput => ({ mode: 'equal', equal: v, top: '', bottom: '', left: '', right: '' })
const ind = (top: string, bottom: string, left: string, right: string): MarginInput => ({ mode: 'individual', equal: '', top, bottom, left, right })

describe('checkMargins: what the user types', () => {
  it('accepts a normal value and converts mm to points', () => {
    const c = checkMargins(eq('10'), A4)
    expect(c.errors).toEqual({})
    expect(c.margins!.top).toBeCloseTo(10 * MM_TO_PT, 6)
    expect(c.margins!.left).toBeCloseTo(10 * MM_TO_PT, 6)
  })
  it('accepts 0 and decimals', () => {
    expect(checkMargins(eq('0'), A4).margins).not.toBeNull()
    expect(checkMargins(eq('12.5'), A4).margins!.right).toBeCloseTo(12.5 * MM_TO_PT, 6)
    expect(checkMargins(eq('.5'), A4).margins).not.toBeNull()
  })
  it.each([['-5', /cannot be negative/], ['', /empty/], ['abc', /must be a number/], ['1e3', /must be a number/], ['5mm', /must be a number/], ['NaN', /must be a number/]])('rejects %j', (v, msg) => {
    const c = checkMargins(eq(v as string), A4)
    expect(c.margins).toBeNull()
    expect(c.errors.equal).toMatch(msg as RegExp)
  })
  it('names the side that is wrong in individual mode', () => {
    const c = checkMargins(ind('10', '-2', '10', 'x'), A4)
    expect(c.margins).toBeNull()
    expect(c.errors.bottom).toMatch(/bottom margin cannot be negative/)
    expect(c.errors.right).toMatch(/right margin must be a number/)
    expect(c.errors.top).toBeUndefined()
  })
  it('refuses margins that leave no room on the smallest page', () => {
    const c = checkMargins(eq('120'), A4)
    expect(c.margins).toBeNull()
    expect(c.errors.equal).toMatch(/leave no room on a page 210 mm wide/)
    const d = checkMargins(ind('150', '150', '5', '5'), A4)
    expect(d.errors.top).toMatch(/top and bottom margins \(150 \+ 150 mm\) leave no room on a page 297 mm tall/)
  })
})

describe('applyMargins: different margins per side, one page at a time', () => {
  it('top 30 mm, bottom 10 mm, left 20 mm, right 10 mm, measured from the visible content: the longer side touches its margin, page size kept', async () => {
    const src = FIX('chandana-report.pdf')
    const m = { top: 30 * MM_TO_PT, bottom: 10 * MM_TO_PT, left: 20 * MM_TO_PT, right: 10 * MM_TO_PT }
    const out = await applyMargins(src, { margins: m, fitToContent: true, render })
    const r = await render(out, 0)
    const b = inkBounds(r)!
    const W = r.width / SC
    const H = r.height / SC
    const got = { left: b.x0, right: W - b.x1, top: b.y0, bottom: H - b.y1 }
    const size = (await PDFDocument.load(out)).getPage(0).getSize()
    const orig = (await PDFDocument.load(src)).getPage(0).getSize()
    console.info(`asked T${(m.top / MM_TO_PT).toFixed(0)} B${(m.bottom / MM_TO_PT).toFixed(0)} L${(m.left / MM_TO_PT).toFixed(0)} R${(m.right / MM_TO_PT).toFixed(0)} mm; got T${(got.top / MM_TO_PT).toFixed(1)} B${(got.bottom / MM_TO_PT).toFixed(1)} L${(got.left / MM_TO_PT).toFixed(1)} R${(got.right / MM_TO_PT).toFixed(1)} mm`)
    expect(size.width).toBeCloseTo(orig.width, 2)
    expect(size.height).toBeCloseTo(orig.height, 2)
    // never inside a margin
    expect(got.top).toBeGreaterThan(m.top - 1)
    expect(got.bottom).toBeGreaterThan(m.bottom - 1)
    expect(got.left).toBeGreaterThan(m.left - 1)
    expect(got.right).toBeGreaterThan(m.right - 1)
    // content is centred in the area that is left, and touches it on the limiting side
    const areaW = W - m.left - m.right
    const areaH = H - m.top - m.bottom
    expect(Math.abs(got.left - m.left - (got.right - m.right))).toBeLessThan(0.8)
    expect(Math.abs(got.top - m.top - (got.bottom - m.bottom))).toBeLessThan(0.8)
    const contentW = W - got.left - got.right
    const contentH = H - got.top - got.bottom
    expect(Math.min(areaW - contentW, areaH - contentH)).toBeLessThan(1)
    // uniform scale: the aspect ratio of the content did not change
    const before = inkBounds(await render(src, 0))!
    expect((contentW / contentH) / ((before.x1 - before.x0) / (before.y1 - before.y0))).toBeCloseTo(1, 1)
  })

  it('pages: [1] returns just that page (this is what the live preview uses) and equals the same page of the full result', async () => {
    const src = FIX('three-pages.pdf')
    const opts = { marginPt: 12 * MM_TO_PT, fitToContent: false }
    const one = await applyMargins(src, { ...opts, pages: [1] })
    const all = await applyMargins(src, opts)
    expect((await PDFDocument.load(one)).getPageCount()).toBe(1)
    expect((await PDFDocument.load(all)).getPageCount()).toBe(3)
    const a = await renderPixels(one, 0, 1)
    const b = await renderPixels(all, 1, 1)
    expect(a.width).toBe(b.width)
    let diff = 0
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) diff++
    expect(diff).toBe(0)
  })

  it('rejects a page that does not exist, a negative margin and margins that cannot fit', async () => {
    const src = FIX('three-pages.pdf')
    await expect(applyMargins(src, { marginPt: 5, fitToContent: false, pages: [9] })).rejects.toThrow(/no page 10/)
    await expect(applyMargins(src, { marginPt: -1, fitToContent: false })).rejects.toThrow(/zero or more/)
    await expect(applyMargins(src, { margins: { top: 10, bottom: 10, left: 400, right: 400 }, fitToContent: false })).rejects.toThrow(/left and right margins .* leave no room on page 1/)
    await expect(applyMargins(src, { fitToContent: false })).rejects.toThrow(/zero or more/)
  })
})
