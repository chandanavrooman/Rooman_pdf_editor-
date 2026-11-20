import { PDFDocument } from 'pdf-lib'
import { loadDoc, noProgress, pdfSave, PdfOpError, visibleBox, visualSize, visualToPage, pageRotation, type ProgressFn } from './common'
import { drawUpright } from './layout'

/** A rendered page: RGBA pixels, `scale` pixels per point, white background. */
export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
  scale: number
}
/** Renders one page of `pdf` upright (rotation applied) on white. */
export type PageRenderer = (pdf: Uint8Array, pageIndex: number) => Promise<Raster>

export interface Margins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface MarginOptions {
  /** the same on all four sides, in points */
  marginPt?: number
  /** a different margin per side, in points (wins over marginPt) */
  margins?: Margins
  /** only these pages (0-based) are processed and returned, in this order; default: every page (used by the live preview) */
  pages?: number[]
  /**
   * true: the margin is measured from the page's VISIBLE content (what is actually printed), so the content's edges - not the page's own
   * white border - end up `marginPt` from the sheet edge.  false: the whole page area is scaled into the margin box.
   */
  fitToContent: boolean
  /** needed when fitToContent is true */
  render?: PageRenderer
}

/** Bounds of everything that is not (nearly) white, in VISUAL points with a top-left origin. Null for a blank page. */
export function inkBounds(r: Raster, threshold = 248): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = r.width
  let y0 = r.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < r.height; y++) {
    const row = y * r.width * 4
    for (let x = 0; x < r.width; x++) {
      const i = row + x * 4
      if (r.data[i + 3] > 8 && (r.data[i] < threshold || r.data[i + 1] < threshold || r.data[i + 2] < threshold)) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x0: x0 / r.scale, y0: y0 / r.scale, x1: (x1 + 1) / r.scale, y1: (y1 + 1) / r.scale }
}

/**
 * Keep every page's size. Scale its content (uniformly, never stretched) to fit inside a box inset by `marginPt` on all four sides,
 * and centre it horizontally AND vertically - so top and bottom (and left and right) are always equal and nothing is left blank at one end.
 */
export async function applyMargins(bytes: Uint8Array, opts: MarginOptions, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const mg: Margins = opts.margins ?? { top: opts.marginPt ?? NaN, right: opts.marginPt ?? NaN, bottom: opts.marginPt ?? NaN, left: opts.marginPt ?? NaN }
  for (const v of [mg.top, mg.right, mg.bottom, mg.left]) if (!Number.isFinite(v) || v < 0) throw new PdfOpError('Every margin must be a number, zero or more.')
  if (opts.fitToContent && !opts.render) throw new PdfOpError('Measuring the content needs a page renderer.')
  const src = await loadDoc(bytes)
  const all = src.getPages()
  const indexes = opts.pages ?? all.map((_, i) => i)
  for (const i of indexes) if (!all[i]) throw new PdfOpError(`The file has no page ${i + 1}.`)
  const pages = indexes.map((i) => all[i])
  const out = await PDFDocument.create()
  const embedded = []
  const sizes = []
  const mm = (pt: number) => (pt / (72 / 25.4)).toFixed(1)
  for (let n = 0; n < pages.length; n++) {
    const i = indexes[n]
    const page = pages[n]
    const vs = visualSize(page)
    if (vs.width - mg.left - mg.right < 20 || vs.height - mg.top - mg.bottom < 20) {
      const wide = vs.width - mg.left - mg.right < 20
      throw new PdfOpError(`The ${wide ? `left and right margins (${mm(mg.left)} + ${mm(mg.right)} mm)` : `top and bottom margins (${mm(mg.top)} + ${mm(mg.bottom)} mm)`} leave no room on page ${i + 1}, which is ${mm(wide ? vs.width : vs.height)} mm ${wide ? 'wide' : 'tall'}.`)
    }
    const box = visibleBox(page)
    let bb = { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height }
    if (opts.fitToContent && opts.render) {
      const ink = inkBounds(await opts.render(bytes, i))
      if (ink) {
        // visual (top-left origin) -> visual (bottom-left) -> unrotated page space
        const a = visualToPage(page, ink.x0, vs.height - ink.y1)
        const b = visualToPage(page, ink.x1, vs.height - ink.y0)
        bb = {
          left: Math.max(box.x, Math.min(a.x, b.x)),
          right: Math.min(box.x + box.width, Math.max(a.x, b.x)),
          bottom: Math.max(box.y, Math.min(a.y, b.y)),
          top: Math.min(box.y + box.height, Math.max(a.y, b.y)),
        }
      }
    }
    embedded.push(await out.embedPage(page, bb))
    sizes.push(vs)
    onProgress(0.05 + (0.45 * (n + 1)) / pages.length, 'Measuring')
  }
  for (let i = 0; i < pages.length; i++) {
    const { width: W, height: H } = sizes[i]
    const sheet = out.addPage([W, H])
    // the content is scaled to fit the area inside the margins and centred in it
    drawUpright(sheet, embedded[i], pageRotation(pages[i]), { x: mg.left, y: mg.bottom, width: W - mg.left - mg.right, height: H - mg.top - mg.bottom }, 'fit')
    onProgress(0.5 + (0.45 * (i + 1)) / pages.length)
  }
  const result = await pdfSave(out)
  onProgress(1)
  return result
}
