import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { _internalByteLength, addBytes, FileValidationError, getBytes, hasPdfMagic, removeFile } from './fileStore'
import { makePdf } from '../test/pdfs'
import { openWithPdfjs } from '../test/pdfText'

describe('FileStore', () => {
  it('rejects non-PDF content even with a .pdf name', () => {
    expect(() => addBytes('fake.pdf', new TextEncoder().encode('hello world, not a pdf'))).toThrow(FileValidationError)
    expect(hasPdfMagic(new TextEncoder().encode('%PDF-1.7\n'))).toBe(true)
  })

  it('getBytes returns a fresh copy each time; detaching a copy never affects the store', async () => {
    const original = await makePdf(2)
    const meta = addBytes('a.pdf', original)
    const size = _internalByteLength(meta.id)
    const a = getBytes(meta.id)
    const b = getBytes(meta.id)
    expect(a.buffer).not.toBe(b.buffer)
    expect(a.buffer).not.toBe(original.buffer)
    // Simulate pdf.js/worker transfer: detach a's buffer.
    structuredClone(a.buffer, { transfer: [a.buffer] })
    expect(a.byteLength).toBe(0)
    expect(_internalByteLength(meta.id)).toBe(size)
    expect(getBytes(meta.id).byteLength).toBe(size)
    removeFile(meta.id)
  })

  it('the store keeps its own copy of the caller bytes', async () => {
    const original = await makePdf(1)
    const meta = addBytes('b.pdf', original)
    original.fill(0)
    expect(hasPdfMagic(getBytes(meta.id))).toBe(true)
  })

  it('the same stored file can be given to real pdf.js and pdf-lib repeatedly', async () => {
    const meta = addBytes('c.pdf', await makePdf(3))
    for (let i = 0; i < 4; i++) {
      const doc = await openWithPdfjs(getBytes(meta.id)) // pdf.js transfers the buffer it receives
      expect(doc.numPages).toBe(3)
      await doc.loadingTask.destroy()
      const lib = await PDFDocument.load(getBytes(meta.id))
      expect(lib.getPageCount()).toBe(3)
    }
    expect(_internalByteLength(meta.id)).toBe(meta.size)
  })
})
