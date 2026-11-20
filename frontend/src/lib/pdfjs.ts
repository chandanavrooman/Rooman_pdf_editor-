import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getBytes } from './fileStore'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
export type { PDFDocumentProxy }

/**
 * Load a PDF into pdf.js. ALWAYS hands pdf.js its own copy of the bytes —
 * pdf.js transfers the buffer to its worker (detaching it), so never pass a
 * shared buffer here.
 */
export function loadPdfFromBytes(bytes: Uint8Array | ArrayBuffer) {
  const copy = bytes instanceof Uint8Array ? bytes.slice(0) : new Uint8Array(bytes.slice(0))
  return pdfjs.getDocument({ data: copy, fontExtraProperties: true })
}

export function loadPdfFromStore(id: string) {
  return pdfjs.getDocument({ data: getBytes(id), fontExtraProperties: true })
}
