import { describe, expect, it } from 'vitest'
import { PDFDocument, rgb } from 'pdf-lib'
import { fitPlan, PAGE_SIZES, resizePages, targetSize } from './layout'
import { renderPixels } from '@/test/nodeRender'

const MM = 72 / 25.4
const mm = (pt: number) => Math.round(pt / MM)

/** pages of the given sizes, each entirely painted red with its number in the corner */
async function redPages(sizes: [number, number][]) {
  const d = await PDFDocument.create()
  sizes.forEach(([w, h], i) => {
    const p = d.addPage([w, h])
    p.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(1, 0, 0) })
    p.drawText('P' + (i + 1), { x: 10, y: h - 30, size: 20, color: rgb(1, 1, 1) })
  })
  return d.save()
}
async function sizesOf(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getPages().map((p) => [mm(p.getWidth()), mm(p.getHeight())])
}
const px = (r: { width: number; data: Uint8ClampedArray }, x: number, y: number) => [r.data[(y * r.width + x) * 4], r.data[(y * r.width + x) * 4 + 1], r.data[(y * r.width + x) * 4 + 2]]
const isRed = (c: number[]) => c[0] > 200 && c[1] < 60 && c[2] < 60
const isWhite = (c: number[]) => c.every((v) => v > 240)

describe('paper sizes', () => {
  it('has A0-A6, Letter, Legal and Tabloid with the right millimetres', () => {
    const want: Record<string, [number, number]> = { a0: [841, 1189], a1: [594, 841], a2: [420, 594], a3: [297, 420], a4: [210, 297], a5: [148, 210], a6: [105, 148], letter: [216, 279], legal: [216, 356], tabloid: [279, 432] }
    for (const [k, [w, h]] of Object.entries(want)) {
      expect(PAGE_SIZES[k], k).toBeDefined()
      expect([mm(PAGE_SIZES[k].width), mm(PAGE_SIZES[k].height)], k).toEqual([w, h])
    }
    expect(Object.keys(PAGE_SIZES).slice(0, 7)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'])
  })
})

describe('targetSize', () => {
  const a4 = { width: 595.28, height: 841.89 }
  it('matches each page: portrait stays portrait, landscape stays landscape (square counts as portrait)', () => {
    expect(targetSize({ ...a4, autoOrient: true }, 300, 500)).toEqual([595.28, 841.89])
    expect(targetSize({ ...a4, autoOrient: true }, 500, 300)).toEqual([841.89, 595.28])
    expect(targetSize({ ...a4, autoOrient: true }, 400, 400)).toEqual([595.28, 841.89])
    // a paper size typed the "wrong" way round still gives the right sheet
    expect(targetSize({ width: 841.89, height: 595.28, autoOrient: true }, 300, 500)).toEqual([595.28, 841.89])
  })
  it('without matching: one orientation for every page, or the size exactly as given', () => {
    expect(targetSize({ ...a4, autoOrient: false, orientation: 'landscape' }, 300, 500)).toEqual([841.89, 595.28])
    expect(targetSize({ ...a4, autoOrient: false, orientation: 'portrait' }, 500, 300)).toEqual([595.28, 841.89])
    expect(targetSize({ ...a4, autoOrient: false }, 500, 300)).toEqual([595.28, 841.89])
  })
})

describe('fitPlan (the numbers shown before resizing)', () => {
  it('fit: a portrait A4 page on an A4 landscape sheet is scaled to 70.7% with white space left and right', () => {
    const p = fitPlan(595.28, 841.89, 841.89, 595.28, 'fit')
    expect(p.scale).toBeCloseTo(595.28 / 841.89, 4)
    expect(p.padY).toBeCloseTo(0, 6)
    expect(p.padX).toBeCloseTo((841.89 - 595.28 * p.scale) / 2, 4)
    expect(p.cropX).toBe(0)
    expect(p.cropY).toBe(0)
  })
  it('fill: the same page covers the landscape sheet and about half of its height is cropped', () => {
    const p = fitPlan(595.28, 841.89, 841.89, 595.28, 'fill')
    expect(p.scale).toBeCloseTo(841.89 / 595.28, 4)
    expect(p.padX).toBe(0)
    expect(p.padY).toBe(0)
    expect(p.cropX).toBe(0)
    expect(p.cropY).toBeGreaterThan(0.49)
    expect(p.cropY).toBeLessThan(0.51)
  })
  it('same shape: nothing added, nothing cropped, in both modes', () => {
    for (const m of ['fit', 'fill'] as const) {
      const p = fitPlan(210, 297, 420, 594, m)
      expect(p.scale).toBeCloseTo(2, 6)
      expect([p.padX, p.padY, p.cropX, p.cropY]).toEqual([0, 0, 0, 0])
    }
  })
})

describe('resizePages', () => {
  it('automatic orientation on a mixed document: every sheet is the paper size, turned to match its page', async () => {
    const src = await redPages([[400, 600], [600, 400], [300, 700], [800, 500]])
    const out = await resizePages(src, { width: PAGE_SIZES.a4.width, height: PAGE_SIZES.a4.height, mode: 'fit', autoOrient: true })
    expect(await sizesOf(out)).toEqual([[210, 297], [297, 210], [210, 297], [297, 210]])
  })
  it('a chosen orientation for all pages when matching is off', async () => {
    const src = await redPages([[400, 600], [600, 400]])
    const land = await resizePages(src, { width: PAGE_SIZES.a3.width, height: PAGE_SIZES.a3.height, mode: 'fit', autoOrient: false, orientation: 'landscape' })
    expect(await sizesOf(land)).toEqual([[420, 297], [420, 297]])
    const port = await resizePages(src, { width: PAGE_SIZES.a3.width, height: PAGE_SIZES.a3.height, mode: 'fit', autoOrient: false, orientation: 'portrait' })
    expect(await sizesOf(port)).toEqual([[297, 420], [297, 420]])
  })
  it('works for every paper size from A0 to A6', async () => {
    const src = await redPages([[500, 700]])
    for (const k of ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6']) {
      const out = await resizePages(src, { width: PAGE_SIZES[k].width, height: PAGE_SIZES[k].height, mode: 'fit', autoOrient: true })
      expect((await sizesOf(out))[0], k).toEqual([mm(PAGE_SIZES[k].width), mm(PAGE_SIZES[k].height)])
    }
  })
  it('fit shows the whole page with white space; fill covers the whole sheet (checked on real pixels)', async () => {
    // a tall 1:2 red page onto an A4 portrait sheet (1:1.414)
    const src = await redPages([[300, 600]])
    const fit = await renderPixels(await resizePages(src, { width: PAGE_SIZES.a4.width, height: PAGE_SIZES.a4.height, mode: 'fit', autoOrient: true }), 0, 1)
    const fill = await renderPixels(await resizePages(src, { width: PAGE_SIZES.a4.width, height: PAGE_SIZES.a4.height, mode: 'fill', autoOrient: true }), 0, 1)
    const mid = Math.floor(fit.height / 2)
    // fit: red in the middle, white strip at the left and right edge, full height used
    expect(isRed(px(fit, Math.floor(fit.width / 2), mid))).toBe(true)
    expect(isWhite(px(fit, 3, mid))).toBe(true)
    expect(isWhite(px(fit, fit.width - 4, mid))).toBe(true)
    expect(isRed(px(fit, Math.floor(fit.width / 2), 3))).toBe(true) // touches top and bottom
    expect(isRed(px(fit, Math.floor(fit.width / 2), fit.height - 4))).toBe(true)
    // fill: red everywhere, even in the four corners
    for (const [x, y] of [[2, 2], [fill.width - 3, 2], [2, fill.height - 3], [fill.width - 3, fill.height - 3], [Math.floor(fill.width / 2), Math.floor(fill.height / 2)]]) expect(isRed(px(fill, x, y)), x + ',' + y).toBe(true)
  })
  it('only the selected pages are resized; the others are copied through unchanged', async () => {
    const src = await redPages([[500, 700], [500, 700], [500, 700], [500, 700]])
    const out = await resizePages(src, { width: PAGE_SIZES.a5.width, height: PAGE_SIZES.a5.height, mode: 'fit', autoOrient: true, pages: [2, 4] })
    const orig = (await PDFDocument.load(src)).getPages().map((p) => [p.getWidth(), p.getHeight()])
    const sizes = (await PDFDocument.load(out)).getPages().map((p) => [p.getWidth(), p.getHeight()])
    expect(sizes).toHaveLength(4)
    expect(sizes[0]).toEqual(orig[0]) // untouched
    expect(sizes[2]).toEqual(orig[2])
    expect(mm(sizes[1][0])).toBe(148) // resized to A5
    expect(mm(sizes[3][0])).toBe(148)
  })
  it('rejects pages that do not exist, an empty choice and a bad size', async () => {
    const src = await redPages([[500, 700], [500, 700]])
    const base = { width: 595, height: 842, mode: 'fit', autoOrient: true } as const
    await expect(resizePages(src, { ...base, pages: [3] })).rejects.toThrow(/Page 3 does not exist/)
    await expect(resizePages(src, { ...base, pages: [] })).rejects.toThrow(/at least one page/)
    await expect(resizePages(src, { ...base, width: 5 })).rejects.toThrow(/larger than 10/)
    await expect(resizePages(src, { ...base, width: 20000 })).rejects.toThrow(/not supported/)
  })
})
