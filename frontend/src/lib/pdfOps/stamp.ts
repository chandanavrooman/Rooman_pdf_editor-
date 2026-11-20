import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import {
  assertEncodable, formatDate, loadDoc, noProgress, pad, pdfSave, PdfOpError, visualSize, visualToPage, type OpFile, type ProgressFn,
} from './common'

export type HAlign = 'left' | 'center' | 'right'
export type VAlign = 'top' | 'bottom'
export interface Position {
  v: VAlign
  h: HAlign
}

export interface TextStyle {
  fontSize: number
  font: 'Helvetica' | 'Times' | 'Courier'
  bold: boolean
  color: { r: number; g: number; b: number }
  /** distance from the page edge in points */
  margin: number
}

export const defaultStyle: TextStyle = { fontSize: 11, font: 'Helvetica', bold: false, color: { r: 0, g: 0, b: 0 }, margin: 28 }

function fontName(style: TextStyle): StandardFonts {
  const key = `${style.font}${style.bold ? 'Bold' : ''}`
  const map: Record<string, StandardFonts> = {
    Helvetica: StandardFonts.Helvetica,
    HelveticaBold: StandardFonts.HelveticaBold,
    Times: StandardFonts.TimesRoman,
    TimesBold: StandardFonts.TimesRomanBold,
    Courier: StandardFonts.Courier,
    CourierBold: StandardFonts.CourierBold,
  }
  return map[key]
}

export function drawTextAt(page: PDFPage, font: PDFFont, text: string, pos: Position, style: TextStyle): void {
  const { width: W, height: H } = visualSize(page)
  const w = font.widthOfTextAtSize(text, style.fontSize)
  const vx = pos.h === 'left' ? style.margin : pos.h === 'center' ? (W - w) / 2 : W - style.margin - w
  const vy = pos.v === 'bottom' ? style.margin : H - style.margin - style.fontSize * 0.75
  const { x, y, rotate } = visualToPage(page, vx, vy)
  page.drawText(text, { x, y, size: style.fontSize, font, color: rgb(style.color.r, style.color.g, style.color.b), rotate })
}

export interface TokenContext {
  page: number
  pages: number
  date: string
  filename: string
}

export function applyTokens(template: string, ctx: TokenContext): string {
  // {page:2} / {pages:3} pad with zeros to at least that many digits: 01, 02 ... 10
  const padded = (n: number, width?: string) => (width ? String(n).padStart(Number(width), '0') : String(n))
  return template
    .replace(/\{page(?::(\d{1,2}))?\}/gi, (_, w?: string) => padded(ctx.page, w))
    .replace(/\{(?:pages|total)(?::(\d{1,2}))?\}/gi, (_, w?: string) => padded(ctx.pages, w))
    .replace(/\{date\}/gi, ctx.date)
    .replace(/\{filename\}/gi, ctx.filename)
}

export interface PageNumberOptions {
  position: Position
  /** Template, tokens {page} {pages} {date} {filename} */
  format: string
  startAt: number
  /** 1-based pages to number; undefined = all. */
  pages?: number[]
  style: TextStyle
  /** 1-based. Gives back a ONE-page PDF of that page, stamped exactly as it would be in the full result (used by the live preview). */
  onlyPage?: number
}

/** Core stamping routine: draws one text per selected page. */
async function stampPages(
  doc: PDFDocument,
  items: { pageNumber: number; text: string; position: Position }[],
  style: TextStyle,
): Promise<void> {
  const font = await doc.embedFont(fontName(style))
  for (const it of items) {
    assertEncodable(font, it.text)
    drawTextAt(doc.getPage(it.pageNumber - 1), font, it.text, it.position, style)
  }
}

export async function addPageNumbers(bytes: Uint8Array, filename: string, opts: PageNumberOptions, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const doc = await loadDoc(bytes)
  const total = doc.getPageCount()
  const targets = opts.pages ?? doc.getPageIndices().map((i) => i + 1)
  if (!targets.length) throw new PdfOpError('Select at least one page to number.')
  if (!opts.format.trim()) throw new PdfOpError('The number format cannot be empty.')
  if (!(opts.style.fontSize >= 4 && opts.style.fontSize <= 72)) throw new PdfOpError('Font size must be between 4 and 72.')
  const date = formatDate()
  const lastNumber = opts.startAt + total - 1
  onProgress(0.2, 'Adding numbers')
  for (const p of targets) if (p < 1 || p > total) throw new PdfOpError(`Page ${p} does not exist (the document has ${total}).`)
  // a preview only needs the one page stamped
  const items = (opts.onlyPage === undefined ? targets : targets.filter((p) => p === opts.onlyPage)).map((p) => {
    return {
      pageNumber: p,
      position: opts.position,
      text: applyTokens(opts.format, { page: opts.startAt + p - 1, pages: lastNumber, date, filename }),
    }
  })
  await stampPages(doc, items, opts.style)
  if (opts.onlyPage !== undefined) {
    if (opts.onlyPage < 1 || opts.onlyPage > total) throw new PdfOpError(`Page ${opts.onlyPage} does not exist (the document has ${total}).`)
    for (let i = total - 1; i >= 0; i--) if (i !== opts.onlyPage - 1) doc.removePage(i)
  }
  onProgress(0.8, 'Saving')
  const result = await pdfSave(doc)
  onProgress(1)
  return result
}

export interface HeaderFooterOptions {
  slots: Partial<Record<`${VAlign}-${HAlign}`, string>>
  pages?: number[]
  startAt: number
  style: TextStyle
}

export async function addHeadersFooters(bytes: Uint8Array, filename: string, opts: HeaderFooterOptions, onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  const doc = await loadDoc(bytes)
  const total = doc.getPageCount()
  const filled = Object.entries(opts.slots).filter(([, t]) => t && t.trim())
  if (!filled.length) throw new PdfOpError('Fill in at least one header or footer field.')
  const targets = opts.pages ?? doc.getPageIndices().map((i) => i + 1)
  if (!targets.length) throw new PdfOpError('Select at least one page.')
  const date = formatDate()
  const items: { pageNumber: number; text: string; position: Position }[] = []
  for (const p of targets) {
    if (p < 1 || p > total) throw new PdfOpError(`Page ${p} does not exist (the document has ${total}).`)
    for (const [key, tpl] of filled) {
      const [v, h] = key.split('-') as [VAlign, HAlign]
      items.push({ pageNumber: p, position: { v, h }, text: applyTokens(tpl as string, { page: opts.startAt + p - 1, pages: opts.startAt + total - 1, date, filename }) })
    }
  }
  onProgress(0.3, 'Adding text')
  await stampPages(doc, items, opts.style)
  onProgress(0.8, 'Saving')
  const result = await pdfSave(doc)
  onProgress(1)
  return result
}

export interface BatesOptions {
  prefix: string
  suffix: string
  startAt: number
  digits: number
  position: Position
  style: TextStyle
}

export function formatBates(o: BatesOptions, n: number): string {
  return `${o.prefix}${pad(n, o.digits)}${o.suffix}`
}

/** Bates-stamp one or more PDFs with a continuous sequence across files. */
export async function batesNumber(files: OpFile[], opts: BatesOptions, onProgress: ProgressFn = noProgress): Promise<{ files: OpFile[]; first: string; last: string }> {
  if (!Number.isInteger(opts.startAt) || opts.startAt < 0) throw new PdfOpError('Start number must be a whole number, zero or more.')
  if (!Number.isInteger(opts.digits) || opts.digits < 1 || opts.digits > 12) throw new PdfOpError('Digits must be between 1 and 12.')
  if (!files.length) throw new PdfOpError('Add at least one PDF.')
  let n = opts.startAt
  const out: OpFile[] = []
  for (let fi = 0; fi < files.length; fi++) {
    const doc = await loadDoc(files[fi].bytes, `"${files[fi].name}"`)
    const total = doc.getPageCount()
    const items = Array.from({ length: total }, (_, i) => ({ pageNumber: i + 1, position: opts.position, text: formatBates(opts, n + i) }))
    await stampPages(doc, items, opts.style)
    n += total
    out.push({ name: files[fi].name, bytes: await pdfSave(doc) })
    onProgress((fi + 1) / files.length)
  }
  return { files: out, first: formatBates(opts, opts.startAt), last: formatBates(opts, n - 1) }
}

/**
 * ONE page of a Bates-stamped file, stamped exactly like the full run: `before` is how many pages come earlier in the sequence
 * (the pages of the files above it), so the number continues from file to file. Used by the live preview.
 */
export async function batesPreviewPage(bytes: Uint8Array, opts: BatesOptions, before: number, pageNumber: number): Promise<Uint8Array> {
  const doc = await loadDoc(bytes)
  const total = doc.getPageCount()
  if (pageNumber < 1 || pageNumber > total) throw new PdfOpError(`Page ${pageNumber} does not exist (the document has ${total}).`)
  await stampPages(doc, [{ pageNumber, position: opts.position, text: formatBates(opts, opts.startAt + before + pageNumber - 1) }], opts.style)
  for (let i = total - 1; i >= 0; i--) if (i !== pageNumber - 1) doc.removePage(i)
  return pdfSave(doc)
}
