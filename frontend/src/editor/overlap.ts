import type { SnapItem } from './textSnap'
import type { Box, EditorObject } from './types'

/** objects that sit ON TOP of the page and can hide or cross existing content */
export const isCoverBox = (o: EditorObject): o is Extract<EditorObject, { type: 'field' | 'rect' | 'ellipse' }> => o.type === 'field' || o.type === 'rect' || o.type === 'ellipse'

/** Existing text runs that `box` overlaps by at least `minShare` of the run's own area. */
export function overlappedText(box: Box, items: SnapItem[], minShare = 0.1): SnapItem[] {
  return items.filter((it) => {
    const b = it.box
    const ox = Math.min(b.x + b.w, box.x + box.w) - Math.max(b.x, box.x)
    const oy = Math.min(b.y + b.h, box.y + box.h) - Math.max(b.y, box.y)
    return ox > 0 && oy > 0 && (ox * oy) / Math.max(1e-6, b.w * b.h) >= minShare
  })
}

export function objectLabel(o: EditorObject): string {
  if (o.type === 'field') return { text: 'Text field', checkbox: 'Checkbox', radio: 'Radio button', dropdown: 'Dropdown' }[o.fieldKind]
  if (o.type === 'rect') return 'Rectangle'
  if (o.type === 'ellipse') return 'Ellipse'
  return 'Object'
}

/** Human-readable warning, or null when nothing is covered. */
export function overlapWarning(o: EditorObject, hits: SnapItem[]): string | null {
  if (!hits.length) return null
  const sample = hits
    .slice(0, 3)
    .map((h) => `\u201c${h.str.length > 38 ? h.str.slice(0, 36) + '\u2026' : h.str}\u201d`)
    .join(', ')
  const more = hits.length > 3 ? ` and ${hits.length - 3} more` : ''
  const filled = o.type === 'field' || ('fill' in o && !!o.fill)
  const verb = filled ? 'covers' : 'sits over'
  return `${objectLabel(o)} ${verb} existing text: ${sample}${more}. It will hide or overlap it in the exported PDF. Move or resize it, or click Undo.`
}
