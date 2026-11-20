import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import { alternateMix, flipPages, splitInHalf } from './pageTools'
import { planText } from '../splitPlan'

async function make(labels: string[], size: [number, number] = [200, 100], rotate = 0): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const f = await d.embedFont(StandardFonts.Helvetica)
  for (const l of labels) {
    const p = d.addPage(size)
    p.drawText(l, { x: 10, y: 40, size: 12, font: f })
    if (rotate) p.setRotation(degrees(rotate))
  }
  return d.save()
}

describe('alternateMix', () => {
  it('takes pages in turn and appends the rest', async () => {
    const out = await PDFDocument.load(await alternateMix(await make(['a1', 'a2', 'a3']), await make(['b1', 'b2'])))
    expect(out.getPageCount()).toBe(5)
  })
  it('reverses the second file when asked (order checked through page sizes)', async () => {
    const a = await make(['a1', 'a2'], [100, 100])
    const b = await PDFDocument.create()
    b.addPage([300, 100])
    b.addPage([400, 100])
    const out = await PDFDocument.load(await alternateMix(a, await b.save(), { reverseB: true }))
    expect(out.getPages().map((p) => p.getWidth())).toEqual([100, 400, 100, 300])
  })
})

describe('splitInHalf', () => {
  it('cuts a landscape page into two portrait halves, left first', async () => {
    const out = await PDFDocument.load(await splitInHalf(await make(['x']), { direction: 'auto' }))
    expect(out.getPageCount()).toBe(2)
    const [l, r] = out.getPages()
    expect(l.getCropBox()).toMatchObject({ x: 0, width: 100, height: 100 })
    expect(r.getCropBox()).toMatchObject({ x: 100, width: 100, height: 100 })
  })
  it('cuts top then bottom and leaves unchosen pages alone', async () => {
    const out = await PDFDocument.load(await splitInHalf(await make(['x', 'y'], [100, 200]), { direction: 'horizontal', pages: [1] }))
    expect(out.getPageCount()).toBe(3)
    const [top, bottom, other] = out.getPages()
    expect(top.getCropBox()).toMatchObject({ y: 100, height: 100 })
    expect(bottom.getCropBox()).toMatchObject({ y: 0, height: 100 })
    expect(other.getHeight()).toBe(200)
  })
  it('works on a rotated page (visual halves)', async () => {
    const out = await PDFDocument.load(await splitInHalf(await make(['x'], [200, 100], 90), { direction: 'vertical' }))
    expect(out.getPageCount()).toBe(2)
    for (const p of out.getPages()) expect(p.getRotation().angle).toBe(90)
  })
})

describe('flipPages', () => {
  it('keeps page count and size, and mirrors only the chosen pages', async () => {
    const bytes = await flipPages(await make(['x', 'y']), { axis: 'horizontal', pages: [2] })
    const out = await PDFDocument.load(bytes)
    expect(out.getPageCount()).toBe(2)
    expect(out.getPage(1).getSize()).toEqual({ width: 200, height: 100 })
  })
  it('keeps blank pages (no content) instead of failing', async () => {
    const d = await PDFDocument.create()
    d.addPage([200, 100])
    const out = await PDFDocument.load(await flipPages(await d.save(), { axis: 'horizontal' }))
    expect(out.getPageCount()).toBe(1)
  })
  it('rejects pages outside the document', async () => {
    await expect(flipPages(await make(['x']), { axis: 'vertical', pages: [3] })).rejects.toThrow(/between 1 and 1/)
  })
})

describe('planText', () => {
  const texts = ['cover', 'Invoice no. 1 ...', 'details', 'invoice NO. 2', 'end']
  it('starts a part at every matching page, ignoring case by default', () => {
    const p = planText('invoice no.', false, texts, 5)
    expect(p.ok && p.parts.map((x) => [x.start, x.end])).toEqual([[1, 1], [2, 3], [4, 5]])
  })
  it('can match case', () => {
    const p = planText('Invoice', true, texts, 5)
    expect(p.ok && p.parts.map((x) => [x.start, x.end])).toEqual([[1, 1], [2, 5]])
  })
  it('explains when nothing matches', () => {
    const p = planText('zzz', false, texts, 5)
    expect(!p.ok && p.error).toMatch(/No page contains/)
  })
})
