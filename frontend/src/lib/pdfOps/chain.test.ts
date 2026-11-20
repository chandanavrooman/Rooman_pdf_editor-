import { describe, expect, it } from 'vitest'
import { _internalByteLength, addBytes, getBytes } from '../fileStore'
import { addPageNumbers, defaultStyle, extractPages, rotateAll } from './index'
import { makePdf } from '../../test/pdfs'
import { openWithPdfjs, pageTexts } from '../../test/pdfText'

describe('three different tools in a row on one stored file', () => {
  it('rotate -> extract -> page numbers, with pdf.js reads in between, never detaches the stored buffer', async () => {
    const meta = addBytes('chain.pdf', await makePdf(6))
    const size = _internalByteLength(meta.id)

    const rotated = await rotateAll(getBytes(meta.id), 90)
    // pdf.js transfers the buffer it receives to its worker; hand it a copy from the store
    const viewerDoc = await openWithPdfjs(getBytes(meta.id))
    expect(viewerDoc.numPages).toBe(6)

    const extracted = await extractPages(getBytes(meta.id), [2, 4, 6])
    const numbered = await addPageNumbers(getBytes(meta.id), 'chain.pdf', { position: { v: 'bottom', h: 'center' }, format: '{page}', startAt: 1, style: defaultStyle })
    await viewerDoc.loadingTask.destroy()

    expect(rotated.byteLength).toBeGreaterThan(0)
    expect(await pageTexts(extracted)).toEqual(['Page 2 of 6', 'Page 4 of 6', 'Page 6 of 6'])
    expect((await pageTexts(numbered))[5]).toContain('6')
    // The stored original is intact and still usable.
    expect(_internalByteLength(meta.id)).toBe(size)
    expect((await openWithPdfjs(getBytes(meta.id))).numPages).toBe(6)
  })
})
