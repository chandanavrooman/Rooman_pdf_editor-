import { EncryptedPDFError, PDFDocument, PDFFont, PDFPage, degrees } from 'pdf-lib'

export type ProgressFn = (fraction: number, label?: string) => void
export const noProgress: ProgressFn = () => {}

export interface OpFile {
  name: string
  bytes: Uint8Array
}

export class PdfOpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfOpError'
  }
}

/**
 * pdf-lib is compiled to ES5, so its Error subclasses lose their prototype and `instanceof EncryptedPDFError` is always
 * false at runtime. Recognise the error by its message as well (pdf-lib: "Input document to `PDFDocument.load` is encrypted").
 */
export function isEncryptedPdfError(e: unknown): boolean {
  if (e instanceof EncryptedPDFError) return true
  return e instanceof Error && /PDFDocument\.load` is encrypted|is encrypted/i.test(e.message)
}

/** Load a PDF from a COPY of the bytes (pdf-lib never touches the caller's buffer). */
export async function loadDoc(bytes: Uint8Array, label = 'The PDF'): Promise<PDFDocument> {
  try {
    const doc = await PDFDocument.load(bytes.slice(0), { updateMetadata: false })
    doc.getPageCount() // throws on files whose page tree is missing/corrupt
    return doc
  } catch (e) {
    if (isEncryptedPdfError(e)) {
      throw new PdfOpError(`${label} is password-protected or has editing restrictions. Unlock it first with the Unlock PDF tool.`)
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw new PdfOpError(`${label} could not be read (${msg}). Try the Repair PDF tool.`)
  }
}

export function pdfSave(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true })
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The visible region of a page in unrotated page coordinates: CropBox if present, else MediaBox. */
export function visibleBox(page: PDFPage): Box {
  const b = page.getCropBox()
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

export function normRotation(r: number): 0 | 90 | 180 | 270 {
  return ((((Math.round(r / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270
}

export function pageRotation(page: PDFPage): 0 | 90 | 180 | 270 {
  return normRotation(page.getRotation().angle)
}

/** Size of the page as the user sees it (rotation applied). */
export function visualSize(page: PDFPage): { width: number; height: number; rotation: 0 | 90 | 180 | 270 } {
  const box = visibleBox(page)
  const rotation = pageRotation(page)
  const swap = rotation === 90 || rotation === 270
  return { width: swap ? box.height : box.width, height: swap ? box.width : box.height, rotation }
}

/**
 * Convert a point in VISUAL coordinates (origin bottom-left of the displayed page,
 * rotation applied) into unrotated page coordinates, plus the text rotation needed
 * so text reads upright to the viewer.
 */
export function visualToPage(page: PDFPage, vx: number, vy: number): { x: number; y: number; rotate: ReturnType<typeof degrees> } {
  const box = visibleBox(page)
  const w = box.width
  const h = box.height
  switch (pageRotation(page)) {
    case 90:
      return { x: box.x + (w - vy), y: box.y + vx, rotate: degrees(90) }
    case 180:
      return { x: box.x + (w - vx), y: box.y + (h - vy), rotate: degrees(180) }
    case 270:
      return { x: box.x + vy, y: box.y + (h - vx), rotate: degrees(270) }
    default:
      return { x: box.x + vx, y: box.y + vy, rotate: degrees(0) }
  }
}

/**
 * Standard fonts use WinAnsi. Throw a clear error listing characters that cannot be drawn.
 */
export function assertEncodable(font: PDFFont, text: string, what = 'text'): void {
  const set = new Set(font.getCharacterSet())
  const bad: string[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 10 || cp === 13) continue
    if (!set.has(cp) && !bad.includes(ch)) bad.push(ch)
  }
  if (bad.length) {
    throw new PdfOpError(
      `The ${what} contains characters the built-in PDF font cannot draw: ${bad.slice(0, 8).join(' ')}. Use Latin characters (A–Z, accents, common punctuation).`,
    )
  }
}

export function formatDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function safeFileName(name: string): string {
  const cleaned = [...name].map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch)).join('')
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, 120) || 'file'
}

export function stripExt(name: string): string {
  return name.replace(/\.pdf$/i, '')
}

export function pad(n: number, digits: number): string {
  return String(n).padStart(digits, '0')
}
