import fontkit from '@pdf-lib/fontkit'
import type { TextObj } from './types'

/**
 * Fonts the PDF itself embeds (TrueType only). Edited text uses the PDF's own font whenever it holds every character that was typed, so
 * the new text is the same typeface as the text around it, in the preview and in every viewer; otherwise the bundled font is used.
 */
type Parsed = { hasGlyphForCodePoint: (cp: number) => boolean }
interface Entry {
  data: Uint8Array
  font: Parsed | null
  face?: Promise<string | null>
}
const registry = new Map<string, Entry>()

const isTrueType = (d: Uint8Array) => d.length > 12 && ((d[0] === 0 && d[1] === 1 && d[2] === 0 && d[3] === 0) || String.fromCharCode(d[0], d[1], d[2], d[3]) === 'true')

/** Remember the font program of one PDF font. Returns the key, or undefined when it cannot be reused (not TrueType, unreadable). */
export function registerEmbedded(key: string, data: unknown): string | undefined {
  if (registry.has(key)) return registry.get(key)!.font ? key : undefined
  if (!(data instanceof Uint8Array) || !isTrueType(data)) {
    registry.set(key, { data: new Uint8Array(0), font: null })
    return undefined
  }
  let font: Parsed | null
  try {
    font = fontkit.create(data) as unknown as Parsed
  } catch {
    font = null
  }
  registry.set(key, { data, font })
  return font ? key : undefined
}

export const embeddedBytes = (key: string): Uint8Array | undefined => registry.get(key)?.data

/** Does the embedded font hold a glyph for every character of `text`? */
export function embeddedCovers(key: string, text: string, ignoreSpaces = false): boolean {
  const f = registry.get(key)?.font
  if (!f) return false
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x0a || cp === 0x0d || (ignoreSpaces && (cp === 0x20 || cp === 0xa0))) continue
    if (!f.hasGlyphForCodePoint(cp)) return false
  }
  return true
}

/** The key to draw this object's text with, or undefined (use the bundled font): same typeface and style as the original run, and every typed character is in the font. */
export function embeddedKeyFor(o: Pick<TextObj, 'text' | 'bold' | 'italic' | 'fontId' | 'orig' | 'autoWidth'> & { embedKey?: string }): string | undefined {
  const k = o.embedKey
  const g = o.orig
  if (!k || !g || o.fontId !== g.fontId || o.bold !== g.bold || o.italic !== g.italic) return undefined
  // a single line is placed word by word and no space is ever drawn (Word's font subsets often have no space glyph); wrapped text draws its spaces
  const wrapped = o.autoWidth === false || o.text.includes(String.fromCharCode(10))
  return embeddedCovers(k, o.text, !wrapped) ? k : undefined
}

/** Make the browser able to draw with the embedded font (a CSS family name is returned once it is loaded). */
export function ensureEmbeddedFace(key: string): Promise<string | null> {
  const e = registry.get(key)
  if (!e || !e.font || typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve(null)
  e.face ??= (async () => {
    try {
      const name = cssNameFor(key)
      const face = new FontFace(name, e.data.slice().buffer as ArrayBuffer)
      await face.load()
      document.fonts.add(face)
      return name
    } catch {
      return null
    }
  })()
  return e.face
}

let seq = 0
const names = new Map<string, string>()
export function cssNameFor(key: string): string {
  let n = names.get(key)
  if (!n) {
    n = `RP Embedded ${++seq}`
    names.set(key, n)
  }
  return n
}
export const embeddedLoaded = (key: string): boolean => names.has(key) && typeof document !== 'undefined' && document.fonts.check(`12px "${names.get(key)}"`)
