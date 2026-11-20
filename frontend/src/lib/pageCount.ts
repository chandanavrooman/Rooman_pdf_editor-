import { PDFDocument } from 'pdf-lib'
import { getBytes } from './fileStore'

/** Number of pages via pdf-lib (works on a copy). */
export async function countPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true, updateMetadata: false })
  return doc.getPageCount()
}

export async function countPagesOf(id: string): Promise<number> {
  return countPages(getBytes(id))
}
