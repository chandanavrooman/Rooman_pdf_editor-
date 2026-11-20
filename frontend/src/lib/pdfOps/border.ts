import { PDFPage, rgb } from 'pdf-lib'
import { loadDoc, noProgress, pdfSave, PdfOpError, visualSize, visualToPage, type ProgressFn } from './common'

export type BorderStyle = 'solid' | 'dashed'

export interface BorderOptions {
  /** distance from the page edge to the OUTER edge of the border, in points - the same on all four sides */
  insetPt: number
  thicknessPt: number
  color: { r: number; g: number; b: number }
  style: BorderStyle
  /** 1-based pages; undefined = all */
  pages?: number[]
}

/** Fit a whole number of dashes (starting AND ending with a dash) into a side of length `len`, so every side looks the same. */
export function dashPattern(len: number, thickness: number): { dash: number; gap: number } {
  const d0 = Math.max(thickness * 3, 4)
  const g0 = d0 * 0.6
  const n = Math.max(1, Math.round((len - d0) / (d0 + g0))) // number of gaps
  const dash = len / (n + 1 + n * 0.6)
  return { dash, gap: dash * 0.6 }
}

function drawBorder(page: PDFPage, o: BorderOptions) {
  const { width: W, height: H } = visualSize(page)
  const t = o.thicknessPt
  const a = o.insetPt // outer edge
  const color = rgb(o.color.r, o.color.g, o.color.b)
  // everything is computed in VISUAL space (origin bottom-left of what the user sees), then mapped to page space, so rotated pages work too
  const P = (vx: number, vy: number) => {
    const p = visualToPage(page, vx, vy)
    return { x: p.x, y: p.y }
  }
  const line = (x0: number, y0: number, x1: number, y1: number, dash?: number[]) =>
    page.drawLine({ start: P(x0, y0), end: P(x1, y1), thickness: t, color, ...(dash ? { dashArray: dash, dashPhase: 0 } : {}) })
  const left = a + t / 2
  const right = W - a - t / 2
  const bottom = a + t / 2
  const top = H - a - t / 2
  if (o.style === 'solid') {
    // four strokes along the centre line; extend each by t/2 so the corners are filled squares
    line(left - t / 2, bottom, right + t / 2, bottom)
    line(left - t / 2, top, right + t / 2, top)
    line(left, bottom - t / 2, left, top + t / 2)
    line(right, bottom - t / 2, right, top + t / 2)
    return
  }
  // dashed: a solid t×t square in each corner, and between them every side gets a symmetric run of dashes
  const sq = (vx: number, vy: number) => {
    const p0 = P(vx, vy)
    const p1 = P(vx + t, vy + t)
    page.drawRectangle({ x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), width: Math.abs(p1.x - p0.x), height: Math.abs(p1.y - p0.y), color, borderWidth: 0 })
  }
  sq(a, a)
  sq(W - a - t, a)
  sq(a, H - a - t)
  sq(W - a - t, H - a - t)
  const hLen = W - 2 * a - 2 * t
  const vLen = H - 2 * a - 2 * t
  const hp = dashPattern(hLen, t)
  const vp = dashPattern(vLen, t)
  line(a + t, bottom, W - a - t, bottom, [hp.dash, hp.gap])
  line(a + t, top, W - a - t, top, [hp.dash, hp.gap])
  line(left, a + t, left, H - a - t, [vp.dash, vp.gap])
  line(right, a + t, right, H - a - t, [vp.dash, vp.gap])
}

/** Draw a border on the chosen pages, relative to the page box, even on all four sides and fully inside the page. */
export async function addBorder(bytes: Uint8Array, opts: BorderOptions, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const { insetPt: inset, thicknessPt: t } = opts
  if (!(t > 0 && t <= 40)) throw new PdfOpError('The border thickness must be between 0 and 40 points.')
  if (!(inset >= 0)) throw new PdfOpError('The distance from the page edge must be zero or more.')
  const doc = await loadDoc(bytes)
  const total = doc.getPageCount()
  const targets = opts.pages ?? doc.getPageIndices().map((i) => i + 1)
  if (!targets.length) throw new PdfOpError('Select at least one page.')
  for (const p of targets) {
    if (p < 1 || p > total) throw new PdfOpError(`Page ${p} does not exist (the document has ${total}).`)
    const { width, height } = visualSize(doc.getPage(p - 1))
    if (width - 2 * (inset + t) < 20 || height - 2 * (inset + t) < 20) throw new PdfOpError(`The border does not fit on page ${p}: reduce the distance from the edge or the thickness.`)
  }
  targets.forEach((p, i) => {
    drawBorder(doc.getPage(p - 1), opts)
    onProgress(0.1 + (0.8 * (i + 1)) / targets.length)
  })
  const result = await pdfSave(doc)
  onProgress(1)
  return result
}
