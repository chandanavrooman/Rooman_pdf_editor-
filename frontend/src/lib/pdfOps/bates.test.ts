import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { batesNumber, batesPreviewPage, defaultStyle, formatBates, type BatesOptions } from './stamp'
import { makePdf } from '@/test/pdfs'
import { pageItems, pageTexts } from '@/test/pdfText'

const opts: BatesOptions = { prefix: 'DOC-', suffix: '', startAt: 1, digits: 6, position: { v: 'bottom', h: 'right' }, style: defaultStyle }

describe('formatBates', () => {
  it('prefix, zero-padded number, suffix', () => {
    expect(formatBates(opts, 1)).toBe('DOC-000001')
    expect(formatBates({ ...opts, prefix: 'CASE-2025-', suffix: '-CONF', digits: 4 }, 42)).toBe('CASE-2025-0042-CONF')
    expect(formatBates({ ...opts, prefix: '', digits: 1 }, 7)).toBe('7')
  })
  it('a number longer than the digit count is never cut', () => {
    expect(formatBates({ ...opts, digits: 3 }, 12345)).toBe('DOC-12345')
  })
})

describe('batesNumber across several files', () => {
  it('one running sequence: the second file does not start at 1 again', async () => {
    const a = await makePdf(3, { label: 'A' })
    const b = await makePdf(4, { label: 'B' })
    const c = await makePdf(2, { label: 'C' })
    const res = await batesNumber([{ name: 'a.pdf', bytes: a }, { name: 'b.pdf', bytes: b }, { name: 'c.pdf', bytes: c }], opts)
    const texts = await Promise.all(res.files.map((f) => pageTexts(f.bytes)))
    const stamps = texts.map((t) => t.map((x) => /DOC-\d{6}/.exec(x)?.[0]))
    expect(stamps).toEqual([['DOC-000001', 'DOC-000002', 'DOC-000003'], ['DOC-000004', 'DOC-000005', 'DOC-000006', 'DOC-000007'], ['DOC-000008', 'DOC-000009']])
    expect(res.first).toBe('DOC-000001')
    expect(res.last).toBe('DOC-000009')
    expect(res.files.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])
  })
  it('the order of the files decides the numbers', async () => {
    const a = await makePdf(2, { label: 'A' })
    const b = await makePdf(3, { label: 'B' })
    const res = await batesNumber([{ name: 'b.pdf', bytes: b }, { name: 'a.pdf', bytes: a }], { ...opts, startAt: 100, digits: 3 })
    const first = await pageTexts(res.files[0].bytes)
    const second = await pageTexts(res.files[1].bytes)
    expect(first.map((x) => /DOC-\d+/.exec(x)![0])).toEqual(['DOC-100', 'DOC-101', 'DOC-102'])
    expect(second.map((x) => /DOC-\d+/.exec(x)![0])).toEqual(['DOC-103', 'DOC-104'])
    expect(res.last).toBe('DOC-104')
  })
  it('rejects a bad start, digits or an empty list', async () => {
    const a = await makePdf(1)
    await expect(batesNumber([{ name: 'a.pdf', bytes: a }], { ...opts, startAt: -1 })).rejects.toThrow(/Start number/)
    await expect(batesNumber([{ name: 'a.pdf', bytes: a }], { ...opts, digits: 0 })).rejects.toThrow(/Digits/)
    await expect(batesNumber([], opts)).rejects.toThrow(/at least one PDF/)
  })
})

describe('batesPreviewPage (the live preview)', () => {
  it('one page with the number it gets in the full run, wherever it sits in the sequence', async () => {
    const a = await makePdf(3, { label: 'A' })
    const b = await makePdf(4, { label: 'B' })
    const full = await batesNumber([{ name: 'a.pdf', bytes: a }, { name: 'b.pdf', bytes: b }], { ...opts, suffix: '-X', position: { v: 'top', h: 'left' } })
    // page 3 of the second file: 3 pages come before the file, so DOC-000006-X
    const one = await batesPreviewPage(b, { ...opts, suffix: '-X', position: { v: 'top', h: 'left' } }, 3, 3)
    expect((await PDFDocument.load(one)).getPageCount()).toBe(1)
    const oneText = (await pageTexts(one))[0]
    expect(oneText).toBe((await pageTexts(full.files[1].bytes))[2])
    expect(oneText).toContain('DOC-000006-X')
    const x = await pageItems(one, 1)
    const y = await pageItems(full.files[1].bytes, 3)
    const pos = (r: typeof x) => r.items.find((i) => i.str.includes('DOC-000006'))!
    expect(pos(x).x).toBeCloseTo(pos(y).x, 3)
    expect(pos(x).y).toBeCloseTo(pos(y).y, 3)
  })
  it('reports a page that does not exist', async () => {
    await expect(batesPreviewPage(await makePdf(2), opts, 0, 5)).rejects.toThrow(/Page 5 does not exist/)
  })
})
