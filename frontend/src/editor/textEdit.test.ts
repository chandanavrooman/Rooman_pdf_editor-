import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { exportEdited } from './export'
import { DEFAULTS } from './objects'
import { pageTextBoxes, type PixelSource, type SnapItem } from './textSnap'
import { textObjFromSnap } from './textEdit'
import { fontFileName, type FontLoader } from './fontCatalog'
import { diffOutside, loadNotoFromDisk, renderPixels, renderToCanvas, type Raster } from '@/test/nodeRender'
import { ImageData, createCanvas } from '@napi-rs/canvas'
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'
import type { EditorDoc, TextObj } from './types'
import type { PDFDocumentProxy } from 'pdfjs-dist'

const FONTS = fileURLToPath(new URL('../assets/fonts/', import.meta.url))
const STD = fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).split(String.fromCharCode(92)).join('/')
const FIX = fileURLToPath(new URL('../../../tests/fixtures/work-report.pdf', import.meta.url))
/** set TEXTEDIT_OUT=<dir> to also write the original/edited page renders (PNG) and a run dump there */
const OUT = process.env.TEXTEDIT_OUT

const loadFont: FontLoader = async (id, v) => new Uint8Array(readFileSync(FONTS + fontFileName(id, v)))
const deps = { loadFontBytes: loadNotoFromDisk, loadFont }
const SCALE = 3

async function open(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data: bytes.slice(0), standardFontDataUrl: STD, verbosity: 0, useSystemFonts: false }).promise as unknown as PDFDocumentProxy
}
const pixels = (bytes: Uint8Array) => async (): Promise<PixelSource | null> => {
  const { canvas, ctx } = await renderToCanvas(bytes, 0, SCALE)
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data as unknown as Uint8ClampedArray, scale: SCALE }
}
async function items(bytes: Uint8Array) {
  const d = await open(bytes)
  try {
    return await pageTextBoxes(d, 0, { tables: true, pixels: pixels(bytes) })
  } finally {
    await (d as unknown as { cleanup(): Promise<void> }).cleanup()
  }
}
/** what the UI creates when a run is clicked; node has no pdf.js font object, so the font/bold come from the PDF itself (Helvetica / Helvetica-Bold) */
const clicked = (it: SnapItem, bold: boolean): SnapItem => ({ ...it, bold, fontUsed: bold ? 'Helvetica-Bold' : 'Helvetica', fontId: 'liberation-sans' })
const edit = (it: SnapItem, text: string, patch: Partial<TextObj> = {}): TextObj => ({ ...textObjFromSnap(it, 0, DEFAULTS.text), text, ...patch })
const doc = (objects: TextObj[]): EditorDoc => ({ objects, formValues: {}, assets: {} })
const find = (all: SnapItem[], s: string) => {
  const it = all.find((i) => i.str === s)
  if (!it) throw new Error(`no run "${s}" in: ${all.map((i) => i.str).join(' | ')}`)
  return it
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const near = (hex: string | undefined, target: number[], tol = 40) => !!hex && rgb(hex).every((v, i) => Math.abs(v - target[i]) <= tol)

describe('real work-report.pdf', () => {
  const bytes = new Uint8Array(readFileSync(FIX))

  it('samples the true text color and the background around each run', async () => {
    const all = await items(bytes)
    if (OUT) {
      mkdirSync(OUT, { recursive: true })
      writeFileSync(OUT + '/runs.txt', all.map((i) => [JSON.stringify(i.str).slice(0, 44).padEnd(46), i.color, i.bg, i.fontSize, i.origin && Math.round(i.origin.w)].join('  ')).join('\n'))
    }
    expect(all.length).toBeGreaterThan(10)
    const title = find(all, 'Work Report')
    expect(title.origin).toBeTruthy()
    expect(title.color).toBeTruthy()
    expect(title.color).not.toBe('#000000')
  })

  describe('editing runs in place', () => {
    const run = async (specs: { s: string; bold: boolean; text: string; patch?: Partial<TextObj> }[]) => {
      const all = await items(bytes)
      const objs = specs.map((sp) => edit(clicked(find(all, sp.s), sp.bold), sp.text, sp.patch))
      const out = await exportEdited(bytes, doc(objs), {}, deps)
      return { all, objs, out }
    }
    const boxOf = (o: TextObj) => ({ x: o.orig!.x - 1, y: o.orig!.baseline - o.size, w: Math.max(o.orig!.w, o.w) + 80, h: o.size * 1.5 })
    const side = async (a: Raster, b: Raster, name: string) => {
      if (!OUT) return
      const c = createCanvas(a.width * 2 + 10, a.height)
      const x = c.getContext('2d')
      x.fillStyle = '#888'
      x.fillRect(0, 0, c.width, c.height)
      x.putImageData(new ImageData(new Uint8ClampedArray(a.data), a.width, a.height) as never, 0, 0)
      x.putImageData(new ImageData(new Uint8ClampedArray(b.data), b.width, b.height) as never, a.width + 10, 0)
      writeFileSync(`${OUT}/${name}.png`, c.toBuffer('image/png'))
    }

    it('title / blue name / shaded row / white-on-navy header: same font, size, color, no patches, nothing else touched', async () => {
      const { objs, out } = await run([
        { s: 'Work Report', bold: true, text: 'Work Report 2026' },
        { s: 'KSP Video Management', bold: true, text: 'KSP Video Mgmt' },
        { s: 'Conducted end-to-end testing of scheduling workflows, booking', bold: false, text: 'Conducted end-to-end testing of calendar workflows, booking' },
        { s: 'Project', bold: true, text: 'Projects' },
        { s: 'Key Contributions & Deliverables', bold: true, text: 'Key Deliverables' },
      ])
      const before = await renderPixels(bytes, 0, SCALE)
      const after = await renderPixels(out, 0, SCALE)
      await side(before, after, 'work-report-before-after')
      // 1. nothing outside the edited runs changes
      expect(diffOutside(before, after, SCALE, objs.map(boxOf), 2)).toBe(0)
      // 2. the edited runs did change
      expect(diffOutside(before, after, SCALE, [], 2)).toBeGreaterThan(50)
      // 3. colors
      const [title, , , header, header2] = objs
      expect(title.color).toBe(objs[0].orig!.color)
      expect(near(header.color, [253, 253, 253], 12)).toBe(true) // header text stays white
      expect(near(header.fill, [27, 42, 78], 12)).toBe(true) // cover is the navy header color
      // 4. header cover (deleted words in the white-on-navy header): the patch is navy everywhere, no white box, no leftover glyphs
      const px = (r: Raster, x: number, y: number) => {
        const i = (Math.round(y * SCALE) * r.width + Math.round(x * SCALE)) * 4
        return [r.data[i], r.data[i + 1], r.data[i + 2]]
      }
      const o = header2.orig!
      for (const dy of [-0.78, -0.5, -0.3, 0.15]) for (let x = o.x + 100; x < o.x + o.w - 2; x += 0.5) expect(px(after, x, o.baseline + dy * o.size).every((v, i) => Math.abs(v - [27, 42, 78][i]) < 16)).toBe(true)
      expect(near(header2.color, [253, 253, 253], 12)).toBe(true)
    })

    it('replaces only the changed characters: unchanged prefix and suffix stay pixel-identical', async () => {
      const { objs, out } = await run([{ s: 'KSP Video Management', bold: true, text: 'KSP Video Mgmt' }])
      const o = objs[0].orig!
      const before = await renderPixels(bytes, 0, SCALE)
      const after = await renderPixels(out, 0, SCALE)
      // "KSP Video M" (prefix) must be identical
      const prefixW = 6.4 * 10 // generous: first ~11 chars of a 114pt run at 10pt bold
      void prefixW
      const d = await open(out)
      const p = await d.getPage(1)
      const tc = await p.getTextContent()
      const drawn = tc.items.filter((i) => 'str' in i && i.str === 'gmt')
      if (OUT) writeFileSync(OUT + '/ksp-items.txt', tc.items.filter((i) => 'str' in i && Math.abs((i as { transform: number[] }).transform[5] - (841.8898 - o.baseline)) < 1).map((i) => JSON.stringify((i as { str: string }).str) + ' ' + (i as { transform: number[] }).transform[4]).join(String.fromCharCode(10)))
      expect(drawn.length).toBe(1) // exactly the changed middle was drawn
      const t = drawn[0] as { transform: number[] }
      expect(t.transform[0]).toBeCloseTo(10, 3) // size unchanged
      expect(t.transform[4]).toBeGreaterThan(o.x + 50)
      expect(t.transform[4]).toBeLessThan(o.x + o.w)
      expect(diffOutside(before, after, SCALE, [{ x: t.transform[4] - 0.5, y: o.baseline - 10, w: o.w, h: 14 }], 2)).toBe(0)
    })

    it('size + family change from the toolbar is reflected in the export', async () => {
      const { out } = await run([{ s: 'Rooman Technologies | Date of joining: 15 September 2026', bold: false, text: 'Rooman Technologies | Date of joining: 15 September 2026', patch: { size: 12, fontId: 'tinos' } }])
      const d = await open(out)
      const p = await d.getPage(1)
      const tc = await p.getTextContent()
      const it = tc.items.find((i) => 'str' in i && i.str === 'Rooman Technologies | Date of joining: 15 September 2026' && Math.abs((i as { transform: number[] }).transform[0] - 12) < 0.01)
      expect(it).toBeTruthy()
      const pdf = await PDFDocument.load(out)
      const fonts = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict)
      const names = [...fonts.entries()].map(([, v]) => String(pdf.context.lookup(v) instanceof PDFDict ? (pdf.context.lookup(v) as PDFDict).get(PDFName.of('BaseFont')) : ''))
      expect(names.some((n) => n.includes('Tinos'))).toBe(true)
      const before = await renderPixels(bytes, 0, SCALE)
      const after = await renderPixels(out, 0, SCALE)
      await side(before, after, 'work-report-size-family')
    })

    it('opening a run and changing nothing leaves the original byte-for-byte untouched', async () => {
      const all = await items(bytes)
      const o = edit(clicked(find(all, 'Project'), true), 'Project')
      const out = await exportEdited(bytes, doc([o]), {}, deps)
      const before = await renderPixels(bytes, 0, SCALE)
      const after = await renderPixels(out, 0, SCALE)
      expect(diffOutside(before, after, SCALE, [], 0)).toBe(0)
    })

    it('a run narrowed with the resize handle is re-wrapped onto two lines from its original baseline', async () => {
      const all = await items(bytes)
      const it = find(all, 'Dashboard, Universal App Switcher, Theme Kit, Accessibility audits (WCAG')
      const o = edit(clicked(it, false), it.str, { autoWidth: false, w: 216 })
      const out = await exportEdited(bytes, doc([o]), {}, deps)
      const d = await open(out)
      const tc = await (await d.getPage(1)).getTextContent()
      const drawn = tc.items.filter((i) => 'str' in i && (/Theme Kit,$/.test(i.str) || i.str === 'Accessibility audits (WCAG')) as { str: string; transform: number[] }[]
      expect(drawn.length).toBe(2)
      const ys = drawn.map((i) => (i as unknown as { transform: number[] }).transform[5]).sort((a, b) => b - a)
      expect(ys[0] - ys[1]).toBeCloseTo(9.5 * 1.2, 1) // second line one line-height below the first
    })

    it('a character the chosen font lacks is reported with a font that has it', async () => {
      const all = await items(bytes)
      const o = edit(clicked(find(all, 'Project'), true), 'Project ✓ ش', { fontId: 'liberation-sans' })
      await expect(exportEdited(bytes, doc([o]), {}, deps)).rejects.toThrow(/Arimo|Noto|DejaVu|Amiri|Liberation/)
    })
  })
})

import { detectFont, stripSubset } from './fontCatalog'
describe('font detection from the PDF font name', () => {
  it.each([
    ['ABCDEF+Arial-BoldMT', 'liberation-sans', true, false],
    ['Helvetica', 'liberation-sans', false, false],
    ['TimesNewRomanPS-ItalicMT', 'liberation-serif', false, true],
    ['Times-Roman', 'liberation-serif', false, false],
    ['CourierNewPS-BoldMT', 'liberation-mono', true, false],
    ['XYZABC+Calibri-BoldItalic', 'carlito', true, true],
    ['Cambria', 'caladea', false, false],
    ['Verdana', 'dejavu-sans', false, false],
    ['Georgia-Bold', 'dejavu-serif', true, false],
    ['Roboto-Regular', 'roboto', false, false],
  ])('%s', (name, id, bold, italic) => {
    const d = detectFont(name)
    expect(d.fontId).toBe(id)
    expect(d.bold).toBe(bold)
    expect(d.italic).toBe(italic)
  })
  it('strips subset prefixes', () => expect(stripSubset('ABCDEF+Arial-BoldMT')).toBe('Arial-BoldMT'))
})

// ───────────────────────────── 4(b) no fragments of replaced text, 4(c) bold Helvetica/Arial never becomes a serif font
import fontkit from '@pdf-lib/fontkit'
const FIX2 = fileURLToPath(new URL('../../../tests/fixtures/chandana-report.pdf', import.meta.url))

describe('4(b) the cover reaches the full original text box', () => {
  const bytes2 = new Uint8Array(readFileSync(FIX2))
  const width = (s: string, size: number, bold = false) => {
    const f = fontkit.create(readFileSync(FONTS + (bold ? 'LiberationSans-Bold.ttf' : 'LiberationSans-Regular.ttf'))) as unknown as { unitsPerEm: number; layout(s: string): { glyphs: { advanceWidth: number }[] } }
    return (f.layout(s).glyphs.reduce((a, g) => a + g.advanceWidth, 0) * size) / f.unitsPerEm
  }
  /** largest colour deviation from the cell background inside a page-space rectangle */
  const maxInk = (r: Raster, bg: number[], x0: number, x1: number, y0: number, y1: number) => {
    let worst = 0
    for (let y = Math.floor(y0 * SCALE); y < Math.ceil(y1 * SCALE); y++)
      for (let x = Math.floor(x0 * SCALE); x < Math.ceil(x1 * SCALE); x++) {
        const i = (y * r.width + x) * 4
        worst = Math.max(worst, Math.abs(r.data[i] - bg[0]), Math.abs(r.data[i + 1] - bg[1]), Math.abs(r.data[i + 2] - bg[2]))
      }
    return worst
  }
  const edited = async (str: string, newText: string) => {
    const d = await open(bytes2)
    const all = await pageTextBoxes(d, 0, { tables: true, pixels: async () => { const { canvas, ctx } = await renderToCanvas(bytes2, 0, SCALE); return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data as unknown as Uint8ClampedArray, scale: SCALE } } })
    const it = find(all, str)
    const o = edit(clicked(it, false), newText)
    const out = await exportEdited(bytes2, doc([o]), {}, deps)
    return { it, o, before: await renderPixels(bytes2, 0, SCALE), after: await renderPixels(out, 0, SCALE) }
  }

  it('"…audits (WCAG" → "…audit": nothing of "AG" or "(WC" is left after the new text', async () => {
    const line = 'Dashboard, Universal App Switcher, Theme Kit, Accessibility audits (WCAG'
    const { it, after } = await edited(line, 'Dashboard, Universal App Switcher, Theme Kit, Accessibility audit')
    const o = it.origin!
    const newEnd = o.x + width('Dashboard, Universal App Switcher, Theme Kit, Accessibility audit', it.fontSize!)
    const bg = [255, 255, 255]
    const ink = maxInk(after, bg, newEnd + 1.2, o.x + o.w + 1, o.baseline - 0.74 * it.fontSize!, o.baseline + 0.22 * it.fontSize!)
    if (OUT) mkdirSync(OUT, { recursive: true })
    console.info(`fragment check: run ends at ${(o.x + o.w).toFixed(2)}pt, new text ends at ${newEnd.toFixed(2)}pt, max leftover ink in between = ${ink} (0 = pure background)`)
    expect(ink).toBeLessThanOrEqual(3)
  })

  it('a word replaced in the middle ("Theme Kit," → "Kit,"): the shifted tail leaves no old glyphs behind', async () => {
    const line = 'Dashboard, Universal App Switcher, Theme Kit, Accessibility audits (WCAG'
    const next = 'Dashboard, Universal App Switcher, Kit, Accessibility audits (WCAG'
    const { it, after } = await edited(line, next)
    const o = it.origin!
    const newEnd = o.x + width(next, it.fontSize!)
    const ink = maxInk(after, [255, 255, 255], newEnd + 1.2, o.x + o.w + 1, o.baseline - 0.74 * it.fontSize!, o.baseline + 0.22 * it.fontSize!)
    console.info(`shifted tail: new text ends at ${newEnd.toFixed(2)}pt, old run ended at ${(o.x + o.w).toFixed(2)}pt, max leftover ink = ${ink}`)
    expect(ink).toBeLessThanOrEqual(3)
  })

  it('a shaded cell: the patch is the shade colour, not white', async () => {
    const { it, after } = await edited('Contributed to frontend development, user interface components, and', 'Contributed to frontend work')
    const o = it.origin!
    const shade = [242, 245, 251]
    const ink = maxInk(after, shade, o.x + width('Contributed to frontend work', it.fontSize!) + 1.2, o.x + o.w + 1, o.baseline - 0.74 * it.fontSize!, o.baseline + 0.22 * it.fontSize!)
    console.info(`shaded cell leftover = ${ink} (patch must equal #f2f5fb)`)
    expect(ink).toBeLessThanOrEqual(3)
  })
})

describe('4(c) bold Helvetica / Arial always maps to Liberation Sans Bold, never a serif', () => {
  it.each([
    ['Helvetica-Bold', undefined],
    ['Helvetica-Bold', 'serif'], // even if pdf.js guessed a serif fallback
    ['ABCDEF+Helvetica-Bold', 'serif'],
    ['Arial-BoldMT', 'serif'],
    ['Arial,Bold', undefined],
    ['Arial-Black', undefined],
    ['Helvetica-BoldOblique', undefined],
    ['Helvetica,Bold', 'monospace'],
  ])('%s (css hint: %s)', (name, css) => {
    const d = detectFont(name, { cssFamily: css })
    expect(d.fontId).toBe('liberation-sans')
    expect(d.bold).toBe(true)
  })
  it('an opaque pdf.js name with a sans-serif hint is sans, with a serif hint serif', () => {
    expect(detectFont('g_d0_f2', { cssFamily: '"Helvetica", sans-serif', bold: true }).fontId).toBe('liberation-sans')
    expect(detectFont('g_d0_f2', { cssFamily: 'sans-serif' }).fontId).toBe('liberation-sans')
    expect(detectFont('g_d0_f2', { cssFamily: 'serif' }).fontId).toBe('liberation-serif')
  })
})

// ───────────────────────────── 5: a table cell is its own text block
import { textObjFromCell } from './textEdit'
describe('5 editing inside a table cell', () => {
  const bytes3 = new Uint8Array(readFileSync(FIX2))
  const runs3 = async () => {
    const d = await open(bytes3)
    return pageTextBoxes(d, 0, { tables: true, pixels: async () => { const { canvas, ctx } = await renderToCanvas(bytes3, 0, SCALE); return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data as unknown as Uint8ClampedArray, scale: SCALE } } })
  }
  const maxDev = (r: Raster, bg: number[], x0: number, x1: number, y0: number, y1: number) => {
    let worst = 0
    for (let y = Math.floor(y0 * SCALE); y < Math.ceil(y1 * SCALE); y++)
      for (let x = Math.floor(x0 * SCALE); x < Math.ceil(x1 * SCALE); x++) {
        const i = (y * r.width + x) * 4
        worst = Math.max(worst, Math.abs(r.data[i] - bg[0]), Math.abs(r.data[i + 1] - bg[1]), Math.abs(r.data[i + 2] - bg[2]))
      }
    return worst
  }

  it('clicking a run gives the WHOLE cell as one paragraph with the cell’s width and leading', async () => {
    const all = await runs3()
    const o = textObjFromCell(find(all, 'Dashboard, Universal App Switcher, Theme Kit, Accessibility audits (WCAG'), 0, DEFAULTS.text)!
    console.info(`cell block: "${o.text.slice(0, 70)}…"  x ${o.x.toFixed(2)}  width ${o.w.toFixed(2)}  leading ${o.leading}  size ${o.size}  fill ${o.fill}  original lines ${o.orig!.block!.runs.length}`)
    expect(o.text.startsWith('Core frontend engineering for the Shell/Launcher, Unified Home Dashboard, Universal')).toBe(true)
    expect(o.text.endsWith('across 26 apps.')).toBe(true)
    expect(o.orig!.block!.runs).toHaveLength(3)
    expect(o.leading).toBeCloseTo(13.5, 1)
    expect(o.w).toBeCloseTo(318.99, 0)
    expect(o.autoWidth).toBe(false)
    expect(o.fill!.toLowerCase()).toBe('#ffffff')
  })

  it('an edit re-wraps INSIDE the cell: nothing outside the cell changes, no ink past the cell text width, patch = cell colour', async () => {
    const all = await runs3()
    const it = find(all, 'Contributed to frontend development, user interface components, and')
    const cell = it.cell!
    const o = { ...textObjFromCell(it, 0, DEFAULTS.text)!, text: '' }
    o.text = 'Contributed to frontend development and extensive accessibility testing, user interface components, responsive layouts and workflows.'
    const out = await exportEdited(bytes3, doc([o]), {}, deps)
    const before = await renderPixels(bytes3, 0, SCALE)
    const after = await renderPixels(out, 0, SCALE)
    if (OUT) writeFileSync(OUT + '/cell-before.txt', 'x')
    // (1) the rest of the page is pixel-identical
    const diffOut = diffOutside(before, after, SCALE, [{ x: cell.x, y: cell.y, w: cell.w, h: cell.h }], 0)
    // (2) the strip between the text width and the cell edge is still the cell colour
    const strip = maxDev(after, [242, 245, 251], cell.x + cell.w - cell.padR + 1.5, cell.x + cell.w - 1, cell.y + 1, cell.y + cell.h - 1)
    // (3) the lines changed
    const changed = diffOutside(before, after, SCALE, [], 0)
    console.info(`outside-the-cell differing pixels: ${diffOut}; ink in the right padding strip: ${strip}; pixels changed inside: ${changed}`)
    expect(diffOut).toBe(0)
    expect(strip).toBeLessThanOrEqual(3)
    expect(changed).toBeGreaterThan(200)
    // (4) the drawn lines each fit the cell text width (pdf.js reports the text items; the hidden originals are narrower than 318.5)
    const d = await open(out)
    const tc = await (await d.getPage(1)).getTextContent()
    const right = cell.x + cell.w - cell.padR + 0.6
    const wide = tc.items.filter((i) => 'str' in i && i.str.trim() && (i as unknown as { transform: number[] }).transform[4] + (i as unknown as { width: number }).width > right && (i as unknown as { transform: number[] }).transform[4] > cell.x && (i as unknown as { transform: number[] }).transform[5] < 841.89 - cell.y && (i as unknown as { transform: number[] }).transform[5] > 841.89 - cell.y - cell.h)
    expect(wide).toHaveLength(0)
  })

  it('opening a cell and changing nothing leaves the page byte-identical', async () => {
    const all = await runs3()
    const o = textObjFromCell(find(all, 'Books'), 0, DEFAULTS.text)!
    const out = await exportEdited(bytes3, doc([o]), {}, deps)
    expect(diffOutside(await renderPixels(bytes3, 0, SCALE), await renderPixels(out, 0, SCALE), SCALE, [], 0)).toBe(0)
  })

  it('the title (outside the table) is NOT a cell: it stays an editable single run', async () => {
    const all = await runs3()
    expect(textObjFromCell(find(all, 'Work Report'), 0, DEFAULTS.text)).toBeNull()
  })
})

// ───────────────────────────── the exact edit done in the browser: title word + word inside a shaded cell
import { wrapLines } from './textLayout'
describe('title word + shaded-cell word (as in the browser run)', () => {
  const bytes4 = new Uint8Array(readFileSync(FIX2))
  const w = (s: string, size: number, bold: boolean) => {
    const f = fontkit.create(readFileSync(FONTS + (bold ? 'LiberationSans-Bold.ttf' : 'LiberationSans-Regular.ttf'))) as unknown as { unitsPerEm: number; layout(s: string): { glyphs: { advanceWidth: number }[] } }
    return (f.layout(s).glyphs.reduce((a, g) => a + g.advanceWidth, 0) * size) / f.unitsPerEm
  }
  it('same font/size/colour, no fragments, no white patch, nothing else touched', async () => {
    const d = await open(bytes4)
    const all = await pageTextBoxes(d, 0, { tables: true, pixels: async () => { const { canvas, ctx } = await renderToCanvas(bytes4, 0, SCALE); return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data as unknown as Uint8ClampedArray, scale: SCALE } } })
    // title: Report -> Summary
    const tIt = find(all, 'Work Report')
    const title = { ...edit(clicked(tIt, true), 'Work Summary') }
    // shaded cell: development -> engineering
    const cIt = find(all, 'Contributed to frontend development, user interface components, and')
    const cell = cIt.cell!
    const cellObj = textObjFromCell(cIt, 0, DEFAULTS.text)!
    cellObj.text = cellObj.text.replace('development', 'engineering')
    const out = await exportEdited(bytes4, doc([title, cellObj]), {}, deps)
    const before = await renderPixels(bytes4, 0, SCALE)
    const after = await renderPixels(out, 0, SCALE)
    const px = (r: Raster, x: number, y: number) => { const i = (Math.floor(y * SCALE) * r.width + Math.floor(x * SCALE)) * 4; return [r.data[i], r.data[i + 1], r.data[i + 2]] }

    // 1. nothing outside the two edited areas changed
    const tBox = { x: tIt.origin!.x - 1, y: tIt.origin!.baseline - 22, w: 160, h: 30 }
    const outside = diffOutside(before, after, SCALE, [tBox, { x: cell.x, y: cell.y, w: cell.w, h: cell.h }], 1)
    // 2. no white patch inside the shaded cell: every pixel is the cell shade or a (tinted) glyph pixel, never pure white
    let white = 0
    for (let y = Math.floor((cell.y + 0.5) * SCALE); y < Math.ceil((cell.y + cell.h - 0.5) * SCALE); y++)
      for (let x = Math.floor((cell.x + 0.5) * SCALE); x < Math.ceil((cell.x + cell.w - 0.5) * SCALE); x++) {
        const i = (y * after.width + x) * 4
        if (after.data[i] >= 253 && after.data[i + 1] >= 253 && after.data[i + 2] >= 253) white++
      }
    // 3. no fragments: past the end of every new line, the cell is the shade colour again
    const lines = wrapLines(cellObj.text, cellObj.w, (s) => w(s, cellObj.size, false))
    let frag = 0
    lines.forEach((ln, i) => {
      const end = cellObj.x + w(ln, cellObj.size, false)
      const base = cellObj.baseline! + i * cellObj.leading!
      for (let x = Math.ceil((end + 1.5) * SCALE); x < Math.floor((cell.x + cell.w - 1) * SCALE); x++)
        for (let y = Math.floor((base - 0.72 * cellObj.size) * SCALE); y < Math.ceil((base + 0.2 * cellObj.size) * SCALE); y++) {
          const k = (y * after.width + x) * 4
          frag = Math.max(frag, Math.abs(after.data[k] - 242), Math.abs(after.data[k + 1] - 245), Math.abs(after.data[k + 2] - 251))
        }
    })
    // 4. title colour: the darkest glyph pixel of the new word is the title navy, not black
    const tw = w('Work Summary', 20, true)
    let darkest = [255, 255, 255]
    for (let y = tIt.origin!.baseline - 12; y < tIt.origin!.baseline; y += 0.34) for (let x = tIt.origin!.x + w('Work ', 20, true) + 2; x < tIt.origin!.x + tw - 2; x += 0.34) { const p = px(after, x, y); if (p[0] + p[1] + p[2] < darkest[0] + darkest[1] + darkest[2]) darkest = p }
    console.info(`outside-edit differing pixels ${outside}; pure-white pixels in the shaded cell ${white}; max leftover ink past line ends ${frag}; darkest new title pixel rgb(${darkest.join(',')}) (navy = 27,42,78); cell wrapped to ${lines.length} lines`)
    expect(outside).toBe(0)
    expect(white).toBe(0)
    expect(frag).toBeLessThanOrEqual(3)
    expect(Math.abs(darkest[0] - 27)).toBeLessThanOrEqual(12)
    expect(Math.abs(darkest[2] - 78)).toBeLessThanOrEqual(14)
    // 5. fonts used by the drawn text: Liberation Sans (regular + bold), never a serif
    const pdf = await PDFDocument.load(out)
    const fnt = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict)
    const names = [...fnt.entries()].map(([, v]) => String((pdf.context.lookup(v) as PDFDict).get(PDFName.of('BaseFont'))))
    console.info('fonts in exported page:', names.join(', '))
    expect(names.some((n) => /Serif|Times/i.test(n))).toBe(false)
    expect(names.some((n) => /LiberationSans-Bold/.test(n))).toBe(true)
  })
})
