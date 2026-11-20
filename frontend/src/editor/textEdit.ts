import { newId } from './state'
import type { DEFAULTS } from './objects'
import { LINE_HEIGHT, baselineOffset, fitTextBox, lineHeightOf } from './textLayout'
import type { SnapItem } from './textSnap'
import type { TextObj } from './types'

/**
 * Turn a clicked PDF text run into an editable text object that keeps the run's own font, size, color and baseline.
 * `fill` is the background sampled around the run, so the cover patch matches the page (row color, navy header, …).
 */
export function textObjFromSnap(item: SnapItem, page: number, defaults: (typeof DEFAULTS)['text']): TextObj {
  const size = item.fontSize || defaults.size
  const lineH = size * LINE_HEIGHT
  const color = item.color || defaults.color || '#111827'
  const bold = item.bold ?? defaults.bold
  const italic = item.italic ?? defaults.italic
  const o = item.origin
  const base: TextObj = {
    id: newId('t'),
    type: 'text',
    page,
    x: o ? o.x : item.box.x - 1,
    y: item.box.y - 1,
    w: Math.max(o ? o.w : item.box.w + 2, 30),
    h: Math.max(item.box.h + 2, lineH),
    text: item.str,
    family: item.family || defaults.family,
    size,
    color,
    bold,
    italic,
    align: 'left',
    autoWidth: true,
    fill: item.bg || '#ffffff',
  }
  const fontId = item.fontId
  if (!o || !fontId) return base
  // the PDF's own character spacing (Tc) and word spacing (Tw, spread over the run) - so the editor has the same rhythm
  let letterSpacing: number | undefined
  const spaces = (item.str.match(/ /g) ?? []).length
  const ls = (item.charSpacing ?? 0) + ((item.wordSpacing ?? 0) * spaces) / Math.max(1, item.str.length)
  if (Math.abs(ls) > 0.002) letterSpacing = ls
  base.letterSpacing = letterSpacing
  base.opacity = item.opacity
  const t: TextObj = { ...base, fontId, baseline: o.baseline, fontUsed: item.fontUsed, sysFont: item.sysFont, embedKey: item.embedKey, orig: { str: item.str, x: o.x, baseline: o.baseline, w: o.w, fontId, size, bold, italic, color } }
  return { ...t, y: o.baseline - size * baselineOffset(t), h: lineH }
}

/** Patch for changing text properties (size, font, bold…): refits the box and keeps text that came from the PDF on its baseline. */
export function textPatch(o: TextObj, patch: Partial<TextObj>): Partial<TextObj> {
  const t = { ...o, ...patch }
  const fit = fitTextBox(t)
  const y = t.baseline !== undefined ? t.baseline - t.size * baselineOffset(t) : t.y
  return { ...patch, y, w: t.autoWidth ? Math.max(fit.w, t.orig ? t.orig.w : 0) : t.w, h: fit.h }
}

/**
 * A whole table cell as one text block: every line of the cell joined into a paragraph, with the cell's own text width and line spacing,
 * so an edit stays inside the cell and re-wraps there. Returns null when the cell mixes fonts/sizes/colors (then single runs are edited).
 */
export function textObjFromCell(item: SnapItem, page: number, defaults: (typeof DEFAULTS)['text']): TextObj | null {
  const cell = item.cell
  if (!cell || cell.runs.length === 0 || cell.runs.some((r) => !r.origin || !r.fontId || !r.fontSize)) return null
  const first = cell.runs[0]
  const homogeneous = cell.runs.every((r) => r.fontId === first.fontId && r.fontSize === first.fontSize && !!r.bold === !!first.bold && !!r.italic === !!first.italic && (r.color ?? '') === (first.color ?? ''))
  if (!homogeneous) return null
  const base = textObjFromSnap(first, page, defaults)
  if (!base.orig) return null
  const size = base.size
  const baselines = cell.runs.map((r) => r.origin!.baseline)
  const gaps = baselines.slice(1).map((b, i) => b - baselines[i]).filter((g) => g > 4).sort((a, b) => a - b)
  const leading = gaps.length ? gaps[Math.floor(gaps.length / 2)] : (cell.leadingRatio ?? LINE_HEIGHT) * size
  const x = Math.min(...cell.runs.map((r) => r.origin!.x))
  const w = cell.x + cell.w - cell.padR - x + 0.5
  const text = cell.runs.map((r) => r.str.trim()).join(' ')
  const block = { runs: cell.runs.map((r) => ({ x: r.origin!.x, baseline: r.origin!.baseline, w: r.origin!.w })), leading, w }
  const t: TextObj = { ...base, text, x, w, autoWidth: false, leading, fill: cell.fill ?? base.fill, orig: { ...base.orig, str: text, x, w, baseline: baselines[0], block } }
  const fit = fitTextBox(t)
  return { ...t, y: baselines[0] - size * baselineOffset(t), h: fit.h }
}

/** Has the user changed nothing about the run / cell this object started from? (Then the original stays untouched and is not redrawn.) */
export function isUnchanged(o: TextObj): boolean {
  const g = o.orig
  if (!g) return false
  if (!(o.text === g.str && o.fontId === g.fontId && o.size === g.size && o.bold === g.bold && o.italic === g.italic && o.color.toLowerCase() === g.color.toLowerCase())) return false
  // a run that was only MOVED is a change too: the original must be covered and the text drawn where it now is
  const moved = Math.abs(o.x - g.x) > 0.05 || Math.abs((o.baseline ?? g.baseline) - g.baseline) > 0.05
  if (moved) return false
  return g.block ? Math.abs(o.w - g.block.w) < 0.01 : o.autoWidth && !o.text.includes(String.fromCharCode(10))
}
void lineHeightOf
