import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { exportEdited } from './export'
import { loadNotoFromDisk } from '@/test/nodeRender'
import { makeMark } from './objects'
import { initialState, reducer } from './state'
import { dedupeObjects } from './annotations'
import type { EditorDoc, EditorObject } from './types'

const FIX = (n: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../tests/fixtures/${n}`, import.meta.url))))
const deps = { loadFontBytes: loadNotoFromDisk }
const doc = (objects: EditorObject[]): EditorDoc => ({ objects, formValues: {}, assets: {} })

async function annots(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes)
  const arr = pdf.getPage(0).node.lookup(PDFName.of('Annots'))
  const out: { type: string; rect: string }[] = []
  if (arr instanceof PDFArray)
    for (let i = 0; i < arr.size(); i++) {
      const d = arr.lookup(i) as PDFDict
      const st = (d.lookup(PDFName.of('Subtype')) as PDFName).decodeText()
      const r = d.lookup(PDFName.of('Rect')) as PDFArray
      out.push({ type: st, rect: [0, 1, 2, 3].map((k) => (r.lookup(k) as unknown as { asNumber(): number }).asNumber().toFixed(1)).join(',') })
    }
  return out
}
const count = (a: { type: string }[]) => a.reduce<Record<string, number>>((m, x) => ((m[x.type] = (m[x.type] ?? 0) + 1), m), {})

describe('4(d) no duplicate annotations', () => {
  const edited = FIX('chandana-report-edited-annotated.pdf')

  it('the problem file really has the duplicates', async () => {
    const c = count(await annots(edited))
    console.info('BEFORE (file as given):', JSON.stringify(c))
    expect(c.Underline).toBe(3)
    expect(c.StrikeOut).toBe(3)
  })

  it('exporting it removes exact duplicates (same type + rectangle + color) and keeps everything else', async () => {
    const stats = { skippedDuplicateObjects: 0, removedDuplicateAnnotations: 0 }
    const out = await exportEdited(edited, doc([]), { stats }, deps)
    const list = await annots(out)
    console.info('AFTER export:', JSON.stringify(count(list)), JSON.stringify(stats))
    const keys = list.filter((a) => a.type !== 'Widget').map((a) => `${a.type}|${a.rect}`)
    expect(new Set(keys).size).toBe(keys.length) // no two identical
    expect(count(list).Underline).toBe(1)
    expect(count(list).StrikeOut).toBe(2) // the two strike-outs with different rectangles both stay
    expect(count(list).Link).toBe(1)
    expect(count(list).Widget).toBe(4) // form fields are never touched
    expect(stats.removedDuplicateAnnotations).toBe(3)
  })

  it('exporting again does not re-apply or stack anything (idempotent)', async () => {
    const once = await exportEdited(edited, doc([]), {}, deps)
    const twice = await exportEdited(once, doc([]), {}, deps)
    expect(await annots(twice)).toEqual(await annots(once))
  })

  it('three identical underlines created in the editor become ONE annotation', async () => {
    const orig = FIX('chandana-report.pdf')
    const box = { x: 237, y: 60, w: 123, h: 24 }
    const u = () => makeMark('underline', 0, box, '#dc2626')
    const stats = { skippedDuplicateObjects: 0, removedDuplicateAnnotations: 0 }
    const out = await exportEdited(orig, doc([u(), u(), u(), makeMark('strike', 0, box, '#dc2626'), makeMark('strike', 0, box, '#dc2626')]), { stats }, deps)
    const c = count(await annots(out))
    console.info('3 underlines + 2 strike-outs in the editor ->', JSON.stringify(c), JSON.stringify(stats))
    expect(c.Underline).toBe(1)
    expect(c.StrikeOut).toBe(1)
  })

  it('re-exporting a file that already has the underline, with the same underline in the editor, adds nothing', async () => {
    const orig = FIX('chandana-report.pdf')
    const box = { x: 237, y: 60, w: 123, h: 24 }
    const first = await exportEdited(orig, doc([makeMark('underline', 0, box, '#dc2626')]), {}, deps)
    const second = await exportEdited(first, doc([makeMark('underline', 0, box, '#dc2626')]), {}, deps)
    expect(count(await annots(second)).Underline).toBe(1)
  })

  it('the editor state itself refuses to add the same mark twice', () => {
    const box = { x: 10, y: 10, w: 50, h: 12 }
    let s = initialState()
    s = reducer(s, { type: 'add', objects: [makeMark('highlight', 0, box, '#fde047')] })
    s = reducer(s, { type: 'add', objects: [makeMark('highlight', 0, box, '#fde047')] })
    s = reducer(s, { type: 'add', objects: [makeMark('highlight', 0, { ...box, x: 11 }, '#fde047')] }) // 1pt away: a different mark
    s = reducer(s, { type: 'add', objects: [makeMark('highlight', 0, box, '#22c55e')] }) // other color: a different mark
    expect(s.present.objects).toHaveLength(3)
    expect(dedupeObjects([makeMark('underline', 0, box, '#000000'), makeMark('underline', 0, box, '#000000')])).toHaveLength(1)
  })
})
