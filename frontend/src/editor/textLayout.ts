import { cssNameFor, embeddedKeyFor, embeddedLoaded } from './embeddedFonts'
import { StandardFonts } from 'pdf-lib'
import type { Box, Family, TextObj } from './types'
import { cssStack, baselineFrac, fontInfo, type FontId } from './fontCatalog'

export const FAMILY_CSS: Record<Family, string> = {
  helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  times: '"Times New Roman", Times, "Liberation Serif", serif',
  courier: '"Courier New", Courier, "Liberation Mono", monospace',
}
export const FAMILY_LABEL: Record<Family, string> = { helvetica: 'Helvetica (sans)', times: 'Times (serif)', courier: 'Courier (mono)' }
export const LINE_HEIGHT = 1.2
/** line height as a multiple of the font size (a table cell keeps the table's own leading) */
export const lineHeightOf = (o: { size: number; leading?: number }): number => (o.leading ? o.leading / o.size : LINE_HEIGHT)
/** distance from the top of a line box to its baseline, as a fraction of font size (CSS line-height 1.2) */
export const BASELINE: Record<Family, number> = { helvetica: 0.9465, times: 0.9375, courier: 0.8665 }

export function standardFontFor(family: Family, bold: boolean, italic: boolean): StandardFonts {
  if (family === 'times') return bold ? (italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold) : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman
  if (family === 'courier') return bold ? (italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold) : italic ? StandardFonts.CourierOblique : StandardFonts.Courier
  return bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica
}

const WIN_ANSI_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178])

export function isWinAnsiChar(cp: number): boolean {
  return cp === 0x0a || cp === 0x0d || cp === 0x09 || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp)
}
export function isWinAnsi(s: string): boolean {
  for (const ch of s) if (!isWinAnsiChar(ch.codePointAt(0)!)) return false
  return true
}

/** Greedy word wrap. `maxWidth` null/0 = only explicit newlines. */
export function wrapLines(text: string, maxWidth: number | null, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!maxWidth || maxWidth <= 0 || measure(raw) <= maxWidth) {
      out.push(raw)
      continue
    }
    let line = ''
    for (const word of raw.split(/(?<= )/)) {
      const trial = line + word
      if (line && measure(trial.trimEnd()) > maxWidth) {
        out.push(line.trimEnd())
        line = word
      } else line = trial
      // a single very long word: break by characters
      while (measure(line.trimEnd()) > maxWidth && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--
        out.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

let ctx: CanvasRenderingContext2D | null | undefined
function canvasCtx() {
  if (ctx !== undefined) return ctx
  try {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  } catch {
    ctx = null
  }
  return ctx
}

/** CSS font stack for a text object (bundled font when it has one, else the standard-font look-alike). */
const SYSTEM_CSS: Record<string, string> = {
  'liberation-sans': 'Arial, Helvetica',
  'liberation-serif': '"Times New Roman", Times',
  'liberation-mono': '"Courier New", Courier',
}
/** CSS font stack. A run whose font the PDF does not embed is shown in the system's own copy first, as the page itself is. */
export const textCss = (o: Pick<TextObj, 'family' | 'fontId'> & { sysFont?: boolean; embedKey?: string; text?: string; bold?: boolean; italic?: boolean; orig?: TextObj['orig']; autoWidth?: boolean }): string => {
  if (!o.fontId) return FAMILY_CSS[o.family]
  const base = o.sysFont && SYSTEM_CSS[o.fontId] ? `${SYSTEM_CSS[o.fontId]}, ${cssStack(o.fontId)}` : cssStack(o.fontId)
  const k = o.embedKey && o.orig ? embeddedKeyFor({ text: o.text ?? '', bold: !!o.bold, italic: !!o.italic, fontId: o.fontId, orig: o.orig, embedKey: o.embedKey, autoWidth: o.autoWidth ?? true }) : undefined
  return k && embeddedLoaded(k) ? `"${cssNameFor(k)}", ${base}` : base
}
/** top of the box -> baseline, as a fraction of the font size */
export const baselineOffset = (o: Pick<TextObj, 'family' | 'fontId' | 'size' | 'leading'>): number => (o.fontId ? baselineFrac(o.fontId, lineHeightOf(o)) : BASELINE[o.family])

/** Browser-side text measurement used to size auto-width boxes (approximates the standard PDF font metrics). */
export function measureText(s: string, o: Pick<TextObj, 'family' | 'size' | 'bold' | 'italic' | 'fontId'>): number {
  const c = canvasCtx()
  if (!c) return s.length * o.size * 0.55
  c.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size}px ${textCss(o)}`
  // PDF text is positioned glyph by glyph with the font's plain advance widths (no kerning)
  c.fontKerning = 'none'
  return c.measureText(s).width
}

/** Size of a text object's box from its content. */
export function fitTextBox(o: TextObj): { w: number; h: number } {
  const measure = (s: string) => measureText(s, o)
  const lines = wrapLines(o.text, o.autoWidth ? null : o.w, measure)
  const w = o.autoWidth ? Math.max(o.size * 0.6, ...lines.map(measure)) + 2 : o.w
  return { w, h: Math.max(1, lines.length) * o.size * lineHeightOf(o) }
}

const STD_ID: Record<Family, FontId> = { helvetica: 'liberation-sans', times: 'liberation-serif', courier: 'liberation-mono' }
/** ascent / descent of the object's font, in em */
export const ascDesc = (o: Pick<TextObj, 'family' | 'fontId'>) => {
  const f = fontInfo(o.fontId ?? STD_ID[o.family])
  return { asc: f.asc, desc: f.desc }
}

/**
 * The ONE outline box around a text object, page space (points). It hugs the text: the left/right edges are the text
 * edges (the screen adds an equal 2px padding on both sides), top = line ascent, bottom = last line's descent.
 */
export function outlineBox(o: TextObj): Box & { lines: number } {
  const measure = (s: string) => measureText(s, o)
  const lines = wrapLines(o.text, o.autoWidth ? null : o.w, measure)
  const w = o.autoWidth ? Math.max(0, ...lines.map(measure)) : o.w
  const { asc, desc } = ascDesc(o)
  const n = Math.max(1, lines.length)
  return { x: o.x, y: o.y + o.size * (baselineOffset(o) - asc), w, h: (n - 1) * o.size * lineHeightOf(o) + (asc + desc) * o.size, lines: n }
}

const baselineProbe = new Map<string, number>()
let probeListening = false
/**
 * Where the browser REALLY puts the baseline inside a CSS line box (px from the top of a line-height 1.2 box).
 * Browsers round ascent and half-leading to whole pixels, so this differs from the exact font-metric value by up to ~1px.
 */
export function cssBaselinePx(o: Pick<TextObj, 'family' | 'fontId' | 'bold' | 'italic' | 'size' | 'leading'>, sizePx: number): number {
  if (typeof document === 'undefined' || !document.body) return baselineOffset(o) * sizePx
  if (!probeListening && document.fonts) {
    probeListening = true
    document.fonts.addEventListener('loadingdone', () => baselineProbe.clear())
  }
  const lh = lineHeightOf(o)
  const key = `${textCss(o)}|${o.bold}|${o.italic}|${sizePx.toFixed(3)}|${lh.toFixed(4)}`
  const hit = baselineProbe.get(key)
  if (hit !== undefined) return hit
  const d = document.createElement('div')
  d.style.cssText = `position:fixed;left:-10000px;top:0;visibility:hidden;white-space:pre;line-height:${lh};font-family:${textCss(o)};font-size:${sizePx}px;font-weight:${o.bold ? 700 : 400};font-style:${o.italic ? 'italic' : 'normal'}`
  d.innerHTML = 'Hx<span style="display:inline-block;width:0;height:0"></span>'
  document.body.appendChild(d)
  const v = (d.querySelector('span') as HTMLElement).getBoundingClientRect().top - d.getBoundingClientRect().top
  d.remove()
  baselineProbe.set(key, v)
  return v
}
/** how far (px) to move a CSS text box so its REAL baseline lands where the PDF's baseline is */
export const baselineFix = (o: Pick<TextObj, 'family' | 'fontId' | 'bold' | 'italic' | 'size' | 'leading'>, s: number): number => baselineOffset(o) * o.size * s - cssBaselinePx(o, o.size * s)
