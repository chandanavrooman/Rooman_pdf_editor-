import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFString, PDFHexString, type PDFDocument } from 'pdf-lib'
import type { EditorObject } from './types'

/** annotation types where two identical copies are always a mistake */
const DEDUPE_SUBTYPES = new Set(['Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Link', 'Square', 'Circle', 'Line', 'Ink', 'FreeText', 'Stamp'])
const TOL = 0.5

const near = (a: number, b: number) => Math.abs(a - b) <= TOL
const isMark = (o: EditorObject) => o.type === 'highlight' || o.type === 'underline' || o.type === 'strike' || o.type === 'link'

/** Is `b` the same mark (or link) as `a`: same page, type, color / target, and rectangle within half a point? */
export function sameMark(a: EditorObject, b: EditorObject): boolean {
  if (!isMark(a) || a.type !== b.type || a.page !== b.page) return false
  if (!(near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h))) return false
  if (a.type === 'link' && b.type === 'link') return JSON.stringify(a.target) === JSON.stringify(b.target)
  if ((a.type === 'highlight' || a.type === 'underline' || a.type === 'strike') && (b.type === 'highlight' || b.type === 'underline' || b.type === 'strike')) return a.color.toLowerCase() === b.color.toLowerCase()
  return false
}

/** Drop marks / links that duplicate an earlier one in the list (or one in `existing`). Everything else is kept untouched. */
export function dedupeObjects(list: EditorObject[], existing: EditorObject[] = []): EditorObject[] {
  const kept: EditorObject[] = []
  for (const o of list) {
    if (isMark(o) && (existing.some((e) => sameMark(e, o)) || kept.some((e) => sameMark(e, o)))) continue
    kept.push(o)
  }
  return kept
}

const r05 = (n: number) => (Math.round(n / TOL) * TOL).toFixed(1)
const num = (v: unknown) => (v instanceof PDFNumber ? v.asNumber() : 0)

function annotKey(doc: PDFDocument, a: PDFDict): string | null {
  const st = a.lookup(PDFName.of('Subtype'))
  const subtype = st instanceof PDFName ? st.decodeText() : ''
  if (!DEDUPE_SUBTYPES.has(subtype)) return null
  const rect = a.lookup(PDFName.of('Rect'))
  if (!(rect instanceof PDFArray)) return null
  const rr = [0, 1, 2, 3].map((i) => r05(num(rect.lookup(i))))
  const c = a.lookup(PDFName.of('C'))
  const color = c instanceof PDFArray ? [...Array(c.size()).keys()].map((i) => num(c.lookup(i)).toFixed(3)).join(',') : ''
  let target = ''
  if (subtype === 'Link') {
    const act = a.lookup(PDFName.of('A'))
    if (act instanceof PDFDict) {
      const uri = act.lookup(PDFName.of('URI'))
      target = 'uri:' + (uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : '')
    } else {
      const dest = a.get(PDFName.of('Dest'))
      const first = dest instanceof PDFArray ? dest.get(0) : dest
      target = 'dest:' + (first instanceof PDFRef ? first.toString() : '')
    }
  }
  const contents = a.lookup(PDFName.of('Contents'))
  const text = contents instanceof PDFString || contents instanceof PDFHexString ? contents.decodeText() : ''
  void doc
  return [subtype, rr.join(','), color, target, text].join('|')
}

/**
 * Remove annotations that are exact duplicates (same type, same rectangle within 0.5pt, same color / target / text) from every page,
 * keeping the first. Returns how many were removed. Form widgets are never touched.
 */
export function dedupeAnnotations(doc: PDFDocument): number {
  let removed = 0
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'))
    if (!(annots instanceof PDFArray)) continue
    const seen = new Set<string>()
    const keep: PDFRef[] = []
    let dropped = 0
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i)
      const dict = annots.lookup(i)
      if (!(ref instanceof PDFRef) || !(dict instanceof PDFDict)) {
        if (ref instanceof PDFRef) keep.push(ref)
        continue
      }
      const key = annotKey(doc, dict)
      if (key && seen.has(key)) {
        dropped++
        continue
      }
      if (key) seen.add(key)
      keep.push(ref)
    }
    if (dropped) {
      page.node.set(PDFName.of('Annots'), doc.context.obj(keep))
      removed += dropped
    }
  }
  return removed
}
