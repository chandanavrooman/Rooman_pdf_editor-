import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { exportEdited } from './export'
import { makeField } from './objects'
import { loadNotoFromDisk } from '@/test/nodeRender'
import type { EditorDoc, EditorObject } from './types'

const FIX = (n: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../tests/fixtures/${n}`, import.meta.url))))
const STD = fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).split(String.fromCharCode(92)).join('/')
const OUT = process.env.OPS_OUT
const doc = (objects: EditorObject[]): EditorDoc => ({ objects, formValues: {}, assets: {} })
const deps = { loadFontBytes: loadNotoFromDisk }

/** dark pixels inside a PDF-space rectangle after pdf.js paints the widget APPEARANCE STREAMS (annotationMode ENABLE) */
async function inkIn(bytes: Uint8Array, rect: number[], inset = 2): Promise<number> {
  const d = await pdfjs.getDocument({ data: bytes.slice(0), standardFontDataUrl: STD, verbosity: 0, useSystemFonts: false }).promise
  const page = await d.getPage(1)
  const S = 6
  const vp = page.getViewport({ scale: S })
  const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  await page.render({ canvasContext: ctx as never, canvas: c as never, viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise
  const [x0, y0, x1, y1] = rect
  const H = page.view[3]
  const data = ctx.getImageData(Math.floor((x0 + inset) * S), Math.floor((H - y1 + inset) * S), Math.ceil((x1 - x0 - 2 * inset) * S), Math.ceil((y1 - y0 - 2 * inset) * S)).data
  let dark = 0
  for (let i = 0; i < data.length; i += 4) if (data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90) dark++
  if (OUT) writeFileSync(`${OUT}/cb-${Math.round(x0)}-${Math.round(y0)}.png`, c.toBuffer('image/png'))
  await d.loadingTask.destroy()
  return dark
}
const widget = (pdf: PDFDocument, name: string) => {
  const cb = pdf.getForm().getCheckBox(name)
  const w = cb.acroField.getWidgets()[0]
  const r = w.getRectangle()
  const ap = w.dict.lookup(PDFName.of('AP')) as PDFDict
  const n = ap.lookup(PDFName.of('N')) as PDFDict
  return { cb, rect: [r.x, r.y, r.x + r.width, r.y + r.height], w: r.width, h: r.height, states: n.keys().map((k) => k.decodeText()), widget: w }
}

describe('4 checkbox: a real AcroForm field, square, with an appearance stream', () => {
  const src = FIX('three-pages.pdf')

  it('exports real checkbox fields: equal width and height, on/off appearance, checked by default works', async () => {
    const a = makeField('checkbox', 0, { x: 80, y: 100, w: 16, h: 16 }, 'agree') // default size, unchecked
    const b = makeField('checkbox', 0, { x: 140, y: 100, w: 24, h: 24 }, 'newsletter')
    b.value = true // checked by default
    const c = makeField('checkbox', 0, { x: 200, y: 100, w: 30, h: 16 }, 'rect') // not square: must come out square
    const out = await exportEdited(src, doc([a, b, c]), {}, deps)
    if (OUT) writeFileSync(OUT + '/checkboxes.pdf', out)
    const pdf = await PDFDocument.load(out)
    const form = pdf.getForm()
    console.info('AcroForm fields:', form.getFields().map((f) => `${f.getName()} (${f.constructor.name})`).join(', '))
    const A = widget(pdf, 'agree')
    const B = widget(pdf, 'newsletter')
    const C = widget(pdf, 'rect')
    for (const [n, w] of [['agree', A], ['newsletter', B], ['rect', C]] as const) console.info(`${n.padEnd(11)} box ${w.w.toFixed(2)} × ${w.h.toFixed(2)} pt   appearance states: [${w.states.join(', ')}]   checked: ${w.cb.isChecked()}`)
    expect(form.getFields().every((f) => f instanceof PDFCheckBox)).toBe(true)
    expect(A.w).toBe(16)
    expect(A.h).toBe(16)
    expect(B.w).toBe(24)
    expect(B.h).toBe(24)
    expect(C.w).toBeCloseTo(C.h, 5) // a 30×16 request becomes a square
    for (const w of [A, B, C]) {
      expect(w.states).toContain('Off')
      expect(w.states.length).toBe(2) // Off + the on-state: this is what lets a viewer show / hide the tick
    }
    expect(A.cb.isChecked()).toBe(false)
    expect(B.cb.isChecked()).toBe(true)
  })

  it('the tick really is drawn: checked box has ink, unchecked box has none (pdf.js paints the appearance streams)', async () => {
    const a = makeField('checkbox', 0, { x: 80, y: 100, w: 16, h: 16 }, 'agree')
    const b = makeField('checkbox', 0, { x: 140, y: 100, w: 16, h: 16 }, 'newsletter')
    b.value = true
    const out = await exportEdited(src, doc([a, b]), {}, deps)
    const pdf = await PDFDocument.load(out)
    const inkOff = await inkIn(out, widget(pdf, 'agree').rect)
    const inkOn = await inkIn(out, widget(pdf, 'newsletter').rect)
    console.info(`dark pixels inside the 16pt box: unchecked ${inkOff}, checked-by-default ${inkOn}`)
    expect(inkOff).toBe(0)
    expect(inkOn).toBeGreaterThan(150)
  })

  it('a reader can tick it: switching /V and /AS (what a viewer does on click) shows the tick, and back', async () => {
    const out = await exportEdited(src, doc([makeField('checkbox', 0, { x: 80, y: 100, w: 16, h: 16 }, 'agree')]), {}, deps)
    const pdf = await PDFDocument.load(out)
    const w = widget(pdf, 'agree')
    const onName = w.states.find((s) => s !== 'Off')!
    const field = w.cb.acroField.dict
    field.set(PDFName.of('V'), PDFName.of(onName))
    w.widget.dict.set(PDFName.of('AS'), PDFName.of(onName))
    const ticked = await pdf.save()
    const inkTicked = await inkIn(ticked, w.rect)
    const pdf2 = await PDFDocument.load(ticked)
    const w2 = widget(pdf2, 'agree')
    w2.cb.acroField.dict.set(PDFName.of('V'), PDFName.of('Off'))
    w2.widget.dict.set(PDFName.of('AS'), PDFName.of('Off'))
    const inkUnticked = await inkIn(await pdf2.save(), w.rect)
    console.info(`on-state name "${onName}": ink after ticking ${inkTicked}, after unticking ${inkUnticked}`)
    expect(inkTicked).toBeGreaterThan(150)
    expect(inkUnticked).toBe(0)
  })

  it('works on a rotated page', async () => {
    const d = await PDFDocument.load(src)
    d.getPage(0).setRotation({ type: 'degrees' as never, angle: 90 } as never)
    const rot = await d.save()
    const out = await exportEdited(rot, doc([makeField('checkbox', 0, { x: 80, y: 100, w: 16, h: 16 }, 'agree')]), {}, deps)
    const w = widget(await PDFDocument.load(out), 'agree')
    console.info(`rotated page: box ${w.w.toFixed(2)} × ${w.h.toFixed(2)}`)
    expect(w.w).toBeCloseTo(16, 2)
    expect(w.h).toBeCloseTo(16, 2)
  })

  it('field widgets are listed in the page /Annots as Widget annotations', async () => {
    const out = await exportEdited(src, doc([makeField('checkbox', 0, { x: 80, y: 100, w: 16, h: 16 }, 'agree')]), {}, deps)
    const pdf = await PDFDocument.load(out)
    const an = pdf.getPage(0).node.lookup(PDFName.of('Annots')) as PDFArray
    expect(an.size()).toBe(1)
    expect(((an.lookup(0) as PDFDict).lookup(PDFName.of('Subtype')) as PDFName).decodeText()).toBe('Widget')
  })
})
