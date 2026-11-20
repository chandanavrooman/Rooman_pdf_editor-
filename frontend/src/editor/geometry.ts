import type { PDFPage } from 'pdf-lib'
import type { Box, EditorObject, Pt } from './types'
import { hasPts } from './types'

/** Matrix [a b c d e f] as used by PDF `cm`: x' = a x + c y + e ; y' = b x + d y + f */
export type Matrix = [number, number, number, number, number, number]

export interface PageGeometry {
  /** visible box in PDF user space (cropbox ∩ mediabox), as pdf.js uses: [x0, y0, x1, y1] */
  view: [number, number, number, number]
  /** page /Rotate normalised to 0|90|180|270 */
  rotate: 0 | 90 | 180 | 270
  /** page size in page space (what the user sees), points */
  width: number
  height: number
  /** page space -> PDF user space */
  matrix: Matrix
}

export function geometryFromBoxes(media: Box, crop: Box | null, rotation: number): PageGeometry {
  const mx0 = media.x
  const my0 = media.y
  const mx1 = media.x + media.w
  const my1 = media.y + media.h
  let x0 = mx0
  let y0 = my0
  let x1 = mx1
  let y1 = my1
  if (crop) {
    const cx0 = Math.max(mx0, Math.min(crop.x, crop.x + crop.w))
    const cy0 = Math.max(my0, Math.min(crop.y, crop.y + crop.h))
    const cx1 = Math.min(mx1, Math.max(crop.x, crop.x + crop.w))
    const cy1 = Math.min(my1, Math.max(crop.y, crop.y + crop.h))
    if (cx1 > cx0 && cy1 > cy0) {
      x0 = cx0
      y0 = cy0
      x1 = cx1
      y1 = cy1
    }
  }
  const rotate = ((((Math.round(rotation / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270
  const vw = x1 - x0
  const vh = y1 - y0
  const swap = rotate === 90 || rotate === 270
  let matrix: Matrix
  switch (rotate) {
    case 0:
      matrix = [1, 0, 0, -1, x0, y1]
      break
    case 90:
      matrix = [0, 1, 1, 0, x0, y0]
      break
    case 180:
      matrix = [-1, 0, 0, 1, x1, y0]
      break
    default:
      matrix = [0, -1, -1, 0, x1, y1]
  }
  return { view: [x0, y0, x1, y1], rotate, width: swap ? vh : vw, height: swap ? vw : vh, matrix }
}

export function pageGeometry(page: PDFPage): PageGeometry {
  const m = page.getMediaBox()
  const c = page.getCropBox()
  return geometryFromBoxes({ x: m.x, y: m.y, w: m.width, h: m.height }, { x: c.x, y: c.y, w: c.width, h: c.height }, page.getRotation().angle)
}

export function psToPdf(g: PageGeometry, p: Pt): Pt {
  const [a, b, c, d, e, f] = g.matrix
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f }
}

export function pdfToPs(g: PageGeometry, p: Pt): Pt {
  const [a, b, c, d, e, f] = g.matrix
  const det = a * d - b * c
  const dx = p.x - e
  const dy = p.y - f
  return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det }
}

/** Axis-aligned PDF-space bounding box of a page-space box. */
export function boxPsToPdf(g: PageGeometry, b: Box): Box {
  const pts = [psToPdf(g, { x: b.x, y: b.y }), psToPdf(g, { x: b.x + b.w, y: b.y }), psToPdf(g, { x: b.x, y: b.y + b.h }), psToPdf(g, { x: b.x + b.w, y: b.y + b.h })]
  return bboxOf(pts)
}

export function boxPdfToPs(g: PageGeometry, b: Box): Box {
  const pts = [pdfToPs(g, { x: b.x, y: b.y }), pdfToPs(g, { x: b.x + b.w, y: b.y }), pdfToPs(g, { x: b.x, y: b.y + b.h }), pdfToPs(g, { x: b.x + b.w, y: b.y + b.h })]
  return bboxOf(pts)
}

export function bboxOf(pts: Pt[]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function normBox(a: Pt, b: Pt): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Hit test in page space. `tol` is in points. */
/** Rotate `p` clockwise (screen, y down) by `deg` about `c`. */
export function rotateAbout(p: Pt, c: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}
export const boxCenter = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
export const rotationOf = (o: EditorObject): number => (o.type === 'image' || o.type === 'signature' ? o.rotation ?? 0 : 0)

export function hitTest(o: EditorObject, p: Pt, tol: number): boolean {
  if ((o.type === 'image' || o.type === 'signature') && o.rotation) p = rotateAbout(p, boxCenter(o), -o.rotation)
  if (o.type === 'line' || o.type === 'arrow') return distToSegment(p, o.pts[0], o.pts[1]) <= Math.max(tol, o.strokeWidth / 2 + 1)
  if (o.type === 'draw') {
    if (!(p.x >= o.x - tol && p.x <= o.x + o.w + tol && p.y >= o.y - tol && p.y <= o.y + o.h + tol)) return false
    const t = Math.max(tol, o.strokeWidth / 2 + 1)
    if (o.pts.length === 1) return Math.hypot(p.x - o.pts[0].x, p.y - o.pts[0].y) <= t
    for (let i = 1; i < o.pts.length; i++) if (distToSegment(p, o.pts[i - 1], o.pts[i]) <= t) return true
    return false
  }
  return p.x >= o.x - tol && p.x <= o.x + o.w + tol && p.y >= o.y - tol && p.y <= o.y + o.h + tol
}

function remapPts(pts: Pt[], from: Box, to: Box): Pt[] {
  const sx = from.w > 1e-9 ? to.w / from.w : 1
  const sy = from.h > 1e-9 ? to.h / from.h : 1
  return pts.map((p) => ({
    x: from.w > 1e-9 ? to.x + (p.x - from.x) * sx : to.x + (p.x - from.x),
    y: from.h > 1e-9 ? to.y + (p.y - from.y) * sy : to.y + (p.y - from.y),
  }))
}

/** Move/resize an object to a new bounding box (point-based objects are remapped). */
export function applyBox<T extends EditorObject>(o: T, box: Box): T {
  if (o.type === 'table') return o // a table's position comes from its model (rows, columns, origin)
  if (hasPts(o)) {
    const from = { x: o.x, y: o.y, w: o.w, h: o.h }
    const pts = remapPts(o.pts, from, box)
    const nb = bboxOf(pts)
    return { ...o, pts: pts as never, x: nb.x, y: nb.y, w: nb.w, h: nb.h }
  }
  // text that came from the PDF sits on a baseline: when the box moves down or up, the baseline moves with it (otherwise the text stays behind)
  if (o.type === 'text' && o.baseline !== undefined) return { ...o, x: box.x, y: box.y, w: box.w, h: box.h, baseline: o.baseline + (box.y - o.y) }
  return { ...o, x: box.x, y: box.y, w: box.w, h: box.h }
}

export function moveObject<T extends EditorObject>(o: T, dx: number, dy: number): T {
  return applyBox(o, { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h })
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'spread-h' | 'spread-v'

/** How far each box has to move (x, y) to line up with the others. `spread-*` spaces three or more boxes evenly between the outer two. */
export function alignDeltas(boxes: Box[], mode: AlignMode): { dx: number; dy: number }[] {
  if (!boxes.length) return []
  const x0 = Math.min(...boxes.map((b) => b.x))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const y1 = Math.max(...boxes.map((b) => b.y + b.h))
  if (mode === 'spread-h' || mode === 'spread-v') {
    const h = mode === 'spread-h'
    const order = boxes.map((b, i) => ({ i, p: h ? b.x : b.y })).sort((a, b) => a.p - b.p)
    const size = (b: Box) => (h ? b.w : b.h)
    const start = h ? x0 : y0
    const total = (h ? x1 - x0 : y1 - y0) - boxes.reduce((a, b) => a + size(b), 0)
    const gap = boxes.length > 1 ? total / (boxes.length - 1) : 0
    const out = boxes.map(() => ({ dx: 0, dy: 0 }))
    let pos = start
    for (const { i } of order) {
      const b = boxes[i]
      if (h) out[i].dx = pos - b.x
      else out[i].dy = pos - b.y
      pos += size(b) + gap
    }
    return out
  }
  return boxes.map((b) => ({
    dx: mode === 'left' ? x0 - b.x : mode === 'right' ? x1 - (b.x + b.w) : mode === 'center' ? (x0 + x1) / 2 - (b.x + b.w / 2) : 0,
    dy: mode === 'top' ? y0 - b.y : mode === 'bottom' ? y1 - (b.y + b.h) : mode === 'middle' ? (y0 + y1) / 2 - (b.y + b.h / 2) : 0,
  }))
}

export function boxOf(o: Box): Box {
  return { x: o.x, y: o.y, w: o.w, h: o.h }
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
