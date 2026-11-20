import { bboxOf } from './geometry'
import { newId } from './state'
import type { DrawObj, EditorObject, FieldKind, FieldObj, ImageObj, LineObj, LinkObj, LinkTarget, MarkObj, Pt, ShapeObj, TextObj, WhiteoutObj, Box } from './types'
import { fitTextBox } from './textLayout'

export interface ToolDefaults {
  text: Pick<TextObj, 'family' | 'size' | 'color' | 'bold' | 'italic' | 'align' | 'fontId'>
  shape: { stroke: string | null; strokeWidth: number; fill: string | null }
  line: { stroke: string; strokeWidth: number }
  draw: { stroke: string; strokeWidth: number }
  highlight: { color: string }
  underline: { color: string }
  strike: { color: string }
  whiteout: { fill: string }
}

export const DEFAULTS: ToolDefaults = {
  text: { family: 'helvetica', size: 16, color: '#111827', bold: false, italic: false, align: 'left' },
  shape: { stroke: '#dc2626', strokeWidth: 2, fill: null },
  line: { stroke: '#dc2626', strokeWidth: 2 },
  draw: { stroke: '#2563eb', strokeWidth: 2.5 },
  highlight: { color: '#fde047' },
  underline: { color: '#dc2626' },
  strike: { color: '#dc2626' },
  whiteout: { fill: '#ffffff' },
}

export const HIGHLIGHT_COLORS = ['#fde047', '#86efac', '#f9a8d4', '#7dd3fc', '#fdba74']

export function makeText(page: number, p: Pt, d: ToolDefaults['text'], text = '', width?: number): TextObj {
  const o: TextObj = { id: newId('t'), type: 'text', page, x: p.x, y: p.y, w: width ?? 40, h: d.size * 1.2, text, autoWidth: width === undefined, ...d }
  const fit = fitTextBox(o)
  return { ...o, w: fit.w, h: fit.h }
}
export const makeWhiteout = (page: number, b: Box, fill: string): WhiteoutObj => ({ id: newId('w'), type: 'whiteout', page, ...b, fill })
export const makeShape = (type: 'rect' | 'ellipse', page: number, b: Box, d: ToolDefaults['shape']): ShapeObj => ({ id: newId('s'), type, page, ...b, ...d })
export function makeLine(type: 'line' | 'arrow', page: number, a: Pt, b: Pt, d: ToolDefaults['line']): LineObj {
  const bb = bboxOf([a, b])
  return { id: newId('l'), type, page, ...bb, pts: [a, b], ...d }
}
export function makeDraw(page: number, pts: Pt[], d: ToolDefaults['draw']): DrawObj {
  const bb = bboxOf(pts)
  return { id: newId('d'), type: 'draw', page, ...bb, pts, ...d }
}
export const makeMark = (type: 'highlight' | 'underline' | 'strike', page: number, b: Box, color: string): MarkObj => ({ id: newId('m'), type, page, ...b, color })
export const makeImage = (type: 'image' | 'signature', page: number, b: Box, assetId: string): ImageObj => ({ id: newId('i'), type, page, ...b, assetId, keepAspect: true })
export const makeLink = (page: number, b: Box, target: LinkTarget): LinkObj => ({ id: newId('k'), type: 'link', page, ...b, target })
export function makeField(kind: FieldKind, page: number, b: Box, name: string): FieldObj {
  return { id: newId('f'), type: 'field', page, ...b, fieldKind: kind, name, options: kind === 'dropdown' ? ['Option 1', 'Option 2', 'Option 3'] : kind === 'radio' ? ['Option'] : [], value: kind === 'checkbox' || kind === 'radio' ? false : '' }
}

/** "name" -> "name_2" (or the next free number) when `name` is taken. */
export function uniqueFieldName(name: string, taken: ReadonlySet<string>): string {
  const base = name.trim().replace(/_\d+$/, '') || 'field'
  if (!taken.has(name.trim()) && name.trim()) return name.trim()
  let i = 2
  while (taken.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

/**
 * Copies of `objs` (for Duplicate / Paste). A copied FORM FIELD gets a new name, so the copy is a separate field with its own value;
 * a copied RADIO BUTTON stays in its group and gets its own option label.
 */
export function cloneObjects(objs: EditorObject[], all: EditorObject[], dx = 12, dy = 12, takenElsewhere: Iterable<string> = []): EditorObject[] {
  const taken = new Set<string>([...takenElsewhere, ...all.filter((x): x is FieldObj => x.type === 'field' && x.fieldKind !== 'radio').map((x) => x.name)])
  const labels = new Map<string, Set<string>>()
  for (const x of all) if (x.type === 'field' && x.fieldKind === 'radio') labels.set(x.name, new Set([...(labels.get(x.name) ?? []), x.options[0] ?? '']))
  return objs.map((o) => {
    const copy = cloneObject(o, dx, dy)
    if (copy.type !== 'field') return copy
    if (copy.fieldKind === 'radio') {
      const used = labels.get(copy.name) ?? new Set<string>()
      const base = (copy.options[0] || 'Option').replace(/ \d+$/, '')
      let n = 2
      while (used.has(`${base} ${n}`)) n++
      const label = `${base} ${n}`
      used.add(label)
      labels.set(copy.name, used)
      return { ...copy, options: [label], value: false }
    }
    const name = uniqueFieldName(copy.name, taken)
    taken.add(name)
    return { ...copy, name }
  })
}

export function cloneObject<T extends EditorObject>(o: T, dx = 12, dy = 12): T {
  const copy = { ...o, id: newId(o.type[0]), x: o.x + dx, y: o.y + dy } as T
  if ('pts' in copy) (copy as unknown as { pts: Pt[] }).pts = (copy as unknown as { pts: Pt[] }).pts.map((p) => ({ x: p.x + dx, y: p.y + dy }))
  return copy
}
