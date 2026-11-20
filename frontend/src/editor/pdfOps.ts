import type { PDFDocumentProxy } from 'pdfjs-dist'

type Page = Awaited<ReturnType<PDFDocumentProxy['getPage']>>
type Viewport = ReturnType<Page['getViewport']>

export interface ShapeRect {
  x: number
  y: number
  w: number
  h: number
  /** fill color (#rrggbb) at the moment it was painted */
  color: string
}
export interface HLine {
  y: number
  x0: number
  x1: number
  /** stroke colour (#rrggbb) and width in points, when the rule was stroked as a line */
  color?: string
  width?: number
}
export interface VLine {
  x: number
  y0: number
  y1: number
  color?: string
  width?: number
}
/** Everything the page paints that is not text, in PAGE SPACE (points, top-left origin). */
export interface PageShapes {
  rects: ShapeRect[]
  hlines: HLine[]
  vlines: VLine[]
}
export interface OpsInfo {
  /** the PDF's own fill color for every character, in drawing order */
  chars: { ch: string; color: string; alpha: number; cs: number; ws: number }[]
  shapes: PageShapes
  /** pictures the page paints (bounding box in page space) */
  images: { x: number; y: number; w: number; h: number; /** pdf.js object id of the picture (when it has one) */ id?: string; /** an image drawn inline in the page content */ inline?: Record<string, unknown>; /** drawn upright, unmirrored and unrotated on the page: its own pixels can be used as they are */ upright: boolean }[]
}

type M = [number, number, number, number, number, number]
const IDENT: M = [1, 0, 0, 1, 0, 0]
/** apply `b` first, then `a` */
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]

const THIN = 1.3

/**
 * One pass over the operator list: the fill color of every character (honouring q/Q), and every filled rectangle / ruled line
 * (honouring the current transformation matrix), converted to page space.
 */
export async function analyzeOps(page: Page, vp: Viewport): Promise<OpsInfo> {
  const out: OpsInfo = { chars: [], shapes: { rects: [], hlines: [], vlines: [] }, images: [] }
  try {
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const ol = await page.getOperatorList()
    const stack: { fill: string; ctm: M; alpha: number; cs: number; ws: number; stroke: string; lw: number }[] = []
    let fill = '#000000'
    let alpha = 1
    let stroke = '#000000'
    let lw = 1
    let cs = 0 // Tc: extra space after every character
    let ws = 0 // Tw: extra space after every space
    let ctm: M = IDENT
    const toPs = (x: number, y: number): [number, number] => {
      const ux = ctm[0] * x + ctm[2] * y + ctm[4]
      const uy = ctm[1] * x + ctm[3] * y + ctm[5]
      return vp.convertToViewportPoint(ux, uy) as [number, number]
    }
    const FILLS = new Set<number>([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])
    const STROKES = new Set<number>([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])

    const addRect = (x0: number, y0: number, x1: number, y1: number, color: string) => {
      const x = Math.min(x0, x1)
      const y = Math.min(y0, y1)
      const w = Math.abs(x1 - x0)
      const h = Math.abs(y1 - y0)
      if (h <= THIN && w > 4) out.shapes.hlines.push({ y: y + h / 2, x0: x, x1: x + w })
      else if (w <= THIN && h > 4) out.shapes.vlines.push({ x: x + w / 2, y0: y, y1: y + h })
      else if (w > 1 && h > 1) out.shapes.rects.push({ x, y, w, h, color })
    }
    const addLine = (ax: number, ay: number, bx: number, by: number) => {
      const width = lw * Math.hypot(ctm[0], ctm[1])
      if (Math.abs(ay - by) < 0.3 && Math.abs(ax - bx) > 4) out.shapes.hlines.push({ y: (ay + by) / 2, x0: Math.min(ax, bx), x1: Math.max(ax, bx), color: stroke, width })
      else if (Math.abs(ax - bx) < 0.3 && Math.abs(ay - by) > 4) out.shapes.vlines.push({ x: (ax + bx) / 2, y0: Math.min(ay, by), y1: Math.max(ay, by), color: stroke, width })
    }

    for (let i = 0; i < ol.fnArray.length; i++) {
      const op = ol.fnArray[i]
      const args = ol.argsArray[i] as unknown[] | null
      if (op === OPS.save || op === OPS.paintFormXObjectBegin) {
        stack.push({ fill, ctm, alpha, cs, ws, stroke, lw })
        // a form XObject (Word, Canva, Chrome and many tools wrap pictures in one) carries its own matrix
        const fm = op === OPS.paintFormXObjectBegin ? (args?.[0] as ArrayLike<number> | undefined) : undefined // a plain or typed array
        if (fm && fm.length === 6) ctm = mul(ctm, [fm[0], fm[1], fm[2], fm[3], fm[4], fm[5]])
      } else if (op === OPS.restore || op === OPS.paintFormXObjectEnd) {
        const s = stack.pop()
        if (s) {
          fill = s.fill
          ctm = s.ctm
          alpha = s.alpha
          cs = s.cs
          ws = s.ws
          stroke = s.stroke
          lw = s.lw
        }
      } else if (op === OPS.transform && args) ctm = mul(ctm, args as unknown as M)
      else if (op === OPS.setStrokeRGBColor && args && typeof args[0] === 'string') stroke = args[0]
      else if (op === OPS.setLineWidth && args && typeof args[0] === 'number') lw = args[0]
      else if (op === OPS.setCharSpacing && args && typeof args[0] === 'number') cs = args[0]
      else if (op === OPS.setWordSpacing && args && typeof args[0] === 'number') ws = args[0]
      else if (op === OPS.setGState && args) {
        // ExtGState: [['ca', 0.5], …] - the fill opacity
        for (const kv of (args[0] as unknown[]) ?? []) if (Array.isArray(kv) && kv[0] === 'ca' && typeof kv[1] === 'number') alpha = Math.max(0, Math.min(1, kv[1]))
      } else if (op === OPS.setFillRGBColor || op === OPS.setFillGray || op === OPS.setFillCMYKColor) {
        if (args && typeof args[0] === 'string' && args[0].startsWith('#')) fill = args[0]
      } else if (op === OPS.showText || op === OPS.showSpacedText || op === OPS.nextLineShowText || op === OPS.nextLineSetSpacingShowText) {
        const glyphs = (op === OPS.nextLineSetSpacingShowText ? args?.[2] : args?.[0]) as unknown[] | undefined
        for (const g of glyphs ?? []) {
          const u = (g as { unicode?: string } | null)?.unicode
          if (typeof u === 'string') for (const ch of u) out.chars.push({ ch, color: fill, alpha, cs, ws })
        }
      } else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
        // (image MASKS are stencils - glyph bitmaps, shading - not pictures)
        const pts = [toPs(0, 0), toPs(1, 0), toPs(0, 1), toPs(1, 1)] // bottom-left, bottom-right, top-left, top-right of the picture
        const xs = pts.map((q) => q[0])
        const ys = pts.map((q) => q[1])
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        const x1 = Math.max(...xs)
        const y1 = Math.max(...ys)
        const near = (a: number, b: number) => Math.abs(a - b) < 0.75
        const upright = near(pts[2][0], x) && near(pts[2][1], y) && near(pts[1][0], x1) && near(pts[0][1], y1)
        const first = args?.[0]
        out.images.push({ x, y, w: x1 - x, h: y1 - y, upright, ...(op === OPS.paintImageXObject && typeof first === 'string' ? { id: first } : {}), ...(op === OPS.paintInlineImageXObject && first && typeof first === 'object' ? { inline: first as Record<string, unknown> } : {}) })
      } else if (op === OPS.constructPath && args) {
        const paint = args[0] as number
        const rawPath = (args[1] as unknown[] | undefined)?.[0]
        // pdf.js hands the path over as a Float32Array (or a plain array in older builds)
        if (!Array.isArray(rawPath) && !ArrayBuffer.isView(rawPath)) continue
        const pathArr = rawPath as ArrayLike<number>
        const doFill = FILLS.has(paint)
        const doStroke = STROKES.has(paint)
        if (!doFill && !doStroke) continue
        // decode: 0 = moveTo x y, 1 = lineTo x y, 2 = curveTo (6), 3 = quadTo (4), 4 = close
        const subs: [number, number][][] = []
        let cur: [number, number][] | null = null
        for (let k = 0; k < pathArr.length; ) {
          const code = pathArr[k] as number
          if (code === 0) {
            cur = [toPs(pathArr[k + 1] as number, pathArr[k + 2] as number)]
            subs.push(cur)
            k += 3
          } else if (code === 1) {
            cur?.push(toPs(pathArr[k + 1] as number, pathArr[k + 2] as number))
            k += 3
          } else if (code === 2) k += 7
          else if (code === 3) k += 5
          else k += 1
        }
        for (const pts of subs) {
          const closed = pts.length >= 4
          const xs = [...new Set(pts.map((p) => Math.round(p[0] * 100)))]
          const ys = [...new Set(pts.map((p) => Math.round(p[1] * 100)))]
          const isRect = closed && pts.length <= 5 && xs.length === 2 && ys.length === 2
          if (isRect) {
            const x0 = Math.min(...pts.map((p) => p[0]))
            const x1 = Math.max(...pts.map((p) => p[0]))
            const y0 = Math.min(...pts.map((p) => p[1]))
            const y1 = Math.max(...pts.map((p) => p[1]))
            if (doFill) addRect(x0, y0, x1, y1, fill)
            if (doStroke) {
              addLine(x0, y0, x1, y0)
              addLine(x0, y1, x1, y1)
              addLine(x0, y0, x0, y1)
              addLine(x1, y0, x1, y1)
            }
          } else if (doStroke) for (let k = 1; k < pts.length; k++) addLine(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1])
        }
      }
    }
  } catch (e) {
    void e
    /* no shapes / colors available */
  }
  return out
}
