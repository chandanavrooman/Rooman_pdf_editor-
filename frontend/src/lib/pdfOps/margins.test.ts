import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { applyMargins, inkBounds, type PageRenderer } from './margins'
import { renderPixels } from '@/test/nodeRender'

const FIX = (n: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../tests/fixtures/${n}`, import.meta.url))))
const OUT = process.env.OPS_OUT
const MM = 72 / 25.4
const SC = 4
const render: PageRenderer = async (pdf, i) => ({ ...(await renderPixels(pdf, i, SC)), scale: SC })
const margins = async (bytes: Uint8Array, i: number) => {
  const r = await render(bytes, i)
  const b = inkBounds(r)!
  const W = r.width / SC
  const H = r.height / SC
  return { W, H, left: b.x0, right: W - b.x1, top: b.y0, bottom: H - b.y1 }
}
const fmt = (v: number) => `${v.toFixed(2)}pt (${(v / MM).toFixed(2)}mm)`

describe('1 margins: same on all sides, page size kept, content centred', () => {
  it('chandana-report.pdf, 10 mm, measured from the visible content', async () => {
    const src = FIX('chandana-report.pdf')
    const before = await margins(src, 0)
    const out = await applyMargins(src, { marginPt: 10 * MM, fitToContent: true, render }, undefined)
    const after = await margins(out, 0)
    const size = (await PDFDocument.load(out)).getPage(0).getSize()
    const srcSize = (await PDFDocument.load(src)).getPage(0).getSize()
    console.info(`page size before ${srcSize.width.toFixed(2)}×${srcSize.height.toFixed(2)} after ${size.width.toFixed(2)}×${size.height.toFixed(2)}`)
    console.info(`BEFORE  L ${fmt(before.left)}  R ${fmt(before.right)}  T ${fmt(before.top)}  B ${fmt(before.bottom)}`)
    console.info(`AFTER   L ${fmt(after.left)}  R ${fmt(after.right)}  T ${fmt(after.top)}  B ${fmt(after.bottom)}`)
    if (OUT) {
      mkdirSync(OUT, { recursive: true })
      writeFileSync(OUT + '/margins-chandana.pdf', out)
    }
    expect(size.width).toBeCloseTo(srcSize.width, 2)
    expect(size.height).toBeCloseTo(srcSize.height, 2)
    expect(Math.abs(after.left - after.right)).toBeLessThan(0.6) // centred horizontally
    expect(Math.abs(after.top - after.bottom)).toBeLessThan(0.6) // centred vertically: no blank area at the bottom only
    expect(Math.min(after.left, after.right, after.top, after.bottom)).toBeGreaterThan(10 * MM - 0.6) // never inside the margin
    expect(Math.abs(after.left - 10 * MM)).toBeLessThan(0.6) // the limiting side is exactly the margin
  })

  it('three-pages.pdf: every page, 15 mm, content measured', async () => {
    const src = FIX('three-pages.pdf')
    const out = await applyMargins(src, { marginPt: 15 * MM, fitToContent: true, render })
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(3)
    for (let i = 0; i < 3; i++) {
      const a = await margins(out, i)
      const sz = doc.getPage(i).getSize()
      console.info(`page ${i + 1}: size ${sz.width.toFixed(2)}×${sz.height.toFixed(2)}  L ${a.left.toFixed(2)} R ${a.right.toFixed(2)} T ${a.top.toFixed(2)} B ${a.bottom.toFixed(2)} pt`)
      expect(sz.width).toBeCloseTo(595.28, 1)
      expect(sz.height).toBeCloseTo(841.89, 1)
      expect(Math.abs(a.left - a.right)).toBeLessThan(0.6)
      expect(Math.abs(a.top - a.bottom)).toBeLessThan(0.6)
      expect(Math.min(a.left, a.right, a.top, a.bottom)).toBeGreaterThan(15 * MM - 0.6)
    }
    if (OUT) writeFileSync(OUT + '/margins-three.pdf', out)
  })

  it('whole-page mode (not measuring content): the page area is scaled into the box and centred', async () => {
    const src = FIX('three-pages.pdf')
    const before = await margins(src, 0)
    const m = 20 * MM
    const out = await applyMargins(src, { marginPt: m, fitToContent: false })
    const after = await margins(out, 0)
    const s = Math.min((before.W - 2 * m) / before.W, (before.H - 2 * m) / before.H)
    const offX = m + (before.W - 2 * m - before.W * s) / 2
    const offY = m + (before.H - 2 * m - before.H * s) / 2
    console.info(`scale ${s.toFixed(4)}; expected L ${(offX + before.left * s).toFixed(2)} T ${(offY + before.top * s).toFixed(2)}; got L ${after.left.toFixed(2)} T ${after.top.toFixed(2)}`)
    expect(Math.abs(after.left - (offX + before.left * s))).toBeLessThan(0.6)
    expect(Math.abs(after.top - (offY + before.top * s))).toBeLessThan(0.6)
    expect(Math.abs(after.right - (offX + before.right * s))).toBeLessThan(0.6)
    expect(Math.abs(after.bottom - (offY + before.bottom * s))).toBeLessThan(0.6)
  })

  it('refuses a margin that leaves no room', async () => {
    await expect(applyMargins(FIX('three-pages.pdf'), { marginPt: 300, fitToContent: false })).rejects.toThrow(/leave no room/)
  })
})
