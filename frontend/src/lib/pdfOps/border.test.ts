import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument, degrees } from 'pdf-lib'
import { addBorder, dashPattern } from './border'
import { inkBounds } from './margins'
import { renderPixels } from '@/test/nodeRender'

const FIX = (n: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../tests/fixtures/${n}`, import.meta.url))))
const OUT = process.env.OPS_OUT
const MM = 72 / 25.4
const SC = 8
const RED = { r: 220 / 255, g: 38 / 255, b: 38 / 255 }
const BLUE = { r: 37 / 255, g: 99 / 255, b: 235 / 255 }

async function blank(rotation = 0, pages = 1) {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    const p = d.addPage([595.28, 841.89])
    if (rotation) p.setRotation(degrees(rotation))
  }
  return d.save()
}
const raster = (b: Uint8Array, i = 0) => renderPixels(b, i, SC)
const isInk = (r: { data: Uint8ClampedArray; width: number }, x: number, y: number) => {
  const k = (y * r.width + x) * 4
  return r.data[k] < 240 || r.data[k + 1] < 240 || r.data[k + 2] < 240
}

describe('2 border: relative to the page box, even on all four sides, fully inside', () => {
  it('solid, 8 mm from the edge, 3 pt, red: identical distance and thickness on all four sides', async () => {
    const out = await addBorder(await blank(), { insetPt: 8 * MM, thicknessPt: 3, color: RED, style: 'solid' })
    const r = await raster(out)
    const b = inkBounds({ ...r, scale: SC })!
    const W = r.width / SC
    const H = r.height / SC
    const m = { left: b.x0, right: W - b.x1, top: b.y0, bottom: H - b.y1 }
    // thickness along the middle of every side
    const run = (x: number, y: number, dx: number, dy: number) => { let n = 0; while (isInk(r, x, y)) { n++; x += dx; y += dy } ; return n / SC }
    const cx = Math.floor(r.width / 2)
    const cy = Math.floor(r.height / 2)
    const t = { left: run(Math.round(b.x0 * SC), cy, 1, 0), right: run(Math.round(b.x1 * SC) - 1, cy, -1, 0), top: run(cx, Math.round(b.y0 * SC), 0, 1), bottom: run(cx, Math.round(b.y1 * SC) - 1, 0, -1) }
    const px = (x: number, y: number) => [r.data[(y * r.width + x) * 4], r.data[(y * r.width + x) * 4 + 1], r.data[(y * r.width + x) * 4 + 2]]
    console.info(`distance from page edge  L ${m.left.toFixed(2)}  R ${m.right.toFixed(2)}  T ${m.top.toFixed(2)}  B ${m.bottom.toFixed(2)} pt   (asked ${(8 * MM).toFixed(2)})`)
    console.info(`thickness                L ${t.left.toFixed(2)}  R ${t.right.toFixed(2)}  T ${t.top.toFixed(2)}  B ${t.bottom.toFixed(2)} pt   (asked 3)`)
    console.info(`colour at the centre of the top edge: rgb(${px(cx, Math.round((b.y0 + 1.5) * SC)).join(',')}) (asked 220,38,38)`)
    for (const v of Object.values(m)) expect(Math.abs(v - 8 * MM)).toBeLessThan(0.2)
    for (const v of Object.values(t)) expect(Math.abs(v - 3)).toBeLessThan(0.25)
    expect(px(cx, Math.round((b.y0 + 1.5) * SC))).toEqual([220, 38, 38])
    if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(OUT + '/border-solid.pdf', out) }
  })

  it('dashed, 6 mm, 2 pt, blue: every side starts and ends with a dash, equal dashes, solid corners', async () => {
    const out = await addBorder(await blank(), { insetPt: 6 * MM, thicknessPt: 2, color: BLUE, style: 'dashed' })
    const r = await raster(out)
    const a = Math.round(6 * MM * SC)
    const mid = Math.round(a + 1 * SC) // centre line of the stroke
    const runsAlong = (horizontal: boolean, fixed: number) => {
      const runs: { ink: boolean; len: number }[] = []
      const n = horizontal ? r.width : r.height
      for (let i = 0; i < n; i++) {
        const ink = horizontal ? isInk(r, i, fixed) : isInk(r, fixed, i)
        if (!runs.length || runs[runs.length - 1].ink !== ink) runs.push({ ink, len: 0 })
        runs[runs.length - 1].len++
      }
      return runs.filter((x, i, all) => !(i === 0 && !x.ink) && !(i === all.length - 1 && !x.ink)) // drop the white page margin before / after
    }
    const sides = {
      top: runsAlong(true, mid),
      bottom: runsAlong(true, r.height - 1 - mid),
      left: runsAlong(false, mid),
      right: runsAlong(false, r.width - 1 - mid),
    }
    for (const [name, runs] of Object.entries(sides)) {
      const dashes = runs.filter((x) => x.ink).map((x) => x.len / SC)
      const gaps = runs.filter((x) => !x.ink).map((x) => x.len / SC)
      // ignore the corner squares (first / last dash is longer by the square)
      const inner = dashes.slice(1, -1)
      console.info(`${name.padEnd(6)} ${dashes.length} dashes, inner dash ${Math.min(...inner).toFixed(2)}–${Math.max(...inner).toFixed(2)} pt, gap ${Math.min(...gaps).toFixed(2)}–${Math.max(...gaps).toFixed(2)} pt; first run ink: ${runs[0].ink}, last run ink: ${runs[runs.length - 1].ink}`)
      expect(runs[0].ink).toBe(true)
      expect(runs[runs.length - 1].ink).toBe(true)
      expect(Math.max(...inner) - Math.min(...inner)).toBeLessThan(0.4)
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.4)
    }
    // corners are solid squares
    for (const [x, y] of [[a + 4, a + 4], [r.width - a - 5, a + 4], [a + 4, r.height - a - 5], [r.width - a - 5, r.height - a - 5]]) expect(isInk(r, x, y)).toBe(true)
    // the dash pattern is the same on opposite sides
    expect(sides.top.length).toBe(sides.bottom.length)
    expect(sides.left.length).toBe(sides.right.length)
    if (OUT) writeFileSync(OUT + '/border-dashed.pdf', out)
  })

  it('works on a rotated page: the border is on the sides the user sees', async () => {
    const out = await addBorder(await blank(90), { insetPt: 10 * MM, thicknessPt: 2, color: RED, style: 'solid' })
    const r = await raster(out)
    const b = inkBounds({ ...r, scale: SC })!
    const W = r.width / SC
    const H = r.height / SC
    console.info(`rotated 90°: page shown as ${W.toFixed(1)}×${H.toFixed(1)}; margins L ${b.x0.toFixed(2)} R ${(W - b.x1).toFixed(2)} T ${b.y0.toFixed(2)} B ${(H - b.y1).toFixed(2)} (asked ${(10 * MM).toFixed(2)})`)
    for (const v of [b.x0, W - b.x1, b.y0, H - b.y1]) expect(Math.abs(v - 10 * MM)).toBeLessThan(0.2)
  })

  it('selected pages only: other pages are not touched', async () => {
    const src = FIX('three-pages.pdf')
    const out = await addBorder(src, { insetPt: 5 * MM, thicknessPt: 1.5, color: RED, style: 'solid', pages: [2] })
    const before = [await raster(src, 0), await raster(src, 1), await raster(src, 2)]
    const after = [await raster(out, 0), await raster(out, 1), await raster(out, 2)]
    const same = (x: typeof before[0], y: typeof before[0]) => x.data.every((v, i) => v === y.data[i])
    console.info(`page 1 unchanged: ${same(before[0], after[0])}, page 2 changed: ${!same(before[1], after[1])}, page 3 unchanged: ${same(before[2], after[2])}`)
    expect(same(before[0], after[0])).toBe(true)
    expect(same(before[1], after[1])).toBe(false)
    expect(same(before[2], after[2])).toBe(true)
  })

  it('refuses nonsense and a border that does not fit', async () => {
    await expect(addBorder(await blank(), { insetPt: 5, thicknessPt: 0, color: RED, style: 'solid' })).rejects.toThrow(/thickness/)
    await expect(addBorder(await blank(), { insetPt: 400, thicknessPt: 5, color: RED, style: 'solid' })).rejects.toThrow(/does not fit/)
    expect(dashPattern(500, 2).dash).toBeGreaterThan(0)
  })
})
