import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { addHeadersFooters, applyTokens, defaultStyle } from './stamp'

const FIX = (n: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../tests/fixtures/${n}`, import.meta.url))))
const OUT = process.env.OPS_OUT
const STD = fileURLToPath(new URL('../../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).split(String.fromCharCode(92)).join('/')
const MM = 72 / 25.4

/** the stamped runs of a page: text, left x, right x, baseline from the TOP, size, font name (page space, points) */
async function runs(bytes: Uint8Array, pageNo: number) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0), standardFontDataUrl: STD, verbosity: 0, useSystemFonts: false }).promise
  const page = await doc.getPage(pageNo)
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  const out = tc.items
    .filter((i) => 'str' in i && i.str.trim())
    .map((i) => {
      const it = i as { str: string; width: number; transform: number[]; fontName: string }
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5])
      return { str: it.str, x, right: x + it.width, y, size: Math.hypot(it.transform[0], it.transform[1]), font: tc.styles[it.fontName]?.fontFamily ?? '' }
    })
  await doc.loadingTask.destroy()
  return { W: vp.width, H: vp.height, items: out }
}

describe('3 headers & footers with {page} and {total}', () => {
  const src = FIX('three-pages.pdf')
  const slots = {
    'top-left': 'Quarterly report',
    'top-center': 'CONFIDENTIAL',
    'top-right': 'Page {page} of {total}',
    'bottom-left': 'Doc: {filename}',
    'bottom-center': '— {page}/{total} —',
  } as const

  it('tokens', () => {
    expect(applyTokens('{page} of {total} / {pages} / {PAGE}', { page: 2, pages: 3, date: 'd', filename: 'f' })).toBe('2 of 3 / 3 / 2')
  })

  it('all three pages: left / centre / right alignment, Times Bold 12', async () => {
    const out = await addHeadersFooters(src, 'three-pages.pdf', { slots, startAt: 1, style: { ...defaultStyle, font: 'Times', bold: true, fontSize: 12, margin: 15 * MM } })
    if (OUT) writeFileSync(OUT + '/headers-footers.pdf', out)
    for (let n = 1; n <= 3; n++) {
      const { W, items } = await runs(out, n)
      const stamped = items.filter((i) => !/^(Chapter|This is|Line|Shaded|Last line)/.test(i.str))
      console.info(`page ${n}:`)
      for (const i of stamped) console.info(`   “${i.str}”  x ${i.x.toFixed(1)}–${i.right.toFixed(1)}  y(top) ${i.y.toFixed(1)}  size ${i.size.toFixed(1)}  ${i.font}`)
      const by = (s: string) => stamped.find((i) => i.str.includes(s))!
      expect(by('Quarterly').x).toBeCloseTo(15 * MM, 0) // left: starts at the margin
      expect((by('CONFIDENTIAL').x + by('CONFIDENTIAL').right) / 2).toBeCloseTo(W / 2, 0) // centre
      expect(by('Page ').right).toBeCloseTo(W - 15 * MM, 0) // right: ends at the margin
      expect(by('Page ').str).toBe(`Page ${n} of 3`)
      expect(by('/').str).toBe(`— ${n}/3 —`)
      expect(by('Doc:').str).toBe('Doc: three-pages.pdf')
      for (const i of stamped) expect(i.size).toBeCloseTo(12, 1)
    }
  })

  it('only pages 1 and 3, numbering starts at 5: page 2 is untouched', async () => {
    const out = await addHeadersFooters(src, 'x.pdf', { slots: { 'bottom-right': 'p. {page} / {total}' }, startAt: 5, pages: [1, 3], style: defaultStyle })
    const t = async (n: number) => (await runs(out, n)).items.map((i) => i.str).filter((s) => s.startsWith('p. '))
    console.info('page 1:', await t(1), ' page 2:', await t(2), ' page 3:', await t(3))
    expect(await t(1)).toEqual(['p. 5 / 7'])
    expect(await t(2)).toEqual([])
    expect(await t(3)).toEqual(['p. 7 / 7'])
  })
})
