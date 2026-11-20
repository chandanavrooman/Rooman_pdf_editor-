import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { addPageNumbers, applyTokens, defaultStyle } from './stamp'
import { makePdf } from '@/test/pdfs'
import { pageItems, pageTexts } from '@/test/pdfText'

const ctx = (page: number, pages = 12) => ({ page, pages, date: 'D', filename: 'f.pdf' })
const base = { position: { v: 'bottom', h: 'center' } as const, startAt: 1, style: defaultStyle }

describe('number formats', () => {
  it('the five formats of the picker', () => {
    expect(applyTokens('{page}', ctx(3))).toBe('3')
    expect(applyTokens('Page {page}', ctx(3))).toBe('Page 3')
    expect(applyTokens('Page {page} of {pages}', ctx(3))).toBe('Page 3 of 12')
    expect(applyTokens('{page} / {pages}', ctx(3))).toBe('3 / 12')
    expect(applyTokens('{page:2}', ctx(3))).toBe('03')
  })
  it('zero padding never cuts a long number', () => {
    expect(applyTokens('{page:2}', ctx(10))).toBe('10')
    expect(applyTokens('{page:2}', ctx(123))).toBe('123')
    expect(applyTokens('{page:4} of {pages:4}', ctx(7, 12))).toBe('0007 of 0012')
  })
  it('old tokens still work and are not confused with the padded ones', () => {
    expect(applyTokens('{PAGE} {pages} {total} {date} {filename}', ctx(2, 5))).toBe('2 5 5 D f.pdf')
  })
})

describe('addPageNumbers', () => {
  it('numbers every page, counting from the chosen start', async () => {
    const out = await addPageNumbers(await makePdf(3), 'd.pdf', { ...base, startAt: 5, format: 'Page {page} of {pages}' })
    const t = await pageTexts(out)
    expect(t[0]).toContain('Page 5 of 7')
    expect(t[1]).toContain('Page 6 of 7')
    expect(t[2]).toContain('Page 7 of 7')
  })
  it('only the chosen pages are numbered', async () => {
    const out = await addPageNumbers(await makePdf(4), 'd.pdf', { ...base, format: 'N{page}', pages: [2, 4] })
    const t = await pageTexts(out)
    expect(t.map((x) => /N\d/.test(x))).toEqual([false, true, false, true])
    expect(t[1]).toContain('N2')
    expect(t[3]).toContain('N4')
  })
  it('every position lands in its corner of the page', async () => {
    const positions = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const
    for (const key of positions) {
      const [v, h] = key.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
      const out = await addPageNumbers(await makePdf(1), 'd.pdf', { ...base, position: { v, h }, format: 'NUMBER' })
      const { items, width, height } = await pageItems(out, 1)
      const it = items.find((i) => i.str === 'NUMBER')!
      expect(it, key).toBeDefined()
      const startX = it.x / width // where the text begins, as a fraction of the page width
      const baseline = it.y / height
      if (h === 'left') expect(startX, key).toBeLessThan(0.15)
      if (h === 'center') expect(startX, key).toBeGreaterThan(0.4) // a word about 40 pt wide, centred, starts a little left of the middle
      if (h === 'center') expect(startX, key).toBeLessThan(0.5)
      if (h === 'right') expect(startX, key).toBeGreaterThan(0.8)
      if (v === 'top') expect(baseline, key).toBeLessThan(0.1)
      else expect(baseline, key).toBeGreaterThan(0.9)
    }
  })
})

describe('onlyPage (the live preview)', () => {
  it('gives ONE page, stamped exactly as in the full result', async () => {
    const src = await makePdf(6)
    const opts = { ...base, startAt: 3, format: 'Page {page} of {pages}' }
    const full = await addPageNumbers(src, 'd.pdf', opts)
    const one = await addPageNumbers(src, 'd.pdf', { ...opts, onlyPage: 4 })
    expect((await PDFDocument.load(one)).getPageCount()).toBe(1)
    const [fullText, oneText] = [(await pageTexts(full))[3], (await pageTexts(one))[0]]
    expect(oneText).toBe(fullText)
    expect(oneText).toContain('Page 6 of 8')
    const a = await pageItems(full, 4)
    const b = await pageItems(one, 1)
    const num = (r: typeof a) => r.items.find((i) => i.str.startsWith('Page 6'))!
    expect(num(b).x).toBeCloseTo(num(a).x, 3)
    expect(num(b).y).toBeCloseTo(num(a).y, 3)
  })
  it('a page that is not chosen comes back without a number', async () => {
    const one = await addPageNumbers(await makePdf(5), 'd.pdf', { ...base, format: 'STAMP{page}', pages: [1, 2], onlyPage: 4 })
    expect((await PDFDocument.load(one)).getPageCount()).toBe(1)
    expect((await pageTexts(one))[0]).not.toContain('STAMP')
  })
  it('reports a page that does not exist', async () => {
    await expect(addPageNumbers(await makePdf(2), 'd.pdf', { ...base, format: '{page}', onlyPage: 9 })).rejects.toThrow(/Page 9 does not exist/)
  })
})
