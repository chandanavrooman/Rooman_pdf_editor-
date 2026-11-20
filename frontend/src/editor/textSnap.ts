import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Box, Family } from './types'
import { bboxOf } from './geometry'
import { detectFont, type FontId } from './fontCatalog'
import { measureText } from './textLayout'
import { ensureEmbeddedFace, registerEmbedded } from './embeddedFonts'
import { analyzeOps } from './pdfOps'
import { detectCells, type Cell } from './tables'

export interface SnapItem {
  str: string
  box: Box
  fontSize?: number
  family?: Family
  bold?: boolean
  italic?: boolean
  /** exact start of the run on its baseline, page space. Only set for plain horizontal text on an unrotated page. */
  origin?: { x: number; baseline: number; w: number }
  /** bundled font that best matches the PDF's own font, and the PDF's original font name */
  fontId?: FontId
  fontUsed?: string
  /** the PDF does not embed this font; viewers draw it from their own copy of the standard font */
  sysFont?: boolean
  /** the PDF's own embedded TrueType font for this run (key into embeddedFonts) */
  embedKey?: string
  /** sampled from the rendered page: the text color and the background directly around the run (#rrggbb) */
  color?: string
  bg?: string
  /** the PDF's own Tc / Tw (points) in force for this run */
  charSpacing?: number
  wordSpacing?: number
  /** fill opacity when the PDF paints the text with transparency */
  opacity?: number
  /** where `color` came from: the PDF's own fill color operator, or sampled from the rendered page */
  colorSource?: 'pdf' | 'sampled'
  /** font name exactly as pdf.js reports it (subset prefix kept) */
  rawFont?: string
  /** true for empty / whitespace-only items (only returned with `includeEmpty`) */
  blank?: boolean
  /** the table cell this run belongs to (its own text block), when the page has a table */
  cell?: Cell
}

/** Rendered page pixels used to sample real colors. */
export interface PixelSource {
  width: number
  height: number
  data: Uint8ClampedArray
  /** pixels per point */
  scale: number
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0')
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`
const dist = (r: number, g: number, b: number, c: [number, number, number]) => Math.hypot(r - c[0], g - c[1], b - c[2])

/**
 * Colors of one text run, read from the page as pdf.js painted it.
 * Background = the most common color in a thin ring just OUTSIDE the run's box (left/right/top/bottom).
 * Text color = the average of the pixels inside the box that are farthest from that background.
 */
export function sampleRun(src: PixelSource, x: number, baseline: number, w: number, size: number): { color?: string; bg?: string } {
  const k = src.scale
  const x0 = Math.max(0, Math.floor((x - 0.5) * k))
  const x1 = Math.min(src.width - 1, Math.ceil((x + w + 0.5) * k))
  const y0 = Math.max(0, Math.floor((baseline - size * 0.8) * k))
  const y1 = Math.min(src.height - 1, Math.ceil((baseline + size * 0.22) * k))
  if (x1 <= x0 || y1 <= y0) return {}
  const px = (xx: number, yy: number): [number, number, number] => {
    const i = (yy * src.width + xx) * 4
    return [src.data[i], src.data[i + 1], src.data[i + 2]]
  }
  const gap = Math.max(2, Math.round(1.5 * k))
  const ring = new Map<string, { n: number; c: [number, number, number] }>()
  const addRing = (xx: number, yy: number) => {
    if (xx < 0 || yy < 0 || xx >= src.width || yy >= src.height) return
    const c = px(xx, yy)
    const key = `${c[0] >> 3},${c[1] >> 3},${c[2] >> 3}`
    const e = ring.get(key)
    if (e) e.n++
    else ring.set(key, { n: 1, c })
  }
  for (let yy = y0; yy <= y1; yy++) {
    for (let g = 1; g <= 3; g++) {
      addRing(x0 - gap - g, yy)
      addRing(x1 + gap + g, yy)
    }
  }
  for (let xx = x0; xx <= x1; xx += 2) {
    addRing(xx, y0 - gap)
    addRing(xx, y1 + gap)
  }
  let bgC: [number, number, number] | null = null
  let best = 0
  for (const e of ring.values()) {
    if (e.n > best) {
      best = e.n
      bgC = e.c
    }
  }
  if (!bgC) return {}
  // text color: farthest pixels from the background inside the box
  let maxD = 0
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) maxD = Math.max(maxD, dist(...px(xx, yy), bgC))
  if (maxD < 40) return { bg: toHex(...bgC) } // blank run: no ink to sample
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) {
      const c = px(xx, yy)
      if (dist(...c, bgC) >= maxD * 0.85) {
        r += c[0]
        g += c[1]
        b += c[2]
        n++
      }
    }
  return { bg: toHex(...bgC), color: n ? toHex(r / n, g / n, b / n) : undefined }
}

/** Render a page offscreen (browser) so colors can be sampled. Returns null where no canvas exists. */
export async function renderPixelSource(page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>, scale = 3): Promise<PixelSource | null> {
  if (typeof document === 'undefined') return null
  try {
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, canvas, viewport }).promise
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return { width: canvas.width, height: canvas.height, data: img.data, scale }
  } catch {
    return null
  }
}

type RunStyle = { color: string; alpha: number; cs: number; ws: number }

/**
 * Match each text item to the style of its first visible character. Items and operators come in the same order, but pdf.js adds
 * spaces of its own between far-apart glyphs, so only the non-space characters are compared.
 */
function colorsForItems(strs: string[], chars: { ch: string; color: string; alpha: number; cs: number; ws: number }[]): (RunStyle | undefined)[] {
  const ink = chars.filter((c) => c.ch.trim())
  const res: (RunStyle | undefined)[] = []
  let p = 0
  for (const str of strs) {
    let found: RunStyle | undefined
    for (const ch of str) {
      if (!ch.trim()) continue
      let q = p
      while (q < ink.length && q < p + 24 && ink[q].ch !== ch) q++
      if (q < ink.length && ink[q].ch === ch) {
        if (!found) found = { color: ink[q].color, alpha: ink[q].alpha, cs: ink[q].cs, ws: ink[q].ws }
        p = q + 1
      }
    }
    res.push(found)
  }
  return res
}

/** Words of a run with x / width computed the way the editor positions unchanged characters (matched-font metrics scaled to the run's real width). */
export function wordBoxes(item: SnapItem): { text: string; x: number; w: number }[] {
  if (!item.origin) return []
  const style = { family: item.family ?? 'helvetica', fontId: item.fontId, size: item.fontSize ?? 10, bold: !!item.bold, italic: !!item.italic } as const
  const full = measureText(item.str, style)
  const k = full > 0 ? item.origin.w / full : 1
  const out: { text: string; x: number; w: number }[] = []
  for (const m of item.str.matchAll(/\S+/g)) {
    const i = m.index ?? 0
    out.push({ text: m[0], x: item.origin.x + k * measureText(item.str.slice(0, i), style), w: k * measureText(m[0], style) })
  }
  return out
}

export interface PageTextOptions {
  /** also return empty / whitespace-only items (debug view) */
  includeEmpty?: boolean
  /** also cut tables into cells (only the Table tool needs this; ordinary editing never does, as in Sejda) */
  tables?: boolean
  /** supply pixels for color sampling (default: render in the browser; none in node) */
  pixels?: (page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>) => Promise<PixelSource | null>
}

/** Text runs of one page as boxes in PAGE SPACE (points, top-left origin, page /Rotate applied). */
export async function pageTextBoxes(doc: PDFDocumentProxy, pageIndex: number, opts: PageTextOptions = {}): Promise<SnapItem[]> {
  const page = await doc.getPage(pageIndex + 1)
  const vp = page.getViewport({ scale: 1 })
  try {
    await page.getOperatorList()
  } catch {
    // fallback if operator list fails
  }
  const tc = await page.getTextContent()
  const fontCache = new Map<string, { bold?: boolean; italic?: boolean; loadedName?: string; name?: string; missingFile?: boolean; data?: unknown }>()
  if (tc.styles) {
    await Promise.all(
      Object.keys(tc.styles).map(
        (fn) =>
          new Promise<void>((resolve) => {
            try {
              page.commonObjs.get(fn, (f: { bold?: boolean; italic?: boolean; loadedName?: string; name?: string; missingFile?: boolean; data?: unknown } | null) => {
                if (f) fontCache.set(fn, f)
                resolve()
              })
            } catch {
              resolve()
            }
          })
      )
    )
  }
  const pixels = await (opts.pixels ?? renderPixelSource)(page)
  const embedKey = (fn: string, f?: { missingFile?: boolean; data?: unknown }) => {
    if (!fn || !f || f.missingFile) return undefined
    const k = registerEmbedded(`${(doc as { fingerprints?: (string | null)[] }).fingerprints?.[0] ?? 'doc'}:${fn}`, f.data)
    if (k) void ensureEmbeddedFace(k)
    return k
  }
  const textItems = tc.items.filter((x) => 'str' in x) as { str: string }[]
  const ops = await analyzeOps(page, vp)
  const pdfColors = colorsForItems(textItems.map((x) => x.str), ops.chars)
  let itemNo = -1
  const out: SnapItem[] = []
  for (const it of tc.items) {
    if (!('str' in it)) continue
    itemNo++
    const blank = !it.str.trim()
    if (blank && !opts.includeEmpty) continue
    const [a, b, c, d, e, f] = it.transform as number[]
    const hx = Math.hypot(a, b) || 1
    const hy = Math.hypot(c, d) || 1
    const xd = [a / hx, b / hx]
    const yd = [c / hy, d / hy]
    const asc = hy * 0.92
    const desc = hy * 0.24
    const w = it.width
    const corner = (u: number, v: number) => {
      const [x, y] = vp.convertToViewportPoint(e + xd[0] * u + yd[0] * v, f + xd[1] * u + yd[1] * v)
      return { x, y }
    }
    const box = bboxOf([corner(0, -desc), corner(w, -desc), corner(0, asc), corner(w, asc)])
    if ((box.w > 0.5 && box.h > 0.5) || (blank && opts.includeEmpty)) {
      const fn = (it as unknown as { fontName?: string }).fontName || ''
      const fontObj = fontCache.get(fn)
      const loadedRaw = fontObj?.loadedName || fn
      const loadedName = loadedRaw.toLowerCase()
      const style = tc.styles && fn ? tc.styles[fn] : undefined
      const styleFamily = (style?.fontFamily || '').toLowerCase()

      const isMono = styleFamily.includes('mono') || loadedName.includes('courier') || loadedName.includes('mono')
      const isSans = styleFamily.includes('sans') || loadedName.includes('helvetica') || loadedName.includes('arial') || loadedName.includes('sans')
      const isSerif = !isSans && (styleFamily.includes('serif') || loadedName.includes('times'))
      const family: Family = isMono ? 'courier' : isSerif ? 'times' : 'helvetica'

      const bold = Boolean(fontObj?.bold || loadedName.includes('bold') || loadedName.includes('black') || loadedName.includes('heavy'))
      const italic = Boolean(fontObj?.italic || loadedName.includes('italic') || loadedName.includes('oblique'))

      const rawName = fontObj?.name || ''
      const det = detectFont(rawName || loadedRaw, {
        cssFamily: styleFamily || (isSerif ? 'serif' : isMono ? 'monospace' : 'sans-serif'),
        bold,
        italic,
      })
      const size = Math.round(hy * 100) / 100
      const horizontal = vp.rotation === 0 && Math.abs(b) < 1e-3 && Math.abs(c) < 1e-3 && a > 0 && d > 0
      let origin: SnapItem['origin']
      let sampled: { color?: string; bg?: string } = {}
      if (horizontal) {
        const [ox, oy] = vp.convertToViewportPoint(e, f)
        origin = { x: ox, baseline: oy, w }
        if (pixels && !blank) sampled = sampleRun(pixels, ox, oy, w, size)
      }
      out.push({
        str: it.str,
        box,
        fontSize: size,
        family,
        bold: det.bold,
        italic: det.italic,
        origin,
        fontId: det.fontId,
        fontUsed: rawName ? det.original : /^g_d\d+_f\d+$/.test(loadedName) ? undefined : det.original,
        color: pdfColors[itemNo]?.color ?? sampled.color,
        opacity: pdfColors[itemNo] && pdfColors[itemNo]!.alpha < 1 ? pdfColors[itemNo]!.alpha : undefined,
        charSpacing: pdfColors[itemNo]?.cs || undefined,
        wordSpacing: pdfColors[itemNo]?.ws || undefined,
        colorSource: pdfColors[itemNo] ? 'pdf' : sampled.color ? 'sampled' : undefined,
        bg: sampled.bg,
        rawFont: rawName || loadedRaw,
        embedKey: embedKey(fn, fontObj),
        sysFont: fontObj?.missingFile && ['liberation-sans', 'liberation-serif', 'liberation-mono'].includes(det.fontId) ? true : undefined,
        blank: blank || undefined,
      })
    }
  }
  // one visual line = one edit box (pdf.js hands back "+91-" and "9113541977" as two items)
  const lines = opts.includeEmpty ? out : mergeLineRuns(out)
  // table cells are only data for the Table tool; ordinary editing never uses them
  if (opts.tables) for (const cell of detectCells(ops.shapes, lines)) for (const r of cell.runs) r.cell = cell
  return lines
}

const sameStyle = (a: SnapItem, b: SnapItem) =>
  a.fontId === b.fontId && !!a.bold === !!b.bold && !!a.italic === !!b.italic && Math.abs((a.fontSize ?? 0) - (b.fontSize ?? 0)) < 0.15 && (a.color ?? '').toLowerCase() === (b.color ?? '').toLowerCase() && (a.opacity ?? 1) === (b.opacity ?? 1)

/**
 * Join runs that sit on one baseline, in the same font / size / colour and touch or nearly touch, into one run per line.
 * A gap that is wider than a space gets the missing spaces back, so "everything at once" is not typed back as "everythingat once".
 * A real gap (columns, table cells, a label and its value) keeps the runs apart.
 */
export function mergeLineRuns(items: SnapItem[]): SnapItem[] {
  const res: SnapItem[] = []
  const byX = [...items].sort((a, b) => (a.origin?.baseline ?? a.box.y + a.box.h) - (b.origin?.baseline ?? b.box.y + b.box.h) || a.box.x - b.box.x)
  for (const it of byX) {
    const prev = res[res.length - 1]
    const size = it.fontSize ?? 10
    if (prev?.origin && it.origin && sameStyle(prev, it) && Math.abs(prev.origin.baseline - it.origin.baseline) < Math.max(0.6, size * 0.06)) {
      const gap = it.origin.x - (prev.origin.x + prev.origin.w)
      const space = Math.max(size * 0.25, 1)
      const joinedByText = /\s$/.test(prev.str) || /^\s/.test(it.str)
      if (gap > -size * 0.35 && gap < size * 1.2) {
        const missing = joinedByText ? 0 : gap > space * 0.55 ? Math.max(1, Math.round(gap / space)) : 0
        const x0 = prev.origin.x
        const x1 = Math.max(prev.origin.x + prev.origin.w, it.origin.x + it.origin.w)
        const y0 = Math.min(prev.box.y, it.box.y)
        const y1 = Math.max(prev.box.y + prev.box.h, it.box.y + it.box.h)
        const bx0 = Math.min(prev.box.x, it.box.x)
        const bx1 = Math.max(prev.box.x + prev.box.w, it.box.x + it.box.w)
        prev.str = prev.str + ' '.repeat(missing) + it.str
        prev.origin = { x: x0, baseline: prev.origin.baseline, w: x1 - x0 }
        prev.box = { x: bx0, y: y0, w: bx1 - bx0, h: y1 - y0 }
        prev.charSpacing = prev.charSpacing ?? it.charSpacing
        prev.wordSpacing = prev.wordSpacing ?? it.wordSpacing
        continue
      }
    }
    res.push({ ...it })
  }
  return res.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
}

/** Turn a dragged rectangle into highlight rectangles that follow the text lines it touches. Empty when it touches no text. */
export function snapToText(items: SnapItem[], drag: Box): Box[] {
  const rows: Box[] = []
  for (const it of items) {
    const b = it.box
    const ox = Math.min(b.x + b.w, drag.x + drag.w) - Math.max(b.x, drag.x)
    const oy = Math.min(b.y + b.h, drag.y + drag.h) - Math.max(b.y, drag.y)
    if (ox <= 0 || oy < Math.min(b.h, drag.h) * 0.4 || oy < b.h * 0.25) continue
    const x0 = Math.max(b.x, drag.x)
    const x1 = Math.min(b.x + b.w, drag.x + drag.w)
    rows.push({ x: x0, y: b.y, w: x1 - x0, h: b.h })
  }
  // merge pieces on the same line
  rows.sort((p, q) => p.y - q.y || p.x - q.x)
  const merged: Box[] = []
  for (const r of rows) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.max(last.h, r.h) * 0.4 && r.x - (last.x + last.w) < Math.max(last.h, r.h) * 0.9) {
      const y0 = Math.min(last.y, r.y)
      const y1 = Math.max(last.y + last.h, r.y + r.h)
      last.w = Math.max(last.x + last.w, r.x + r.w) - last.x
      last.y = y0
      last.h = y1 - y0
    } else merged.push({ ...r })
  }
  return merged
}

/** The text run under a point (for single clicks with a mark tool). */
export function itemAt(items: SnapItem[], p: { x: number; y: number }): Box | null {
  const it = items.find((i) => p.x >= i.box.x && p.x <= i.box.x + i.box.w && p.y >= i.box.y && p.y <= i.box.y + i.box.h)
  return it ? { ...it.box } : null
}

/** Find the existing text run at point `p`: an exact hit, else the nearest run within `pad` points (so a click just above or beside a line still edits that line). */
export function snapItemAt(items: SnapItem[], p: { x: number; y: number }, pad = 4): SnapItem | null {
  let best: SnapItem | null = null
  let bestD = Infinity
  for (const i of items) {
    const dx = Math.max(i.box.x - p.x, 0, p.x - (i.box.x + i.box.w))
    const dy = Math.max(i.box.y - p.y, 0, p.y - (i.box.y + i.box.h))
    if (dx > pad || dy > pad) continue
    const d = Math.hypot(dx, dy)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best ? { ...best } : null
}

/** All text runs intersecting a dragged bounding box. */
export function snapItemsInBox(items: SnapItem[], box: Box): SnapItem[] {
  return items.filter((it) => {
    const ox = Math.min(it.box.x + it.box.w, box.x + box.w) - Math.max(it.box.x, box.x)
    const oy = Math.min(it.box.y + it.box.h, box.y + box.h) - Math.max(it.box.y, box.y)
    return ox > 0 && oy > 0
  })
}
