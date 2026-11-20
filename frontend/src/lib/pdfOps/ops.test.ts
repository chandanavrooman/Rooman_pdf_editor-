import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { unzipSync } from 'fflate'
import {
  addHeadersFooters, addPageNumbers, batesNumber, cropPages, defaultStyle, deletePages, extractPages, mergePdfs, nUp, PAGE_SIZES, PdfOpError,
  reorderPages, resizePages, rotateAll, rotatePages, splitByBookmarks, splitByRanges, splitBySize, splitEveryN, zipFiles,
} from './index'
import { parseRanges } from '../ranges'
import { getTopLevelBookmarks } from '../outline'
import { makePdf, makePdfWithBookmarks } from '../../test/pdfs'
import { openWithPdfjs, pageItems, pageTexts } from '../../test/pdfText'

const pageCount = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount()

const FIXTURES = join(import.meta.dirname, '..', '..', '..', '..', 'tests', 'fixtures')

describe('merge', () => {
  it('merges in order and keeps all content', async () => {
    const a = await makePdf(2, { label: 'A' })
    const b = await makePdf(3, { label: 'B' })
    const out = await mergePdfs([{ name: 'a.pdf', bytes: a }, { name: 'b.pdf', bytes: b }])
    const texts = await pageTexts(out)
    expect(texts).toEqual(['Page 1 of 2 A', 'Page 2 of 2 A', 'Page 1 of 3 B', 'Page 2 of 3 B', 'Page 3 of 3 B'])
    // inputs untouched
    expect(await pageCount(a)).toBe(2)
  })
  it('needs two files', async () => {
    await expect(mergePdfs([{ name: 'a.pdf', bytes: await makePdf(1) }])).rejects.toThrow(PdfOpError)
  })
  it('rejects an unreadable file with a helpful message', async () => {
    const bad = new TextEncoder().encode('%PDF-1.4 garbage')
    await expect(mergePdfs([{ name: 'a', bytes: await makePdf(1) }, { name: 'bad.pdf', bytes: bad }])).rejects.toThrow(/Repair|could not be read/)
  })
  // Regression: pdf-lib's EncryptedPDFError fails `instanceof` (ES5 build), so locked files used to get the
  // misleading "could not be read … Try the Repair PDF tool" message. Real encrypted fixtures (pikepdf, AES-256).
  it.each(['protected.pdf', 'owner-only.pdf'])('rejects the encrypted fixture %s with "unlock it first"', async (name) => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)))
    const err = await mergePdfs([{ name: 'a', bytes: await makePdf(1) }, { name, bytes }]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PdfOpError)
    expect((err as Error).message).toMatch(/password-protected or has editing restrictions\. Unlock it first/)
    expect((err as Error).message).not.toMatch(/Repair/)
  })
})

describe('split', () => {
  it('by ranges', async () => {
    const src = await makePdf(10)
    const files = await splitByRanges(src, 'doc', parseRanges('1-3,5,8-', 10))
    expect(files.map((f) => f.name)).toEqual(['doc-pages-1-3.pdf', 'doc-page-5.pdf', 'doc-pages-8-10.pdf'])
    expect(await Promise.all(files.map((f) => pageCount(f.bytes)))).toEqual([3, 1, 3])
    expect((await pageTexts(files[1].bytes))[0]).toBe('Page 5 of 10')
  })
  it('every N pages', async () => {
    const files = await splitEveryN(await makePdf(7), 'doc', 3)
    expect(await Promise.all(files.map((f) => pageCount(f.bytes)))).toEqual([3, 3, 1])
    await expect(splitEveryN(await makePdf(2), 'd', 0)).rejects.toThrow()
  })
  it('by bookmarks (resolved through real pdf.js)', async () => {
    const src = await makePdfWithBookmarks(6, [{ title: 'Intro', page: 1 }, { title: 'Body', page: 3 }, { title: 'End', page: 5 }])
    const doc = await openWithPdfjs(src)
    const marks = await getTopLevelBookmarks(doc as never)
    await doc.loadingTask.destroy()
    expect(marks).toEqual([{ title: 'Intro', pageIndex: 1 }, { title: 'Body', pageIndex: 3 }, { title: 'End', pageIndex: 5 }])
    const files = await splitByBookmarks(src, 'book', marks)
    expect(files.map((f) => f.name)).toEqual(['book-01-front-matter.pdf', 'book-02-Intro.pdf', 'book-03-Body.pdf', 'book-04-End.pdf'])
    expect(await Promise.all(files.map((f) => pageCount(f.bytes)))).toEqual([1, 2, 2, 1])
  })
  it('by size: every part really is under the limit', async () => {
    const src = await makePdf(30, { filler: 40 })
    const limit = Math.round(src.byteLength / 4)
    const { files, oversize } = await splitBySize(src, 'big', limit)
    expect(oversize).toEqual([])
    expect(files.length).toBeGreaterThan(1)
    for (const f of files) expect(f.bytes.byteLength).toBeLessThanOrEqual(limit)
    const total = (await Promise.all(files.map((f) => pageCount(f.bytes)))).reduce((a, b) => a + b, 0)
    expect(total).toBe(30)
  })
  it('by size reports a single page larger than the limit', async () => {
    const src = await makePdf(2, { filler: 300 })
    const { oversize, files } = await splitBySize(src, 'x', 2048)
    expect(oversize.length).toBeGreaterThan(0)
    expect(files.length).toBe(2)
  })
  it('zip round trip', async () => {
    const files = await splitEveryN(await makePdf(4), 'z', 2)
    const zip = unzipSync(zipFiles(files))
    expect(Object.keys(zip).sort()).toEqual(['z-pages-1-2.pdf', 'z-pages-3-4.pdf'])
  })
})

describe('extract / delete / reorder', () => {
  it('extract in the given order', async () => {
    const out = await extractPages(await makePdf(6), [5, 1, 3])
    expect(await pageTexts(out)).toEqual(['Page 5 of 6', 'Page 1 of 6', 'Page 3 of 6'])
  })
  it('delete', async () => {
    const out = await deletePages(await makePdf(5), [2, 4])
    expect(await pageTexts(out)).toEqual(['Page 1 of 5', 'Page 3 of 5', 'Page 5 of 5'])
    await expect(deletePages(await makePdf(2), [1, 2])).rejects.toThrow(/every page/)
    await expect(deletePages(await makePdf(2), [9])).rejects.toThrow(/does not exist/)
  })
  it('reorder with optional rotation', async () => {
    const out = await reorderPages(await makePdf(3), [3, 1, 2], { 1: 90 })
    expect(await pageTexts(out)).toEqual(['Page 3 of 3', 'Page 1 of 3', 'Page 2 of 3'])
    const doc = await PDFDocument.load(out)
    expect(doc.getPage(1).getRotation().angle).toBe(90)
    expect(doc.getPage(0).getRotation().angle).toBe(0)
    await expect(reorderPages(await makePdf(3), [1, 1, 2])).rejects.toThrow()
  })
})

describe('rotate', () => {
  it('rotates selected pages and accumulates with existing rotation', async () => {
    const src = await makePdf(3, { rotations: [0, 90, 0] })
    const out = await rotatePages(src, { 1: 90, 2: 90 })
    const doc = await PDFDocument.load(out)
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 180, 0])
    const neg = await PDFDocument.load(await rotatePages(src, { 1: -90 }))
    expect(neg.getPage(0).getRotation().angle).toBe(270)
  })
  it('rotate all', async () => {
    const doc = await PDFDocument.load(await rotateAll(await makePdf(3), 180))
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([180, 180, 180])
  })
})

describe('crop', () => {
  it('sets a CropBox from visual margins (unrotated page)', async () => {
    const out = await cropPages(await makePdf(1, { size: [600, 800] }), { top: 0.1, right: 0.05, bottom: 0.2, left: 0.1 }, { unit: 'fraction' })
    const box = (await PDFDocument.load(out)).getPage(0).getCropBox()
    expect(box.x).toBeCloseTo(60)
    expect(box.y).toBeCloseTo(160)
    expect(box.width).toBeCloseTo(600 - 60 - 30)
    expect(box.height).toBeCloseTo(800 - 160 - 80)
  })
  it('maps visual margins correctly on a page rotated 90°', async () => {
    // visual page is 800 wide x 600 tall. Crop 100pt off the visual TOP only.
    const src = await makePdf(1, { size: [600, 800], rotations: [90] })
    const out = await cropPages(src, { top: 100, right: 0, bottom: 0, left: 0 }, { unit: 'pt' })
    const page = (await PDFDocument.load(out)).getPage(0)
    const box = page.getCropBox()
    // visual top == box left for 90° clockwise rotation
    expect(box.x).toBeCloseTo(100)
    expect(box.width).toBeCloseTo(500)
    expect(box.height).toBeCloseTo(800)
    // pdf.js (rotation + cropbox aware) agrees: visual height is now 500
    const { width, height } = await pageItems(out, 1)
    expect(width).toBeCloseTo(800)
    expect(height).toBeCloseTo(500)
  })
  it('refuses to crop everything', async () => {
    await expect(cropPages(await makePdf(1), { top: 0.5, right: 0, bottom: 0.5, left: 0 }, { unit: 'fraction' })).rejects.toThrow(/remove all/)
  })
})

describe('resize', () => {
  it('resizes to A4 and keeps text', async () => {
    const src = await makePdf(2, { size: [612, 792] })
    const out = await resizePages(src, { width: PAGE_SIZES.a4.width, height: PAGE_SIZES.a4.height, mode: 'fit', autoOrient: false })
    const doc = await PDFDocument.load(out)
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28, 1)
    expect(doc.getPage(1).getSize().height).toBeCloseTo(841.89, 1)
    expect(await pageTexts(out)).toEqual(['Page 1 of 2', 'Page 2 of 2'])
  })
  it('keeps a rotated page upright (text stays near the visual top-left)', async () => {
    const src = await makePdf(1, { size: [600, 800], rotations: [90] })
    const before = await pageItems(src, 1)
    const out = await resizePages(src, { width: 400, height: 300, mode: 'fit', autoOrient: false })
    const after = await pageItems(out, 1)
    // normalised position of the first text item in the visual page
    const nb = { x: before.items[0].x / before.width, y: before.items[0].y / before.height }
    const na = { x: after.items[0].x / after.width, y: after.items[0].y / after.height }
    expect(na.x).toBeCloseTo(nb.x, 1)
    expect(na.y).toBeCloseTo(nb.y, 1)
    expect(after.items[0].str).toContain('Page 1')
  })
})

describe('n-up', () => {
  it.each([[2, 5, 3], [4, 9, 3], [6, 13, 3], [9, 10, 2]] as const)('%i per sheet', async (per, pages, sheets) => {
    const out = await nUp(await makePdf(pages), { perSheet: per, sheetWidth: 595.28, sheetHeight: 841.89, landscape: per === 2 || per === 6, margin: 20, gap: 8, border: true, order: 'row' })
    expect(await pageCount(out)).toBe(sheets)
    const first = (await pageTexts(out))[0]
    expect(first).toContain('Page 1 of ' + pages)
    expect(first).toContain(`Page ${Math.min(per, pages)} of ${pages}`)
  })
})

describe('page numbers, headers/footers, bates', () => {
  it('adds page numbers with tokens, start offset and a range', async () => {
    const out = await addPageNumbers(await makePdf(4), 'doc.pdf', { position: { v: 'bottom', h: 'center' }, format: 'Page {page} of {pages}', startAt: 5, pages: [2, 3], style: defaultStyle })
    const texts = await pageTexts(out)
    expect(texts[0]).toBe('Page 1 of 4')
    expect(texts[1]).toContain('Page 6 of 8')
    expect(texts[2]).toContain('Page 7 of 8')
    expect(texts[3]).toBe('Page 4 of 4')
  })
  it('places numbers at the visual bottom-right even on rotated pages', async () => {
    const out = await addPageNumbers(await makePdf(1, { rotations: [90] }), 'd.pdf', { position: { v: 'bottom', h: 'right' }, format: 'NUM', startAt: 1, style: defaultStyle })
    const { width, height, items } = await pageItems(out, 1)
    const num = items.find((i) => i.str === 'NUM')!
    expect(num.x).toBeGreaterThan(width * 0.8)
    expect(num.y).toBeGreaterThan(height * 0.9)
  })
  it('rejects characters the built-in font cannot draw', async () => {
    await expect(addPageNumbers(await makePdf(1), 'd.pdf', { position: { v: 'bottom', h: 'center' }, format: '第 {page} 页', startAt: 1, style: defaultStyle })).rejects.toThrow(/cannot draw/)
  })
  it('headers and footers', async () => {
    const out = await addHeadersFooters(await makePdf(2), 'report.pdf', { slots: { 'top-left': '{filename}', 'bottom-right': '{page}/{pages}' }, startAt: 1, style: defaultStyle })
    const t = await pageTexts(out)
    expect(t[1]).toContain('report.pdf')
    expect(t[1]).toContain('2/2')
    await expect(addHeadersFooters(await makePdf(1), 'r', { slots: {}, startAt: 1, style: defaultStyle })).rejects.toThrow(/at least one/)
  })
  it('bates numbering continues across files', async () => {
    const res = await batesNumber(
      [{ name: 'a.pdf', bytes: await makePdf(2) }, { name: 'b.pdf', bytes: await makePdf(3) }],
      { prefix: 'ACME-', suffix: '', startAt: 7, digits: 6, position: { v: 'bottom', h: 'right' }, style: defaultStyle },
    )
    expect(res.first).toBe('ACME-000007')
    expect(res.last).toBe('ACME-000011')
    expect((await pageTexts(res.files[0].bytes))[1]).toContain('ACME-000008')
    expect((await pageTexts(res.files[1].bytes))[2]).toContain('ACME-000011')
  })
})
