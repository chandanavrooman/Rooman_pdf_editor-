import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdirSync } from 'node:fs'
import { PDFDocument, StandardFonts, rgb, grayscale, cmyk, setCharacterSpacing, pushGraphicsState, popGraphicsState } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pageTextBoxes, type SnapItem } from './textSnap'
import { renderPixels } from '@/test/nodeRender'

const STD = fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).split(String.fromCharCode(92)).join('/')
const OUT = process.env.OPS_OUT
const SC = 4

/** one big line per colour space, each on its own row */
async function makePdf() {
  const d = await PDFDocument.create()
  const reg = await d.embedFont(StandardFonts.HelveticaBold) // heavy, so a solid core of the exact colour exists
  const obl = await d.embedFont(StandardFonts.HelveticaBoldOblique)
  const plain = await d.embedFont(StandardFonts.Helvetica)
  const ital = await d.embedFont(StandardFonts.HelveticaOblique)
  const p = d.addPage([595, 842])
  const row = (i: number) => 780 - i * 56
  p.drawText('Gray half', { x: 40, y: row(0), size: 40, font: reg, color: grayscale(0.5) })
  p.drawText('RGB orange', { x: 40, y: row(1), size: 40, font: reg, color: rgb(0.9, 0.4, 0.05) })
  p.drawText('CMYK cyan', { x: 40, y: row(2), size: 40, font: reg, color: cmyk(1, 0, 0, 0) })
  p.drawText('CMYK red', { x: 40, y: row(3), size: 40, font: reg, color: cmyk(0, 1, 1, 0) })
  p.drawText('CMYK black', { x: 40, y: row(4), size: 40, font: reg, color: cmyk(0, 0, 0, 1) })
  p.drawText('Half opaque blue', { x: 40, y: row(5), size: 40, font: reg, color: rgb(0, 0, 1), opacity: 0.5 })
  p.pushOperators(pushGraphicsState(), setCharacterSpacing(4))
  p.drawText('Spaced out', { x: 40, y: row(6), size: 30, font: plain, color: rgb(0.1, 0.1, 0.1) })
  p.pushOperators(popGraphicsState())
  p.drawText('Regular line', { x: 40, y: row(7), size: 30, font: plain, color: rgb(0.1, 0.1, 0.1) })
  p.drawText('Italic line', { x: 40, y: row(8), size: 30, font: ital, color: rgb(0.1, 0.1, 0.1) })
  p.drawText('Bold italic line', { x: 40, y: row(9), size: 30, font: obl, color: rgb(0.1, 0.1, 0.1) })
  return d.save()
}

describe('color spaces, opacity and font style are read from the PDF itself', () => {
  it('the editor reports exactly what pdf.js paints (DeviceGray / RGB / CMYK, opacity), and bold / italic only from the font', async () => {
    const bytes = await makePdf()
    if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(OUT + '/color-spaces.pdf', bytes) }
    const doc = (await pdfjs.getDocument({ data: bytes.slice(0), standardFontDataUrl: STD, verbosity: 0, useSystemFonts: false, fontExtraProperties: true }).promise) as unknown as PDFDocumentProxy
    const items = await pageTextBoxes(doc, 0, { pixels: async () => null })
    const raster = await renderPixels(bytes, 0, SC)
    /** what pdf.js actually painted in the middle of the heaviest strokes of this run */
    const painted = (it: SnapItem) => {
      const o = it.origin!
      let best = [255, 255, 255]
      let bestD = -1
      for (let y = Math.floor((o.baseline - it.fontSize! * 0.7) * SC); y < Math.ceil(o.baseline * SC); y++)
        for (let x = Math.floor(o.x * SC); x < Math.ceil((o.x + o.w) * SC); x++) {
          const i = (y * raster.width + x) * 4
          const dist = 3 * 255 - (raster.data[i] + raster.data[i + 1] + raster.data[i + 2]) // distance from white
          if (dist > bestD) { bestD = dist; best = [raster.data[i], raster.data[i + 1], raster.data[i + 2]] }
        }
      return best
    }
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    console.info('line                 reported colour (opacity)   what pdf.js painted     Δ    B/I   font name')
    const rows = ['Gray half', 'RGB orange', 'CMYK cyan', 'CMYK red', 'CMYK black', 'Half opaque blue']
    for (const s of rows) {
      const it = items.find((i) => i.str === s)!
      const rep = hex(it.color!)
      const a = it.opacity ?? 1
      const shown = rep.map((v) => Math.round(v * a + 255 * (1 - a))) // colour as seen on white at that opacity
      const real = painted(it)
      const delta = Math.max(...shown.map((v, k) => Math.abs(v - real[k])))
      console.info(`${s.padEnd(20)} ${it.color} (${a})`.padEnd(46) + `rgb(${real.join(',')})`.padEnd(22) + `${String(delta).padStart(3)}   ${it.bold ? 'B' : '-'}${it.italic ? 'I' : '-'}    ${it.rawFont}`)
      expect(it.colorSource).toBe('pdf')
      expect(delta).toBeLessThanOrEqual(4)
    }
    expect(items.find((i) => i.str === 'Half opaque blue')!.opacity).toBeCloseTo(0.5, 2)
    expect(items.find((i) => i.str === 'Gray half')!.opacity).toBeUndefined()
    // bold / italic come from the font only
    const flag = (s: string) => { const it = items.find((i) => i.str === s)!; return { b: !!it.bold, i: !!it.italic, font: it.rawFont } }
    console.info('Regular line  ->', JSON.stringify(flag('Regular line')))
    console.info('Italic line   ->', JSON.stringify(flag('Italic line')))
    console.info('Bold italic   ->', JSON.stringify(flag('Bold italic line')))
    // character spacing (Tc) is read from the PDF and every run's colour comes from the PDF, never from sampling
    const sp = items.find((i) => i.str.replace(/\s+/g, '') === 'Spacedout')!
    console.info(`"Spaced out": Tc ${sp.charSpacing} pt, colour ${sp.color} (${sp.colorSource})`)
    expect(sp.charSpacing).toBe(4)
    for (const it of items) expect(it.colorSource, it.str).toBe('pdf')
    expect(flag('Regular line')).toMatchObject({ b: false, i: false })
    expect(flag('Italic line')).toMatchObject({ b: false, i: true })
    expect(flag('Bold italic line')).toMatchObject({ b: true, i: true })
    expect(flag('Gray half')).toMatchObject({ b: true, i: false })
    await doc.cleanup()
  })
})
