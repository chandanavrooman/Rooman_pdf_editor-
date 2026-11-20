import { PDFDocument, PDFPage } from 'pdf-lib'
import { loadDoc, noProgress, pageRotation, pdfSave, PdfOpError, visibleBox, visualSize, visualToPage, type ProgressFn } from './common'

/** Interleave the pages of two PDFs: A1, B1, A2, B2 ... Pages left over from the longer one follow at the end. */
export async function alternateMix(a: Uint8Array, b: Uint8Array, opts: { reverseB?: boolean; reverseA?: boolean } = {}, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const da = await loadDoc(a, 'The first PDF')
  const db = await loadDoc(b, 'The second PDF')
  const out = await PDFDocument.create()
  const ia = [...Array(da.getPageCount()).keys()]
  const ib = [...Array(db.getPageCount()).keys()]
  if (opts.reverseA) ia.reverse()
  if (opts.reverseB) ib.reverse()
  const pa = await out.copyPages(da, ia)
  const pb = await out.copyPages(db, ib)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    if (pa[i]) out.addPage(pa[i])
    if (pb[i]) out.addPage(pb[i])
    onProgress((i + 1) / n)
  }
  return pdfSave(out)
}

export type HalfDirection = 'auto' | 'vertical' | 'horizontal'

/**
 * Cut every page (or the chosen pages) into two: left and right halves, or top and bottom. "auto" cuts landscape pages down the middle
 * (two portrait pages, like a scanned book spread) and portrait pages across the middle.
 * The halves are made with page boxes, so text, links and vector content stay exactly as they were.
 */
export async function splitInHalf(bytes: Uint8Array, opts: { direction?: HalfDirection; pages?: number[] } = {}, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const src = await loadDoc(bytes)
  const total = src.getPageCount()
  const chosen = opts.pages ? new Set(opts.pages) : null
  if (chosen && [...chosen].some((p) => p < 1 || p > total)) throw new PdfOpError(`Choose pages between 1 and ${total}.`)
  const out = await PDFDocument.create()
  for (let i = 0; i < total; i++) {
    const [first] = await out.copyPages(src, [i])
    if (chosen && !chosen.has(i + 1)) {
      out.addPage(first)
      continue
    }
    const [second] = await out.copyPages(src, [i])
    const { width: W, height: H } = visualSize(first)
    const dir = opts.direction && opts.direction !== 'auto' ? opts.direction : W >= H ? 'vertical' : 'horizontal'
    // halves in visual space (origin bottom-left, rotation applied), reading order: left then right, top then bottom
    const halves = dir === 'vertical' ? [[0, 0, W / 2, H], [W / 2, 0, W, H]] : [[0, H / 2, W, H], [0, 0, W, H / 2]]
    const parts = [first, second]
    parts.forEach((pg, k) => {
      const [x0, y0, x1, y1] = halves[k]
      const p = visualToPage(pg, x0, y0)
      const q = visualToPage(pg, x1, y1)
      const box = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) }
      pg.setCropBox(box.x, box.y, box.width, box.height)
      pg.setMediaBox(box.x, box.y, box.width, box.height)
      out.addPage(pg)
    })
    onProgress((i + 1) / total)
  }
  return pdfSave(out)
}

export type FlipAxis = 'horizontal' | 'vertical'

/** Mirror pages: "horizontal" turns them left-to-right (like a mirror), "vertical" mirrors them top to bottom. */
export async function flipPages(bytes: Uint8Array, opts: { axis: FlipAxis; pages?: number[] }, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const src = await loadDoc(bytes)
  const total = src.getPageCount()
  const chosen = opts.pages ? new Set(opts.pages) : null
  if (chosen && [...chosen].some((p) => p < 1 || p > total)) throw new PdfOpError(`Choose pages between 1 and ${total}.`)
  const out = await PDFDocument.create()
  for (let i = 0; i < total; i++) {
    const sp = src.getPage(i)
    if (chosen && !chosen.has(i + 1)) {
      const [c] = await out.copyPages(src, [i])
      out.addPage(c)
      continue
    }
    const box = visibleBox(sp)
    const rot = pageRotation(sp)
    if (!sp.node.Contents()) {
      // a blank page has no content to mirror (pdf-lib cannot embed it): keep it as it is
      const [c] = await out.copyPages(src, [i])
      out.addPage(c)
      onProgress((i + 1) / total)
      continue
    }
    const embedded = await out.embedPage(sp)
    const np: PDFPage = out.addPage([box.width, box.height])
    np.setRotation(sp.getRotation())
    // a visual left-right flip is a page-space left-right flip on upright pages and a top-bottom flip on sideways ones
    const flipX = (opts.axis === 'horizontal') === (rot === 0 || rot === 180)
    np.drawPage(embedded, flipX ? { x: box.width, y: 0, xScale: -1, yScale: 1 } : { x: 0, y: box.height, xScale: 1, yScale: -1 })
    onProgress((i + 1) / total)
  }
  return pdfSave(out)
}

export interface RasterPage {
  /** JPEG bytes of the page, already grayscale */
  jpeg: Uint8Array
  /** page size in points (as displayed) */
  width: number
  height: number
}

/** Rebuild a PDF from grayscale page pictures. */
export async function pdfFromPageImages(pages: RasterPage[], onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    const img = await out.embedJpg(p.jpeg)
    const pg = out.addPage([p.width, p.height])
    pg.drawImage(img, { x: 0, y: 0, width: p.width, height: p.height })
    onProgress((i + 1) / pages.length)
  }
  return pdfSave(out)
}
