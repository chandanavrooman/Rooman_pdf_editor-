import fontkit from '@pdf-lib/fontkit'
import type { PDFDocument, PDFFont } from 'pdf-lib'

export type NotoVariant = 'regular' | 'bold' | 'italic' | 'bolditalic'
export type FontBytesLoader = (variant: NotoVariant) => Promise<Uint8Array>

/** Characters the bundled Noto Sans (Latin, Latin-ext, Greek, Cyrillic, Vietnamese…) cannot draw. */
export function unsupportedByNoto(text: string, regularBytes: Uint8Array): string[] {
  const font = fontkit.create(regularBytes) as unknown as { hasGlyphForCodePoint(cp: number): boolean }
  const bad = new Set<string>()
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x0a || cp === 0x0d || cp === 0x09 || cp === 0x20) continue
    if (!font.hasGlyphForCodePoint(cp)) bad.add(ch)
  }
  return [...bad]
}

/** Embeds (and caches per document) the open-license Noto Sans so Unicode text never throws. */
export class UnicodeFonts {
  private cache = new Map<NotoVariant, Promise<PDFFont>>()
  private regularBytes: Promise<Uint8Array> | null = null
  constructor(private doc: PDFDocument, private load: FontBytesLoader) {
    doc.registerFontkit(fontkit)
  }
  get(bold: boolean, italic: boolean): Promise<PDFFont> {
    const v: NotoVariant = bold ? (italic ? 'bolditalic' : 'bold') : italic ? 'italic' : 'regular'
    let p = this.cache.get(v)
    if (!p) {
      p = this.load(v).then((b) => this.doc.embedFont(b, { subset: true }))
      this.cache.set(v, p)
    }
    return p
  }
  regular(): Promise<Uint8Array> {
    return (this.regularBytes ??= this.load('regular'))
  }
}
