/// <reference types="vite/client" />
/**
 * Bundled open-license fonts the editor can embed. Files live in src/assets/fonts (licenses: see /LICENSES-FONTS.md).
 * Everything here is browser/node neutral except `ensureFontFaces` / `fetchFontBytes`.
 */
import fontkit from '@pdf-lib/fontkit'

export type FontId =
  | 'liberation-sans'
  | 'arimo'
  | 'liberation-serif'
  | 'tinos'
  | 'liberation-mono'
  | 'caladea'
  | 'carlito'
  | 'dejavu-sans'
  | 'dejavu-serif'
  | 'amiri'
  | 'noto-sans'
  | 'open-sans'
  | 'roboto'
  | 'latin-modern'
  | 'noto-serif'

export type Variant = 'regular' | 'bold' | 'italic' | 'bolditalic'
export const variantOf = (bold: boolean, italic: boolean): Variant => (bold ? (italic ? 'bolditalic' : 'bold') : italic ? 'italic' : 'regular')

export interface FontInfo {
  id: FontId
  /** shown in the dropdown */
  label: string
  /** the commercial / original font this one stands in for */
  replaces: string
  generic: 'sans-serif' | 'serif' | 'monospace'
  /** file stem; files are `${stem}-Regular.ttf` etc. */
  stem: string
  /** hhea ascent / descent in em (used to place the baseline in CSS boxes) */
  asc: number
  desc: number
  /** embed the whole file: pdf-lib's subsetter drops glyphs from these two fonts */
  noSubset?: boolean
}

export const FONTS: FontInfo[] = [
  { id: 'liberation-sans', label: 'Arial (Liberation Sans)', replaces: 'Arial, Helvetica', generic: 'sans-serif', stem: 'LiberationSans', asc: 0.9053, desc: 0.2119 },
  { id: 'arimo', label: 'Arimo', replaces: 'Arial (Google metric-compatible twin)', generic: 'sans-serif', stem: 'Arimo', asc: 0.9053, desc: 0.2119 },
  { id: 'liberation-serif', label: 'Times New Roman (Liberation Serif)', replaces: 'Times New Roman, Times', generic: 'serif', stem: 'LiberationSerif', asc: 0.8911, desc: 0.2163 },
  { id: 'tinos', label: 'Tinos', replaces: 'Times New Roman (Google metric-compatible twin)', generic: 'serif', stem: 'Tinos', asc: 0.8911, desc: 0.2163 },
  { id: 'liberation-mono', label: 'Courier / Courier New (Liberation Mono)', replaces: 'Courier, Courier New', generic: 'monospace', stem: 'LiberationMono', asc: 0.8325, desc: 0.3003 },
  { id: 'caladea', label: 'Caladea (Cambria)', replaces: 'Cambria', generic: 'serif', stem: 'Caladea', asc: 0.9, desc: 0.25 },
  { id: 'carlito', label: 'Carlito (Calibri)', replaces: 'Calibri', generic: 'sans-serif', stem: 'Carlito', asc: 0.9521, desc: 0.2686 },
  { id: 'dejavu-sans', label: 'DejaVu Sans (Verdana)', replaces: 'Verdana', generic: 'sans-serif', stem: 'DejaVuSans', asc: 0.9282, desc: 0.2358 },
  { id: 'dejavu-serif', label: 'DejaVu Serif (Georgia)', replaces: 'Georgia', generic: 'serif', stem: 'DejaVuSerif', asc: 0.9282, desc: 0.2358 },
  { id: 'amiri', label: 'Amiri (Arabic)', replaces: 'Arabic text', generic: 'serif', stem: 'Amiri', asc: 1.124, desc: 0.634 },
  { id: 'noto-sans', label: 'Noto Sans', replaces: 'Latin / Greek / Cyrillic fallback', generic: 'sans-serif', stem: 'NotoSans', asc: 1.069, desc: 0.293 },
  { id: 'open-sans', label: 'Open Sans', replaces: 'Open Sans', generic: 'sans-serif', stem: 'OpenSans', asc: 1.0688, desc: 0.293 },
  { id: 'roboto', label: 'Roboto', replaces: 'Roboto', generic: 'sans-serif', stem: 'Roboto', asc: 0.9277, desc: 0.2441 },
  { id: 'latin-modern', label: 'Latin Modern (Computer Modern)', replaces: 'Computer Modern, LaTeX text', generic: 'serif', stem: 'LatinModernRoman', asc: 1.127, desc: 0.29, noSubset: true },
  { id: 'noto-serif', label: 'Noto Serif', replaces: 'Noto Serif', generic: 'serif', stem: 'NotoSerif', asc: 1.069, desc: 0.293, noSubset: true },
]

/** pdf-lib embed options for a bundled font */
export const embedOpts = (id: FontId) => ({ subset: !FONTS.find((f) => f.id === id)?.noSubset })

export const fontInfo = (id: FontId): FontInfo => FONTS.find((f) => f.id === id) ?? FONTS[0]

/** distance from the top of a CSS line box (line-height 1.2) to the baseline, in em */
export const baselineFrac = (id: FontId, lineHeight = 1.2): number => {
  const f = fontInfo(id)
  return (lineHeight - (f.asc + f.desc)) / 2 + f.asc
}

const FILE_SUFFIX: Record<Variant, string> = { regular: 'Regular', bold: 'Bold', italic: 'Italic', bolditalic: 'BoldItalic' }
const NOTO_SUFFIX: Record<Variant, string> = { regular: '400Regular', bold: '700Bold', italic: '400Regular_Italic', bolditalic: '700Bold_Italic' }

export const fontFileName = (id: FontId, v: Variant): string => {
  const f = fontInfo(id)
  return id === 'noto-sans' ? `NotoSans_${NOTO_SUFFIX[v]}.ttf` : `${f.stem}-${FILE_SUFFIX[v]}.ttf`
}

// Vite resolves each bundled file to a URL; in vitest the same glob works (files are served from disk).
const URLS = import.meta.glob('../assets/fonts/*.ttf', { query: '?url', import: 'default', eager: true }) as Record<string, string>
export const fontUrl = (id: FontId, v: Variant): string | undefined => URLS[`../assets/fonts/${fontFileName(id, v)}`]

export const cssFamilyName = (id: FontId) => `RP ${fontInfo(id).label.replace(/[^A-Za-z0-9]+/g, ' ').trim()}`
export const cssStack = (id: FontId) => `"${cssFamilyName(id)}", ${fontInfo(id).generic}`

let facesInjected = false
/** Registers @font-face rules for every bundled font (browser only). Safe to call repeatedly. */
export function ensureFontFaces() {
  if (facesInjected || typeof document === 'undefined') return
  facesInjected = true
  const rules: string[] = []
  for (const f of FONTS)
    for (const v of ['regular', 'bold', 'italic', 'bolditalic'] as Variant[]) {
      const url = fontUrl(f.id, v)
      if (!url) continue
      rules.push(`@font-face{font-family:"${cssFamilyName(f.id)}";src:url("${url}") format("truetype");font-weight:${v.startsWith('bold') ? 700 : 400};font-style:${v.endsWith('italic') ? 'italic' : 'normal'};font-display:block}`)
    }
  const el = document.createElement('style')
  el.setAttribute('data-bundled-fonts', '')
  el.textContent = rules.join('\n')
  document.head.appendChild(el)
}

/** Make sure the browser has the font loaded before we measure or draw with it. */
export async function loadFontForDisplay(id: FontId, bold: boolean, italic: boolean) {
  ensureFontFaces()
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await document.fonts.load(`${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}16px "${cssFamilyName(id)}"`)
  } catch {
    /* fall back to the generic family */
  }
}

// ───────────────────────── detection from the PDF's own font name

export interface DetectedFont {
  fontId: FontId
  bold: boolean
  italic: boolean
  /** the original name as found in the PDF, subset prefix removed */
  original: string
}

export const stripSubset = (name: string) => name.replace(/^[A-Z]{6}\+/, '')

export function detectFont(rawName: string, opts: { cssFamily?: string; bold?: boolean; italic?: boolean } = {}): DetectedFont {
  const original = stripSubset(rawName || '')
  const n = original.toLowerCase().replace(/[\s_]/g, '')
  const css = (opts.cssFamily || '').toLowerCase()
  const has = (...k: string[]) => k.some((x) => n.includes(x))
  let fontId: FontId
  if (/^(cmtt|lmmono)/.test(n)) fontId = 'liberation-mono'
  else if (has('notoserif')) fontId = 'noto-serif'
  else if (/^(cm(r|bx|ti|sl|ss|csc|ex|ui|b|mi|sy|ff|fi|u)\d|lmroman|lmsans|lmmath|latinmodern)/.test(n) || has('computermodern')) fontId = 'latin-modern'
  else if (has('liberationmono', 'courier', 'cousine', 'consolas', 'lucidaconsole', 'monaco', 'menlo')) fontId = 'liberation-mono'
  else if (has('liberationserif', 'times', 'tinos', 'timesnewroman')) fontId = has('tinos') ? 'tinos' : 'liberation-serif'
  else if (has('cambria', 'caladea')) fontId = 'caladea'
  else if (has('calibri', 'carlito')) fontId = 'carlito'
  else if (has('verdana', 'dejavusans', 'tahoma')) fontId = 'dejavu-sans'
  else if (has('georgia', 'dejavuserif', 'garamond', 'baskerville', 'minion', 'palatino', 'caslon', 'bodoni', 'century', 'didot', 'bookantiqua', 'bookman', 'charter', 'merriweather')) fontId = 'dejavu-serif'
  else if (has('serif') && !has('sans')) fontId = 'liberation-serif'
  else if (has('roman') && !has('sans')) fontId = 'liberation-serif'
  else if (has('amiri', 'arabic', 'naskh')) fontId = 'amiri'
  else if (has('opensans')) fontId = 'open-sans'
  else if (has('roboto')) fontId = 'roboto'
  else if (has('notosans')) fontId = 'noto-sans'
  else if (has('arimo')) fontId = 'arimo'
  else if (has('helvetica', 'arial', 'liberationsans')) fontId = 'liberation-sans'
  else if (css.includes('monospace') || has('mono')) fontId = 'liberation-mono'
  else if (css.includes('serif') && !css.includes('sans')) fontId = 'liberation-serif'
  else fontId = 'liberation-sans'
  const bold = Boolean(opts.bold) || /bold|black|heavy|semibold|demi/.test(n)
  const italic = Boolean(opts.italic) || /italic|oblique/.test(n) || /-it$|,it$/.test(n)
  return { fontId, bold, italic, original }
}

// ───────────────────────── bytes + glyph coverage

export type FontLoader = (id: FontId, v: Variant) => Promise<Uint8Array>

/** browser: fetch the bundled file */
export const fetchFontBytes: FontLoader = async (id, v) => {
  const url = fontUrl(id, v)
  if (!url) throw new Error(`The font file for ${fontInfo(id).label} (${v}) is not bundled.`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load the font ${fontInfo(id).label}.`)
  return new Uint8Array(await res.arrayBuffer())
}

type GlyphProbe = { hasGlyphForCodePoint(cp: number): boolean }
const probes = new Map<string, Promise<GlyphProbe>>()
const probeFor = (id: FontId, load: FontLoader) => {
  let p = probes.get(id)
  if (!p) {
    p = load(id, 'regular').then((b) => fontkit.create(b) as unknown as GlyphProbe)
    probes.set(id, p)
  }
  return p
}

/** Characters of `text` that the font cannot draw (whitespace ignored). */
export async function missingGlyphs(id: FontId, text: string, load: FontLoader = fetchFontBytes): Promise<string[]> {
  const probe = await probeFor(id, load)
  const bad = new Set<string>()
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x0a || cp === 0x0d || cp === 0x09 || cp === 0x20 || cp === 0xa0) continue
    if (!probe.hasGlyphForCodePoint(cp)) bad.add(ch)
  }
  return [...bad]
}

const SUGGEST_ORDER: FontId[] = ['noto-sans', 'noto-serif', 'dejavu-sans', 'dejavu-serif', 'amiri', 'open-sans', 'roboto', 'liberation-sans', 'liberation-serif', 'carlito', 'caladea']
/** First bundled font (other than `not`) that has every character, or null. */
export async function suggestFontFor(text: string, not: FontId, load: FontLoader = fetchFontBytes): Promise<FontId | null> {
  for (const id of SUGGEST_ORDER) {
    if (id === not) continue
    try {
      if ((await missingGlyphs(id, text, load)).length === 0) return id
    } catch {
      /* try next */
    }
  }
  return null
}
