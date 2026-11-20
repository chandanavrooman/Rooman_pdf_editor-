import { PDFDocument, degrees } from 'pdf-lib'
import { loadDoc, noProgress, normRotation, pdfSave, PdfOpError, type ProgressFn } from './common'

/** Keep the given 1-based pages, in the given order (duplicates allowed). */
export async function extractPages(bytes: Uint8Array, pages: number[], onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const src = await loadDoc(bytes)
  const total = src.getPageCount()
  if (!pages.length) throw new PdfOpError('Select at least one page.')
  for (const p of pages) if (p < 1 || p > total) throw new PdfOpError(`Page ${p} does not exist (the document has ${total}).`)
  onProgress(0.2, 'Copying pages')
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, pages.map((p) => p - 1))
  copied.forEach((p) => out.addPage(p))
  onProgress(0.9, 'Saving')
  const result = await pdfSave(out)
  onProgress(1)
  return result
}

/** Remove the given 1-based pages. */
export async function deletePages(bytes: Uint8Array, pages: number[], onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const src = await loadDoc(bytes)
  const total = src.getPageCount()
  const del = new Set(pages)
  if (!del.size) throw new PdfOpError('Select at least one page to delete.')
  for (const p of del) if (p < 1 || p > total) throw new PdfOpError(`Page ${p} does not exist (the document has ${total}).`)
  if (del.size >= total) throw new PdfOpError('You cannot delete every page — at least one page must remain.')
  onProgress(0.3, 'Removing pages')
  // Remove from the back so indices stay valid.
  for (const p of [...del].sort((a, b) => b - a)) src.removePage(p - 1)
  onProgress(0.8, 'Saving')
  const result = await pdfSave(src)
  onProgress(1)
  return result
}

/**
 * Rotate pages. `deltas` maps 1-based page -> degrees to add (multiples of 90, may be negative).
 */
export async function rotatePages(bytes: Uint8Array, deltas: Record<number, number>, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const doc = await loadDoc(bytes)
  const total = doc.getPageCount()
  const entries = Object.entries(deltas).map(([k, v]) => [Number(k), v] as const).filter(([, v]) => normRotation(v) !== 0)
  if (!entries.length) throw new PdfOpError('Choose at least one page to rotate.')
  entries.forEach(([p, d], i) => {
    if (p < 1 || p > total) throw new PdfOpError(`Page ${p} does not exist (the document has ${total}).`)
    if (d % 90 !== 0) throw new PdfOpError('Rotation must be a multiple of 90°.')
    const page = doc.getPage(p - 1)
    page.setRotation(degrees(normRotation(page.getRotation().angle + d)))
    onProgress((i + 1) / entries.length / 1.2)
  })
  const result = await pdfSave(doc)
  onProgress(1)
  return result
}

/** Rotate every page by the same amount. */
export async function rotateAll(bytes: Uint8Array, delta: number, onProgress?: ProgressFn): Promise<Uint8Array> {
  const doc = await loadDoc(bytes)
  const deltas: Record<number, number> = {}
  for (let i = 1; i <= doc.getPageCount(); i++) deltas[i] = delta
  return rotatePages(bytes, deltas, onProgress)
}

/**
 * Reorder: `order` is a permutation of all 1-based pages giving the new sequence.
 * Optional per-page extra rotation, keyed by ORIGINAL page number.
 */
export async function reorderPages(
  bytes: Uint8Array,
  order: number[],
  rotations: Record<number, number> = {},
  onProgress: ProgressFn = noProgress,
): Promise<Uint8Array> {
  const src = await loadDoc(bytes)
  const total = src.getPageCount()
  if (order.length !== total || new Set(order).size !== total || order.some((p) => p < 1 || p > total)) {
    throw new PdfOpError('The new order must contain every page exactly once.')
  }
  onProgress(0.2, 'Rebuilding page order')
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, order.map((p) => p - 1))
  copied.forEach((page, i) => {
    const extra = rotations[order[i]] ?? 0
    if (extra) page.setRotation(degrees(normRotation(page.getRotation().angle + extra)))
    out.addPage(page)
  })
  onProgress(0.9, 'Saving')
  const result = await pdfSave(out)
  onProgress(1)
  return result
}
