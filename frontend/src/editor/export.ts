import { isEncryptedPdfError } from '../lib/pdfOps/common'
import {
  PDFDocument,
  PDFName,
  PDFString,
  PDFDict,
  PDFRef,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  appendBezierCurve,
  closePath,
  concatTransformationMatrix,
  degrees,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setFillingRgbColor,
  setCharacterSpacing,
  stroke,
  LineCapStyle,
  LineJoinStyle,
  type PDFFont,
  type PDFPage,
  type PDFImage,
} from 'pdf-lib'
import { boxPsToPdf, pageGeometry, psToPdf, type PageGeometry } from './geometry'
import { UnicodeFonts, unsupportedByNoto, type FontBytesLoader } from './fonts'
import fontkit from '@pdf-lib/fontkit'
import { embeddedBytes, embeddedKeyFor } from './embeddedFonts'
import { baselineFrac, embedOpts, fontInfo, missingGlyphs, suggestFontFor, variantOf, type FontId, type FontLoader } from './fontCatalog'
import { dedupeAnnotations, dedupeObjects } from './annotations'
import { isUnchanged } from './textEdit'
import { normalizeUrl } from './urlNormalize'
import { layoutTable, type Measure } from './tableModel'
import { arrowHead, smoothSegments } from './smooth'
import { BASELINE, LINE_HEIGHT, isWinAnsi, standardFontFor, wrapLines } from './textLayout'
import type { Box, Color, EditorDoc, EditorObject, FieldObj, ImageObj, LinkObj, MarkObj, Pt, TableObj, TextObj } from './types'

export interface ExportOptions {
  /** flatten (make permanent) every form field after filling */
  flattenForm?: boolean
  onProgress?: (fraction: number, label: string) => void
  /** filled in by the export: what was cleaned up on the way */
  stats?: { skippedDuplicateObjects: number; removedDuplicateAnnotations: number }
}
export interface ExportDeps {
  loadFontBytes?: FontBytesLoader
  /** bytes of a bundled catalog font (needed for text that uses `fontId`) */
  loadFont?: FontLoader
}

export class ExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportError'
  }
}

export function hexToRgb(hex: Color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1], 16) : 0
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

interface Ctx {
  doc: PDFDocument
  unicode: UnicodeFonts
  stdFonts: Map<string, Promise<PDFFont>>
  images: Map<string, Promise<PDFImage>>
  assets: EditorDoc['assets']
  fieldNames: Set<string>
  radioGroups: Map<string, PDFRadioGroup>
  loadFont: FontLoader
  bundled: Map<string, Promise<PDFFont>>
}

function bundledFont(c: Ctx, id: FontId, bold: boolean, italic: boolean): Promise<PDFFont> {
  const v = variantOf(bold, italic)
  const key = `${id}|${v}`
  let p = c.bundled.get(key)
  if (!p) {
    c.doc.registerFontkit(fontkit)
    p = c.loadFont(id, v).then((b) => c.doc.embedFont(b, embedOpts(id)))
    c.bundled.set(key, p)
  }
  return p
}

/** The font edited text is drawn with: the PDF's own standard font (Times / Helvetica / Courier) when the original font was not embedded and every character fits it, else the matching bundled font. */
const STD_FAMILY: Record<string, 'times' | 'helvetica' | 'courier'> = { 'liberation-serif': 'times', 'liberation-sans': 'helvetica', 'liberation-mono': 'courier' }
async function embeddedPdfFont(c: Ctx, key: string): Promise<PDFFont> {
  const bytes = embeddedBytes(key)!
  const k = `emb|${key}`
  let p = c.bundled.get(k)
  if (!p) {
    c.doc.registerFontkit(fontkit)
    p = c.doc.embedFont(bytes, { subset: false })
    c.bundled.set(k, p)
  }
  return p
}

function textFont(c: Ctx, o: TextObj, id: FontId): Promise<PDFFont> {
  const emb = embeddedKeyFor(o)
  if (emb) return embeddedPdfFont(c, emb)
  const fam = STD_FAMILY[id]
  if (o.sysFont && fam && isWinAnsi(o.text)) return stdFont(c, { ...o, family: fam })
  return bundledFont(c, id, o.bold, o.italic)
}

function stdFont(c: Ctx, o: Pick<TextObj, 'family' | 'bold' | 'italic'>): Promise<PDFFont> {
  const key = `${o.family}|${o.bold}|${o.italic}`
  let p = c.stdFonts.get(key)
  if (!p) {
    p = c.doc.embedFont(standardFontFor(o.family, o.bold, o.italic))
    c.stdFonts.set(key, p)
  }
  return p
}

const flipLocal = (page: PDFPage, g: PageGeometry) => {
  const [a, b, c, d, e, f] = g.matrix
  // local (lx, ly) = (px, -py): apply flip first, then the page matrix
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f), concatTransformationMatrix(1, 0, 0, -1, 0, 0))
}
const end = (page: PDFPage) => page.pushOperators(popGraphicsState())

const cps = (s: string) => Array.from(s)

/** Text that uses a bundled catalog font (`fontId`): chosen font, size, color and style are embedded and drawn exactly. */
async function drawBundledText(c: Ctx, page: PDFPage, g: PageGeometry, o: TextObj) {
  const id = o.fontId as FontId
  const orig = o.orig
  const fillColor = hexToRgb(o.fill ?? '#ffffff')
  const cover = (x: number, y: number, w: number, h: number) => {
    flipLocal(page, g)
    page.drawRectangle({ x, y: -(y + h), width: w, height: h, color: fillColor, borderWidth: 0 })
    end(page)
  }

  // the user dragged a resize handle (or typed a newline): the run becomes wrapped text, drawn line by line from the original baseline
  const wrapped = !!orig && (!o.autoWidth || o.text.includes(String.fromCharCode(10)))
  // cover = the FULL original text box: from just above the tallest ascender to below the deepest descender, a little past both ends,
  // so no fragment of an old glyph (like the "AG" of "WCAG") can peek out
  const COVER_TOP = 0.92
  const COVER_H = 1.22
  if (orig && wrapped && isUnchanged(o)) return // a table cell that was opened but not changed
  if (orig && wrapped) for (const r of orig.block?.runs ?? [{ x: orig.x, baseline: orig.baseline, w: orig.w }]) cover(r.x - 0.6, r.baseline - orig.size * COVER_TOP, r.w + 1.4, orig.size * COVER_H)
  if (orig && !wrapped) {
    const styleSame = id === orig.fontId && o.size === orig.size && o.bold === orig.bold && o.italic === orig.italic && o.color.toLowerCase() === orig.color.toLowerCase()
    // a run that was only moved is redrawn whole at its new place, the original covered
    const moved = Math.abs(o.x - orig.x) > 0.05 || Math.abs((o.baseline ?? orig.baseline) - orig.baseline) > 0.05
    if (styleSame && o.text === orig.str && !moved) return // nothing changed: leave the original untouched
    const top = orig.baseline - orig.size * COVER_TOP
    const hgt = orig.size * COVER_H
    if (!o.text.trim()) {
      cover(orig.x - 0.6, top, orig.w + 1.4, hgt)
      return
    }
    const bad = await missingGlyphs(id, o.text, c.loadFont)
    if (bad.length) {
      const alt = await suggestFontFor(o.text, id, c.loadFont)
      throw new ExportError(`${fontInfo(id).label} has no glyph for ${bad.slice(0, 8).join(' ')}.${alt ? ` Choose ${fontInfo(alt).label} instead.` : ''}`)
    }
    const font = await textFont(c, o, id)
    // the PDF's own font may have no space glyph (Word subsets often omit it): positions and space widths come from the metric-compatible
    // bundled font, glyphs from the PDF's font, and a space is never drawn
    const emb = !!embeddedKeyFor(o)
    const origFont = styleSame && !emb ? font : await bundledFont(c, orig.fontId, orig.bold, orig.italic)
    const spW = (await bundledFont(c, id, o.bold, o.italic)).widthOfTextAtSize(' ', o.size)
    const wOf = (t: string) => (emb ? t.split(' ').reduce((sum, w, i) => sum + (i ? spW : 0) + (w ? font.widthOfTextAtSize(w, o.size) : 0), 0) : font.widthOfTextAtSize(t, o.size))
    const oldChars = cps(orig.str)
    const newChars = cps(o.text)
    // keep the unchanged prefix and suffix; only the characters in between are replaced
    let p = 0
    let sfx = 0
    if (styleSame && !moved) {
      const lim = Math.min(oldChars.length, newChars.length)
      while (p < lim && oldChars[p] === newChars[p]) p++
      while (sfx < lim - p && oldChars[oldChars.length - 1 - sfx] === newChars[newChars.length - 1 - sfx]) sfx++
    }
    // positions of the ORIGINAL characters: measured with the matched font, scaled so the whole run has the width the PDF gave it
    const rawW = origFont.widthOfTextAtSize(orig.str, orig.size)
    const k = rawW > 0 && orig.w > 0 ? Math.max(0.8, Math.min(1.25, orig.w / rawW)) : 1
    const xOf = (i: number) => orig.x + k * origFont.widthOfTextAtSize(oldChars.slice(0, i).join(''), orig.size)
    const oldEnd = oldChars.length - sfx
    const midStart = xOf(p)
    const midEnd = oldEnd === oldChars.length ? orig.x + orig.w : xOf(oldEnd)
    const newMid = newChars.slice(p, newChars.length - sfx).join('')
    const suffix = newChars.slice(newChars.length - sfx).join('')
    const wm = newMid ? wOf(newMid) : 0
    const shift = sfx > 0 && Math.abs(wm - (midEnd - midStart)) > 0.25
    const coverEnd = shift ? orig.x + orig.w : midEnd
    const padL = p === 0 ? 0.6 : 0.3
    const padR = coverEnd >= orig.x + orig.w - 0.01 ? 0.8 : 0.3
    if (coverEnd > midStart) cover(midStart - padL, top, coverEnd - midStart + padL + padR, hgt)
    const str = shift ? newMid + suffix : newMid
    if (str) {
      flipLocal(page, g)
      if (o.letterSpacing) page.pushOperators(setCharacterSpacing(o.letterSpacing))
      const drawX = moved ? o.x : midStart
      const paint = { y: -(moved ? (o.baseline ?? orig.baseline) : orig.baseline), size: o.size, font, color: hexToRgb(o.color), ...(o.opacity !== undefined ? { opacity: o.opacity } : {}) }
      if (emb && str.includes(' ')) {
        let x = drawX
        for (const w of str.split(' ')) {
          if (w) page.drawText(w, { ...paint, x })
          x += wOf(w) + spW
        }
      } else page.drawText(str, { ...paint, x: drawX })
      end(page)
    }
    return
  }

  // a new text object using a bundled font (or wrapped text that started as a PDF run)
  if (!o.text.trim()) {
    if (o.fill && !orig) cover(o.x, o.y, o.w, o.h)
    return
  }
  const bad = await missingGlyphs(id, o.text, c.loadFont)
  if (bad.length) {
    const alt = await suggestFontFor(o.text, id, c.loadFont)
    throw new ExportError(`${fontInfo(id).label} has no glyph for ${bad.slice(0, 8).join(' ')}.${alt ? ` Choose ${fontInfo(alt).label} instead.` : ''}`)
  }
  const font = await textFont(c, o, id)
  const measure = (str: string) => font.widthOfTextAtSize(str, o.size)
  const lines = wrapLines(o.text, o.autoWidth ? null : o.w, measure)
  if (o.fill && !orig) {
    const boxW = Math.max(o.w, lines.reduce((m, l) => Math.max(m, measure(l)), 0) + 4)
    cover(o.x, o.y, boxW, Math.max(o.h, lines.length * (o.leading ?? o.size * LINE_HEIGHT)))
  }
  lines.forEach((line, i) => {
    if (!line || !orig) return
    // wrapped PDF text: only patch exactly where each new line is drawn
    const lw = measure(line)
    const dx = o.align === 'center' ? (o.w - lw) / 2 : o.align === 'right' ? o.w - lw : 0
    const baseline = (o.baseline ?? o.y + o.size * baselineFrac(id)) + i * (o.leading ?? o.size * LINE_HEIGHT)
    if (i > 0) cover(o.x + dx - 0.4, baseline - o.size * COVER_TOP, lw + 0.8, o.size * COVER_H)
  })
  flipLocal(page, g)
  lines.forEach((line, i) => {
    if (!line) return
    const lw = measure(line)
    const dx = o.align === 'center' ? (o.w - lw) / 2 : o.align === 'right' ? o.w - lw : 0
    const baseline = (o.baseline ?? o.y + o.size * baselineFrac(id)) + i * (o.leading ?? o.size * LINE_HEIGHT)
    if (o.letterSpacing) page.pushOperators(setCharacterSpacing(o.letterSpacing))
    page.drawText(line, { x: o.x + dx, y: -baseline, size: o.size, font, color: hexToRgb(o.color), ...(o.opacity !== undefined ? { opacity: o.opacity } : {}) })
  })
  end(page)
}

async function drawText(c: Ctx, page: PDFPage, g: PageGeometry, o: TextObj) {
  if (o.fontId) return drawBundledText(c, page, g, o)
  if (!o.text.trim()) {
    if (o.fill) {
      flipLocal(page, g)
      page.drawRectangle({ x: o.x, y: -(o.y + o.h), width: o.w, height: o.h, color: hexToRgb(o.fill) })
      end(page)
    }
    return
  }
  const needsUnicode = !isWinAnsi(o.text)
  let font: PDFFont
  if (needsUnicode) {
    const bad = unsupportedByNoto(o.text, await c.unicode.regular())
    if (bad.length) throw new ExportError(`These characters are not available in the bundled Unicode font and cannot be added as text: ${bad.slice(0, 8).join(' ')}`)
    font = await c.unicode.get(o.bold, o.italic)
  } else font = await stdFont(c, o)
  const measure = (s: string) => font.widthOfTextAtSize(s, o.size)
  const lines = wrapLines(o.text, o.autoWidth ? null : o.w, measure)
  const color = hexToRgb(o.color)
  flipLocal(page, g)
  if (o.fill) {
    const maxTextW = lines.reduce((m, l) => Math.max(m, measure(l)), 0)
    const boxW = Math.max(o.w, maxTextW + 4)
    const boxH = Math.max(o.h, lines.length * o.size * LINE_HEIGHT)
    page.drawRectangle({ x: o.x, y: -(o.y + boxH), width: boxW, height: boxH, color: hexToRgb(o.fill) })
  }
  lines.forEach((line, i) => {
    if (!line) return
    const lw = measure(line)
    const dx = o.align === 'center' ? (o.w - lw) / 2 : o.align === 'right' ? o.w - lw : 0
    const baseline = o.y + o.size * BASELINE[o.family] + i * o.size * LINE_HEIGHT
    page.drawText(line, { x: o.x + dx, y: -baseline, size: o.size, font, color })
  })
  end(page)
}

/**
 * A table the user edited: blank the area of the original table, then draw the new one - cell fills, rules, and every cell's text
 * (wrapped to its cell, in the cell's own font, size and colour). An untouched table is left exactly as the PDF has it.
 */
async function drawTable(c: Ctx, page: PDFPage, g: PageGeometry, o: TableObj) {
  const t = o.data
  if (!t.modified) return
  const fonts = new Map<string, PDFFont>()
  const key = (f: { fontId: FontId; bold: boolean; italic: boolean }) => `${f.fontId}|${f.bold}|${f.italic}`
  for (const row of t.rows)
    for (const cell of row.cells) {
      if (cell.text.trim()) {
        const bad = await missingGlyphs(cell.fontId, cell.text, c.loadFont)
        if (bad.length) {
          const alt = await suggestFontFor(cell.text, cell.fontId, c.loadFont)
          throw new ExportError(`A table cell has a character that ${fontInfo(cell.fontId).label} cannot draw (${bad.slice(0, 6).join(' ')}).${alt ? ` Use ${fontInfo(alt).label} for that cell.` : ''}`)
        }
      }
      if (!fonts.has(key(cell))) fonts.set(key(cell), await bundledFont(c, cell.fontId, cell.bold, cell.italic))
    }
  const measure: Measure = (cell, s) => fonts.get(key(cell))!.widthOfTextAtSize(s, cell.size)
  const plan = layoutTable(t, measure)
  flipLocal(page, g)
  const cv = plan.cover
  page.drawRectangle({ x: cv.x, y: -(cv.y + cv.h), width: cv.w, height: cv.h, color: hexToRgb(cv.bg), borderWidth: 0 })
  for (const f of plan.fills) page.drawRectangle({ x: f.x, y: -(f.y + f.h), width: f.w, height: f.h, color: hexToRgb(f.color), borderWidth: 0 })
  for (const l of plan.lines) {
    const horizontal = l.y0 === l.y1
    const ext = horizontal ? l.width / 2 : 0 // horizontal rules overlap the outer frame by half a line so the corners are filled
    page.drawLine({ start: { x: l.x0 - ext, y: -l.y0 }, end: { x: l.x1 + ext, y: -l.y1 }, thickness: l.width, color: hexToRgb(l.color) })
  }
  for (const tx of plan.texts) {
    const font = fonts.get(key(tx.cell))!
    page.drawText(tx.str, { x: tx.x, y: -tx.baseline, size: tx.cell.size, font, color: hexToRgb(tx.cell.color) })
  }
  end(page)
}

async function getImage(c: Ctx, o: ImageObj): Promise<PDFImage> {
  let p = c.images.get(o.assetId)
  if (!p) {
    const a = c.assets[o.assetId]
    if (!a) throw new ExportError('An image used in the document is no longer available.')
    p = a.mime === 'image/png' ? c.doc.embedPng(a.bytes.slice(0)) : c.doc.embedJpg(a.bytes.slice(0))
    c.images.set(o.assetId, p)
  }
  return p
}

function strokeSegs(page: PDFPage, pts: Pt[], color: Color, width: number) {
  const segs = smoothSegments(pts)
  if (!segs.length) return
  const ops = [pushGraphicsState(), setStrokingRgbColor(...rgbArr(color)), setLineWidth(width), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round)]
  let cur: Pt = segs[0].t === 'M' ? segs[0].p : pts[0]
  for (const s of segs) {
    if (s.t === 'M') ops.push(moveTo(s.p.x, -s.p.y))
    else if (s.t === 'L') ops.push(lineTo(s.p.x, -s.p.y))
    else {
      // quadratic -> cubic
      const c1 = { x: cur.x + (2 / 3) * (s.c.x - cur.x), y: cur.y + (2 / 3) * (s.c.y - cur.y) }
      const c2 = { x: s.p.x + (2 / 3) * (s.c.x - s.p.x), y: s.p.y + (2 / 3) * (s.c.y - s.p.y) }
      ops.push(appendBezierCurve(c1.x, -c1.y, c2.x, -c2.y, s.p.x, -s.p.y))
    }
    cur = s.p
  }
  ops.push(stroke(), popGraphicsState())
  page.pushOperators(...ops)
}

function rgbArr(hex: Color): [number, number, number] {
  const c = hexToRgb(hex)
  return [c.red, c.green, c.blue]
}

function drawVector(page: PDFPage, g: PageGeometry, o: EditorObject) {
  switch (o.type) {
    case 'whiteout':
      flipLocal(page, g)
      page.drawRectangle({ x: o.x, y: -(o.y + o.h), width: o.w, height: o.h, color: hexToRgb(o.fill), borderWidth: 0 })
      end(page)
      break
    case 'rect':
    case 'ellipse': {
      flipLocal(page, g)
      const common = {
        color: o.fill ? hexToRgb(o.fill) : undefined,
        borderColor: o.stroke && o.strokeWidth > 0 ? hexToRgb(o.stroke) : undefined,
        borderWidth: o.stroke ? o.strokeWidth : 0,
      }
      if (o.type === 'rect') page.drawRectangle({ x: o.x, y: -(o.y + o.h), width: o.w, height: o.h, ...common })
      else page.drawEllipse({ x: o.x + o.w / 2, y: -(o.y + o.h / 2), xScale: o.w / 2, yScale: o.h / 2, ...common })
      end(page)
      break
    }
    case 'line':
    case 'arrow': {
      flipLocal(page, g)
      const [a, b] = o.pts
      if (o.type === 'arrow') {
        // stop the shaft slightly before the tip so a round cap does not poke through the head
        const head = arrowHead(a, b, o.strokeWidth)
        strokeSegs(page, [a, { x: (head[1].x + head[2].x) / 2, y: (head[1].y + head[2].y) / 2 }], o.stroke, o.strokeWidth)
        page.pushOperators(pushGraphicsState(), setFillingRgbColor(...rgbArr(o.stroke)), moveTo(head[0].x, -head[0].y), lineTo(head[1].x, -head[1].y), lineTo(head[2].x, -head[2].y), closePath(), fill(), popGraphicsState())
      } else strokeSegs(page, [a, b], o.stroke, o.strokeWidth)
      end(page)
      break
    }
    case 'draw':
      flipLocal(page, g)
      strokeSegs(page, o.pts, o.stroke, o.strokeWidth)
      end(page)
      break
    default:
      break
  }
}

async function drawImageObj(c: Ctx, page: PDFPage, g: PageGeometry, o: ImageObj) {
  const img = await getImage(c, o)
  flipLocal(page, g)
  const opacity = o.opacity !== undefined && o.opacity < 1 ? { opacity: Math.max(0, o.opacity) } : {}
  if (o.rotation) {
    // local space is y-up, so a clockwise turn on screen is a negative angle; rotate about the centre of the box
    const a = (-o.rotation * Math.PI) / 180
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), o.x + o.w / 2, -(o.y + o.h / 2)))
    page.drawImage(img, { x: -o.w / 2, y: -o.h / 2, width: o.w, height: o.h, ...opacity })
    page.pushOperators(popGraphicsState())
  } else {
    page.drawImage(img, { x: o.x, y: -(o.y + o.h), width: o.w, height: o.h, ...opacity })
  }
  end(page)
}

function addAnnotation(doc: PDFDocument, page: PDFPage, dict: Record<string, unknown>): PDFRef {
  const ref = doc.context.register(doc.context.obj(dict as never))
  page.node.addAnnot(ref)
  return ref
}

function quadFor(g: PageGeometry, b: Box): Pt[] {
  // TL, TR, BL, BR as seen by the user
  return [psToPdf(g, { x: b.x, y: b.y }), psToPdf(g, { x: b.x + b.w, y: b.y }), psToPdf(g, { x: b.x, y: b.y + b.h }), psToPdf(g, { x: b.x + b.w, y: b.y + b.h })]
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString()

/** Real Highlight / Underline / StrikeOut annotations with appearance streams. */
function addMarkAnnotation(doc: PDFDocument, page: PDFPage, g: PageGeometry, o: MarkObj) {
  const q = quadFor(g, o)
  const xs = q.map((p) => p.x)
  const ys = q.map((p) => p.y)
  const lw = Math.max(0.75, o.h * 0.07)
  const pad = o.type === 'highlight' ? 0 : lw
  const rect = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
  const [r, gr, b] = rgbArr(o.color)
  let content: string
  let extGState: PDFDict | undefined
  if (o.type === 'highlight') {
    content = `/GS gs ${n(r)} ${n(gr)} ${n(b)} rg ${n(q[0].x)} ${n(q[0].y)} m ${n(q[1].x)} ${n(q[1].y)} l ${n(q[3].x)} ${n(q[3].y)} l ${n(q[2].x)} ${n(q[2].y)} l f`
    extGState = doc.context.obj({ GS: { Type: 'ExtGState', BM: 'Multiply', CA: 1, ca: 1 } }) as PDFDict
  } else {
    const t = o.type === 'underline' ? 0.93 : 0.52
    const p1 = psToPdf(g, { x: o.x, y: o.y + o.h * t })
    const p2 = psToPdf(g, { x: o.x + o.w, y: o.y + o.h * t })
    content = `${n(r)} ${n(gr)} ${n(b)} RG ${n(lw)} w ${n(p1.x)} ${n(p1.y)} m ${n(p2.x)} ${n(p2.y)} l S`
  }
  const resources = doc.context.obj({}) as PDFDict
  if (extGState) resources.set(PDFName.of('ExtGState'), extGState)
  const ap = doc.context.register(
    doc.context.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: resources }),
  )
  const subtype = o.type === 'highlight' ? 'Highlight' : o.type === 'underline' ? 'Underline' : 'StrikeOut'
  addAnnotation(doc, page, {
    Type: 'Annot',
    Subtype: subtype,
    Rect: rect,
    QuadPoints: [q[0].x, q[0].y, q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y],
    C: [r, gr, b],
    CA: 1,
    F: 4,
    Border: [0, 0, 0],
    AP: { N: ap },
  })
}

function addLinkAnnotation(doc: PDFDocument, pages: PDFPage[], page: PDFPage, g: PageGeometry, o: LinkObj) {
  const b = boxPsToPdf(g, o)
  // a clickable area must be big enough to hit (at least 6 pt each way) and stay on the page
  const MINSIDE = 6
  const w = Math.max(MINSIDE, b.w)
  const h = Math.max(MINSIDE, b.h)
  const rect = [b.x, b.y, b.x + w, b.y + h]
  // visible clickable area: a thin blue outline (unless the user switched it off)
  const visible = o.showBorder !== false
  const base = { Type: 'Annot', Subtype: 'Link', Rect: rect, Border: visible ? [0, 0, 0.75] : [0, 0, 0], ...(visible ? { C: [0.05, 0.4, 0.8] } : {}), H: 'I', F: 4 }
  if (o.target.kind === 'url') {
    const chk = normalizeUrl(o.target.url)
    if (!chk.ok) throw new ExportError(`A link on page ${o.page + 1} cannot be exported: ${chk.error}`)
    addAnnotation(doc, page, { ...base, A: { Type: 'Action', S: 'URI', URI: PDFString.of(chk.url) } })
  } else {
    const dest = pages[Math.max(0, Math.min(pages.length - 1, o.target.page))]
    addAnnotation(doc, page, { ...base, Dest: [dest.ref, PDFName.of('Fit')] })
  }
}

function uniqueName(c: Ctx, name: string): string {
  const base = name.trim() || 'field'
  let out = base
  let i = 2
  while (c.fieldNames.has(out)) out = `${base}_${i++}`
  c.fieldNames.add(out)
  return out
}

function addFormField(c: Ctx, page: PDFPage, g: PageGeometry, o: FieldObj) {
  const form = c.doc.getForm()
  const b = boxPsToPdf(g, o)
  const square = o.fieldKind === 'checkbox' || o.fieldKind === 'radio'
  // a checkbox / radio button is always a square: width = height (the smaller side wins if a file somehow holds a rectangle)
  const side = Math.max(4, Math.min(b.w, b.h))
  // pdf-lib grows the widget by the border width (it draws the border OUTSIDE the box you give it), so shrink the request by the same
  // amount: the widget's /Rect then is exactly the size the user chose (a 16 pt checkbox is 16 × 16 pt in the file, not 17 × 17)
  const bw = 1
  const wantW = square ? side : Math.max(4, b.w)
  const wantH = square ? side : Math.max(4, b.h)
  const opts = { x: b.x + bw / 2, y: b.y + bw / 2, width: wantW - bw, height: wantH - bw, rotate: degrees(g.rotate), borderWidth: bw, borderColor: rgb(0.2, 0.2, 0.2), backgroundColor: rgb(0.96, 0.98, 1) }
  switch (o.fieldKind) {
    case 'text': {
      const f = form.createTextField(uniqueName(c, o.name))
      if (o.multiline) f.enableMultiline()
      if (o.maxLength && o.maxLength > 0) f.setMaxLength(Math.floor(o.maxLength))
      if (typeof o.value === 'string' && o.value) f.setText(o.value)
      f.addToPage(page, { ...opts, font: undefined })
      applyFieldSettings(c.doc, f.acroField.dict, o)
      if (o.required) f.enableRequired()
      break
    }
    case 'checkbox': {
      const f = form.createCheckBox(uniqueName(c, o.name))
      f.addToPage(page, opts)
      if (o.value === true) f.check()
      applyFieldSettings(c.doc, f.acroField.dict, o)
      if (o.required) f.enableRequired()
      break
    }
    case 'dropdown': {
      const f = form.createDropdown(uniqueName(c, o.name))
      const options = o.options.length ? o.options : ['Option 1']
      f.addOptions(options)
      f.addToPage(page, opts)
      if (typeof o.value === 'string' && options.includes(o.value)) f.select(o.value)
      applyFieldSettings(c.doc, f.acroField.dict, o)
      if (o.required) f.enableRequired()
      break
    }
    case 'radio': {
      const key = o.name.trim() || 'radio'
      let grp = c.radioGroups.get(key)
      if (!grp) {
        grp = form.createRadioGroup(uniqueName(c, key))
        c.radioGroups.set(key, grp)
      }
      const label = o.options[0] || `Option ${grp.getOptions().length + 1}`
      const unique = grp.getOptions().includes(label) ? `${label}_${grp.getOptions().length + 1}` : label
      grp.addOptionToPage(unique, page, opts)
      if (o.value === true) grp.select(unique)
      if (o.required) grp.enableRequired()
      if (o.tooltip?.trim()) applyFieldSettings(c.doc, grp.acroField.dict, { ...o, validation: 'none' })
      break
    }
  }
}

/** What a viewer shows when the pointer rests on a field, and (text fields) what may be typed, as small PDF JavaScript actions. */
const NUMBER_ONLY = 'AFNumber_Keystroke(0, 0, 0, 0, "", true);'
const EMAIL_CHECK = 'event.rc = event.value === "" || /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(event.value);'
function applyFieldSettings(doc: PDFDocument, dict: PDFDict, o: FieldObj) {
  if (o.tooltip?.trim()) dict.set(PDFName.of('TU'), PDFString.of(o.tooltip.trim()))
  if (o.fieldKind !== 'text' || !o.validation || o.validation === 'none') return
  const action = (js: string) => doc.context.obj({ S: 'JavaScript', JS: PDFString.of(js) })
  const aa = doc.context.obj(o.validation === 'number' ? { K: action(NUMBER_ONLY) } : { V: action(EMAIL_CHECK) })
  dict.set(PDFName.of('AA'), aa)
}

function applyFormValues(doc: PDFDocument, values: EditorDoc['formValues']) {
  const names = Object.keys(values)
  if (!names.length) return
  const form = doc.getForm()
  for (const name of names) {
    const v = values[name]
    const f = form.getFieldMaybe(name)
    if (!f) continue
    try {
      if (f instanceof PDFTextField) {
        const s = typeof v === 'string' ? v : String(v)
        if (s === '') f.setText(undefined)
        else f.setText(s)
      } else if (f instanceof PDFCheckBox) {
        if (v === true) f.check()
        else f.uncheck()
      } else if (f instanceof PDFRadioGroup) {
        if (typeof v === 'string' && v) f.select(v)
        else f.clear()
      } else if (f instanceof PDFDropdown) {
        if (typeof v === 'string' && v) f.select(v)
        else f.clear()
      } else if (f instanceof PDFOptionList) {
        const arr = Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []
        if (arr.length) f.select(arr)
        else f.clear()
      }
    } catch (e) {
      throw new ExportError(`Could not fill the form field "${name}": ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

/**
 * Apply the editor's edits to the ORIGINAL file bytes. Nothing is rebuilt from text: original page content is kept as is,
 * edits are appended after it (annotations / appended content streams).
 */
export async function exportEdited(original: Uint8Array, edit: EditorDoc, options: ExportOptions = {}, deps: ExportDeps = {}): Promise<Uint8Array> {
  const progress = options.onProgress ?? (() => {})
  progress(0.02, 'Reading the original PDF')
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(original.slice(0), { updateMetadata: false, throwOnInvalidObject: false })
  } catch (e) {
    if (isEncryptedPdfError(e)) throw new ExportError('This PDF is password-protected or has editing restrictions. Unlock it first with the Unlock PDF tool.')
    throw new ExportError(`The PDF could not be opened for editing: ${e instanceof Error ? e.message : String(e)}`)
  }
  const pages = doc.getPages()
  const geoms = pages.map(pageGeometry)
  const loadFont: FontBytesLoader =
    deps.loadFontBytes ??
    (() => {
      throw new ExportError('No Unicode font loader is available.')
    })
  const c: Ctx = {
    doc,
    unicode: new UnicodeFonts(doc, loadFont),
    stdFonts: new Map(),
    images: new Map(),
    assets: edit.assets,
    fieldNames: new Set(),
    radioGroups: new Map(),
    loadFont:
      deps.loadFont ??
      (() => {
        throw new ExportError('No font loader is available for the selected font.')
      }),
    bundled: new Map(),
  }

  const allDrawable = edit.objects
  const drawable = dedupeObjects(allDrawable)
  if (options.stats) options.stats.skippedDuplicateObjects = allDrawable.length - drawable.length
  const touched = new Set(drawable.map((o) => o.page))
  // pdf-lib wraps the page's ORIGINAL content streams in q … Q the first time a page is touched (PDFPageLeaf.normalize),
  // so our appended content always starts from a clean graphics state and the original streams stay byte-identical.
  for (const p of touched) pages[p]?.node.normalize()

  const hasFieldObjects = drawable.some((o) => o.type === 'field')
  if (hasFieldObjects || options.flattenForm || Object.keys(edit.formValues).length) {
    // make sure names of fields we create do not clash with existing ones
    try {
      for (const f of doc.getForm().getFields()) c.fieldNames.add(f.getName())
    } catch {
      /* no form */
    }
  }

  applyFormValues(doc, edit.formValues)

  let done = 0
  for (const o of drawable) {
    const page = pages[o.page]
    if (!page) continue
    const g = geoms[o.page]
    switch (o.type) {
      case 'text':
        await drawText(c, page, g, o)
        break
      case 'table':
        await drawTable(c, page, g, o)
        break
      case 'image':
      case 'signature':
        await drawImageObj(c, page, g, o)
        break
      case 'highlight':
      case 'underline':
      case 'strike':
        addMarkAnnotation(doc, page, g, o)
        break
      case 'link':
        addLinkAnnotation(doc, pages, page, g, o)
        break
      case 'field':
        addFormField(c, page, g, o)
        break
      default:
        drawVector(page, g, o)
    }
    done++
    progress(0.05 + (0.55 * done) / Math.max(1, drawable.length), 'Applying edits')
  }

  // exporting a file that already holds the same annotations (or earlier exact copies) must not stack them up
  const removedDup = dedupeAnnotations(doc)
  if (options.stats) options.stats.removedDuplicateAnnotations = removedDup

  if (options.flattenForm) {
    try {
      doc.getForm().flatten()
    } catch (e) {
      throw new ExportError(`Could not flatten the form: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const bytes = await doc.save()
  progress(1, 'Done')
  return bytes
}

