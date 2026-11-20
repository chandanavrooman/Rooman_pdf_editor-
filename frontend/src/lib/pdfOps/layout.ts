import { PDFDocument, PDFEmbeddedPage, PDFPage, degrees, rgb } from 'pdf-lib'
import { loadDoc, noProgress, pdfSave, PdfOpError, visibleBox, visualSize, pageRotation, type ProgressFn } from './common'

export const PAGE_SIZES: Record<string, { label: string; width: number; height: number }> = {
  a0: { label: 'A0', width: 2383.94, height: 3370.39 },
  a1: { label: 'A1', width: 1683.78, height: 2383.94 },
  a2: { label: 'A2', width: 1190.55, height: 1683.78 },
  a3: { label: 'A3', width: 841.89, height: 1190.55 },
  a4: { label: 'A4', width: 595.28, height: 841.89 },
  a5: { label: 'A5', width: 419.53, height: 595.28 },
  a6: { label: 'A6', width: 297.64, height: 419.53 },
  letter: { label: 'US Letter', width: 612, height: 792 },
  legal: { label: 'US Legal', width: 612, height: 1008 },
  tabloid: { label: 'Tabloid', width: 792, height: 1224 },
}

/**
 * Draw an embedded source page onto `target`, inside the cell (x,y,w,h) in the target's
 * coordinate system, scaled uniformly to fit and centred. Honours the source's /Rotate so the
 * page lands upright exactly as the user saw it. Returns the scale used.
 */
export function drawUpright(
  target: PDFPage,
  embedded: PDFEmbeddedPage,
  rotation: 0 | 90 | 180 | 270,
  cell: { x: number; y: number; width: number; height: number },
  mode: 'fit' | 'fill' = 'fit',
): number {
  const sw = embedded.width
  const sh = embedded.height
  const swap = rotation === 90 || rotation === 270
  const vw = swap ? sh : sw
  const vh = swap ? sw : sh
  const s = mode === 'fit' ? Math.min(cell.width / vw, cell.height / vh) : Math.max(cell.width / vw, cell.height / vh)
  const dw = vw * s
  const dh = vh * s
  const ox = cell.x + (cell.width - dw) / 2
  const oy = cell.y + (cell.height - dh) / 2
  // pdf-lib applies: scale, then rotate about (x,y), then translate. Compensate so the rotated
  // content's lower-left corner sits at (ox, oy).
  let tx = ox
  let ty = oy
  let rot = 0
  if (rotation === 90) {
    rot = -90
    ty = oy + sw * s
  } else if (rotation === 180) {
    rot = -180
    tx = ox + sw * s
    ty = oy + sh * s
  } else if (rotation === 270) {
    rot = -270
    tx = ox + sh * s
  }
  target.drawPage(embedded, { x: tx, y: ty, xScale: s, yScale: s, rotate: degrees(rot) })
  return s
}

async function embedAll(out: PDFDocument, src: PDFDocument): Promise<PDFEmbeddedPage[]> {
  const pages = src.getPages()
  const boxes = pages.map((p) => {
    const b = visibleBox(p)
    return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }
  })
  return out.embedPages(pages, boxes)
}

export interface ResizeOptions {
  width: number
  height: number
  /** 'fit' keeps the whole page; 'fill' covers the sheet (may crop edges). */
  mode: 'fit' | 'fill'
  /** Each page gets a sheet with the same orientation as the page itself (portrait stays portrait, landscape stays landscape). */
  autoOrient: boolean
  /** Used when autoOrient is off: every sheet is portrait or landscape. Left out: width and height are used exactly as given. */
  orientation?: 'portrait' | 'landscape'
  /** 1-based pages to resize; every other page is copied through unchanged. Default: all pages. */
  pages?: number[]
  background?: { r: number; g: number; b: number }
}

/** The sheet size one page gets: the paper size, turned to match the page or to the chosen orientation. */
export function targetSize(opts: Pick<ResizeOptions, 'width' | 'height' | 'autoOrient' | 'orientation'>, pageWidth: number, pageHeight: number): [number, number] {
  const short = Math.min(opts.width, opts.height)
  const long = Math.max(opts.width, opts.height)
  if (opts.autoOrient) return pageWidth > pageHeight ? [long, short] : [short, long]
  if (opts.orientation) return opts.orientation === 'landscape' ? [long, short] : [short, long]
  return [opts.width, opts.height]
}

export interface FitPlan {
  /** page -> sheet scale */
  scale: number
  /** the page as drawn, in sheet units */
  drawWidth: number
  drawHeight: number
  /** white space on each side (fit) in sheet units */
  padX: number
  padY: number
  /** part of the page's width / height that falls off the sheet (fill), 0..1 */
  cropX: number
  cropY: number
}

/** The exact Fit / Fill arithmetic (the same as drawUpright), for showing numbers before the PDF is made. */
export function fitPlan(pageWidth: number, pageHeight: number, sheetWidth: number, sheetHeight: number, mode: 'fit' | 'fill'): FitPlan {
  const scale = mode === 'fit' ? Math.min(sheetWidth / pageWidth, sheetHeight / pageHeight) : Math.max(sheetWidth / pageWidth, sheetHeight / pageHeight)
  const drawWidth = pageWidth * scale
  const drawHeight = pageHeight * scale
  return {
    scale,
    drawWidth,
    drawHeight,
    padX: Math.max(0, (sheetWidth - drawWidth) / 2),
    padY: Math.max(0, (sheetHeight - drawHeight) / 2),
    cropX: drawWidth > sheetWidth + 0.01 ? 1 - sheetWidth / drawWidth : 0,
    cropY: drawHeight > sheetHeight + 0.01 ? 1 - sheetHeight / drawHeight : 0,
  }
}

/** Resize the chosen pages (default: all) to a paper size, scaling content uniformly. Pages that were not chosen are copied through untouched. */
export async function resizePages(bytes: Uint8Array, opts: ResizeOptions, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  if (!(opts.width > 10 && opts.height > 10)) throw new PdfOpError('Width and height must be larger than 10 points.')
  if (opts.width > 14400 || opts.height > 14400) throw new PdfOpError('Pages larger than 14400 points (200 in) are not supported.')
  const src = await loadDoc(bytes)
  const pages = src.getPages()
  const chosen = new Set((opts.pages ?? pages.map((_, i) => i + 1)).map((n) => {
    if (!Number.isInteger(n) || n < 1 || n > pages.length) throw new PdfOpError(`Page ${n} does not exist (the document has ${pages.length}).`)
    return n - 1
  }))
  if (!chosen.size) throw new PdfOpError('Choose at least one page to resize.')
  const out = await PDFDocument.create()
  onProgress(0.1, 'Preparing pages')
  const indexes = [...chosen].sort((a, b) => a - b)
  const boxes = indexes.map((i) => {
    const b = visibleBox(pages[i])
    return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }
  })
  const embeddedList = await out.embedPages(indexes.map((i) => pages[i]), boxes)
  const embedded = new Map(indexes.map((i, k) => [i, embeddedList[k]]))
  for (let i = 0; i < pages.length; i++) {
    if (!chosen.has(i)) {
      const [copy] = await out.copyPages(src, [i])
      out.addPage(copy)
    } else {
      const vs = visualSize(pages[i])
      const [w, h] = targetSize(opts, vs.width, vs.height)
      const page = out.addPage([w, h])
      if (opts.background) page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(opts.background.r, opts.background.g, opts.background.b) })
      drawUpright(page, embedded.get(i)!, vs.rotation, { x: 0, y: 0, width: w, height: h }, opts.mode)
    }
    onProgress(0.1 + (0.8 * (i + 1)) / pages.length)
  }
  const result = await pdfSave(out)
  onProgress(1)
  return result
}

export interface NUpOptions {
  perSheet: 2 | 4 | 6 | 9
  sheetWidth: number
  sheetHeight: number
  /** Landscape orientation of the sheet (swaps width/height if needed). */
  landscape: boolean
  margin: number
  gap: number
  border: boolean
  /** left-to-right rows (default) or top-to-bottom columns */
  order: 'row' | 'column'
}

export const NUP_GRID: Record<2 | 4 | 6 | 9, { cols: number; rows: number }> = {
  2: { cols: 2, rows: 1 },
  4: { cols: 2, rows: 2 },
  6: { cols: 3, rows: 2 },
  9: { cols: 3, rows: 3 },
}

/** Put N pages on each sheet. */
export async function nUp(bytes: Uint8Array, opts: NUpOptions, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const grid = NUP_GRID[opts.perSheet]
  if (!grid) throw new PdfOpError('Pages per sheet must be 2, 4, 6 or 9.')
  const src = await loadDoc(bytes)
  const out = await PDFDocument.create()
  onProgress(0.1, 'Preparing pages')
  const embedded = await embedAll(out, src)
  const pages = src.getPages()
  let W = Math.min(opts.sheetWidth, opts.sheetHeight)
  let H = Math.max(opts.sheetWidth, opts.sheetHeight)
  if (opts.landscape) [W, H] = [H, W]
  const cellW = (W - 2 * opts.margin - (grid.cols - 1) * opts.gap) / grid.cols
  const cellH = (H - 2 * opts.margin - (grid.rows - 1) * opts.gap) / grid.rows
  if (cellW <= 5 || cellH <= 5) throw new PdfOpError('Margins and gaps are too large for this sheet size.')
  const per = opts.perSheet
  for (let i = 0; i < pages.length; i += per) {
    const sheet = out.addPage([W, H])
    for (let k = 0; k < per && i + k < pages.length; k++) {
      const col = opts.order === 'row' ? k % grid.cols : Math.floor(k / grid.rows)
      const row = opts.order === 'row' ? Math.floor(k / grid.cols) : k % grid.rows
      const cell = {
        x: opts.margin + col * (cellW + opts.gap),
        y: H - opts.margin - (row + 1) * cellH - row * opts.gap,
        width: cellW,
        height: cellH,
      }
      const rot = pageRotation(pages[i + k])
      drawUpright(sheet, embedded[i + k], rot, cell, 'fit')
      if (opts.border) {
        sheet.drawRectangle({ ...cell, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 })
      }
    }
    onProgress(0.1 + (0.8 * Math.min(pages.length, i + per)) / pages.length)
  }
  const result = await pdfSave(out)
  onProgress(1)
  return result
}
