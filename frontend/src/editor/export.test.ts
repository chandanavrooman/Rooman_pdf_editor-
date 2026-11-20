import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFString, decodePDFRawStream, StandardFonts, degrees, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from 'pdf-lib'
import { exportEdited } from './export'
import { detectFields } from './forms'
import { geometryFromBoxes, psToPdf, pdfToPs, pageGeometry } from './geometry'
import { makeDraw, makeField, makeImage, makeLine, makeLink, makeMark, makeShape, makeText, makeWhiteout, DEFAULTS } from './objects'
import type { EditorDoc, EditorObject } from './types'
import { pageItems, pageTexts, openWithPdfjs } from '@/test/pdfText'
import { darkPixelsIn, diffOutside, loadNotoFromDisk, renderPixels } from '@/test/nodeRender'
import { createCanvas } from '@napi-rs/canvas'

const deps = { loadFontBytes: loadNotoFromDisk }
const doc = (objects: EditorObject[], extra: Partial<EditorDoc> = {}): EditorDoc => ({ objects, formValues: {}, assets: {}, ...extra })

async function makePdf(pages: string[], opts: { rotate?: number[]; size?: [number, number]; cropbox?: [number, number, number, number] } = {}) {
  const d = await PDFDocument.create()
  const font = await d.embedFont(StandardFonts.Helvetica)
  pages.forEach((t, i) => {
    const p = d.addPage(opts.size ?? [595, 842])
    p.drawText(t, { x: 60, y: p.getHeight() - 100, size: 24, font })
    p.drawText('static footer text', { x: 60, y: 40, size: 10, font })
    if (opts.rotate?.[i]) p.setRotation(degrees(opts.rotate[i]))
    if (opts.cropbox) p.setCropBox(...opts.cropbox)
  })
  return d.save()
}

function pngBytes(w = 40, h = 20, color = '#ff0000') {
  const c = createCanvas(w, h)
  const x = c.getContext('2d')
  x.fillStyle = color
  x.fillRect(0, 0, w, h)
  return new Uint8Array(c.toBuffer('image/png'))
}

describe('geometry vs pdf.js viewport', () => {
  it.each([0, 90, 180, 270])('psToPdf / pdfToPs match pdf.js for /Rotate %i with an offset cropbox', async (rot) => {
    const bytes = await makePdf(['x'], { rotate: [rot], cropbox: [20, 30, 400, 700] })
    const pdfDoc = await PDFDocument.load(bytes)
    const g = pageGeometry(pdfDoc.getPage(0))
    const js = await openWithPdfjs(bytes)
    const page = await js.getPage(1)
    const vp = page.getViewport({ scale: 1 })
    expect(g.width).toBeCloseTo(vp.width, 3)
    expect(g.height).toBeCloseTo(vp.height, 3)
    for (const ps of [{ x: 0, y: 0 }, { x: 33, y: 71 }, { x: g.width, y: g.height }]) {
      const pdf = psToPdf(g, ps)
      const ref = vp.convertToPdfPoint(ps.x, ps.y)
      expect(pdf.x).toBeCloseTo(ref[0], 3)
      expect(pdf.y).toBeCloseTo(ref[1], 3)
      const back = pdfToPs(g, pdf)
      expect(back.x).toBeCloseTo(ps.x, 3)
      expect(back.y).toBeCloseTo(ps.y, 3)
    }
    await js.loadingTask.destroy()
  })
  it('geometryFromBoxes ignores a crop box outside the media box', () => {
    const g = geometryFromBoxes({ x: 0, y: 0, w: 100, h: 200 }, { x: 500, y: 500, w: 10, h: 10 }, 0)
    expect(g.width).toBe(100)
    expect(g.height).toBe(200)
  })
})

describe('exportEdited: empty text boxes', () => {
  it('three empty text boxes export nothing: no placeholder text, pixel-identical page', async () => {
    const bytes = await makePdf(['one'])
    const empties = [makeText(0, { x: 80, y: 200 }, DEFAULTS.text), makeText(0, { x: 200, y: 400 }, DEFAULTS.text), makeText(0, { x: 150, y: 600 }, DEFAULTS.text)]
    for (const e of empties) expect(e.text).toBe('')
    const out = await exportEdited(bytes, doc(empties))
    const texts = (await pageTexts(out))[0]
    expect(texts).not.toMatch(/type your text/i)
    expect(texts).toBe((await pageTexts(bytes))[0])
    expect(diffOutside(await renderPixels(bytes, 0), await renderPixels(out, 0), 1, [])).toBe(0)
  })
})

describe('exportEdited: no edits', () => {
  it('keeps page count and renders pixel-identical when there are no edits', async () => {
    const bytes = await makePdf(['one', 'two', 'three'])
    const out = await exportEdited(bytes, doc([]))
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3)
    for (let i = 0; i < 3; i++) expect(diffOutside(await renderPixels(bytes, i), await renderPixels(out, i), 1, [])).toBe(0)
  })
})

describe('exportEdited: annotations and drawings', () => {
  it('text is real, extractable text at the right place; original page stays pixel-identical elsewhere', async () => {
    const bytes = await makePdf(['Original heading'])
    const t = makeText(0, { x: 100, y: 300 }, { ...DEFAULTS.text, size: 20 }, 'Hello EditorWorld')
    const out = await exportEdited(bytes, doc([t]))
    const texts = await pageTexts(out)
    expect(texts[0]).toContain('Original heading')
    expect(texts[0]).toContain('Hello EditorWorld')
    const { items } = await pageItems(out, 1)
    const hit = items.find((i) => i.str.includes('Hello'))!
    expect(hit.x).toBeCloseTo(100, 0)
    // baseline = y + 0.9465 * size
    expect(hit.y).toBeCloseTo(300 + 20 * 0.9465, 0)
    const before = await renderPixels(bytes, 0)
    const after = await renderPixels(out, 0)
    expect(diffOutside(before, after, 1, [{ x: t.x, y: t.y, w: t.w, h: t.h }])).toBe(0)
  })

  it('keeps the ORIGINAL content streams byte-for-byte and appends the edits after them', async () => {
    const bytes = await makePdf(['Keep me'])
    const before = await PDFDocument.load(bytes)
    const orig = collectContent(before)
    const out = await exportEdited(bytes, doc([makeShape('rect', 0, { x: 50, y: 50, w: 100, h: 60 }, DEFAULTS.shape)]))
    const after = await PDFDocument.load(out)
    const now = collectContent(after)
    expect(now.length).toBe(orig.length + 3) // q, Q, edits
    expect(now[0].trim()).toBe('q')
    orig.forEach((s, i) => expect(now[i + 1]).toBe(s))
    expect(now[orig.length + 1].trim()).toBe('Q')
    expect(now[now.length - 1]).toContain('1 0 0 -1 0 842 cm') // our page-space matrix
  })

  it('draws every shape / ink / whiteout / image without touching the rest of the page', async () => {
    const bytes = await makePdf(['Shapes page'])
    const objs: EditorObject[] = [
      makeShape('rect', 0, { x: 40, y: 200, w: 120, h: 50 }, { stroke: '#ff0000', strokeWidth: 3, fill: '#ffff00' }),
      makeShape('ellipse', 0, { x: 200, y: 200, w: 120, h: 50 }, { stroke: '#0000ff', strokeWidth: 2, fill: null }),
      makeLine('line', 0, { x: 40, y: 300 }, { x: 200, y: 340 }, DEFAULTS.line),
      makeLine('arrow', 0, { x: 240, y: 300 }, { x: 400, y: 340 }, DEFAULTS.line),
      makeDraw(0, [{ x: 40, y: 400 }, { x: 60, y: 380 }, { x: 90, y: 420 }, { x: 140, y: 390 }, { x: 180, y: 410 }], DEFAULTS.draw),
      makeWhiteout(0, { x: 55, y: 90, w: 240, h: 40 }, '#ffffff'),
      makeImage('image', 0, { x: 300, y: 450, w: 80, h: 40 }, 'a1'),
    ]
    const out = await exportEdited(bytes, doc(objs, { assets: { a1: { bytes: pngBytes(), mime: 'image/png' } } }))
    const px = await renderPixels(out, 0)
    // filled rect is yellow inside
    const at = (x: number, y: number) => [px.data[(y * px.width + x) * 4], px.data[(y * px.width + x) * 4 + 1], px.data[(y * px.width + x) * 4 + 2]]
    expect(at(100, 225)).toEqual([255, 255, 0])
    expect(at(340, 470)).toEqual([255, 0, 0]) // image
    // whiteout hid the original heading
    const dark = darkPixelsIn(px, 1, { x: 60, y: 95, w: 200, h: 30 })
    expect(dark.dark).toBe(0)
    // outside all object boxes nothing changed
    const base = await renderPixels(bytes, 0)
    const boxes = objs.map((o) => ({ x: o.x - 4, y: o.y - 4, w: o.w + 8, h: o.h + 8 }))
    expect(diffOutside(base, px, 1, boxes)).toBe(0)
  })

  it('writes real Highlight / Underline / StrikeOut annotations with QuadPoints and appearance streams', async () => {
    const bytes = await makePdf(['Mark this text'])
    const objs = [
      makeMark('highlight', 0, { x: 60, y: 100, w: 120, h: 28 }, '#fde047'),
      makeMark('underline', 0, { x: 60, y: 140, w: 120, h: 28 }, '#dc2626'),
      makeMark('strike', 0, { x: 60, y: 180, w: 120, h: 28 }, '#dc2626'),
    ]
    const out = await exportEdited(bytes, doc(objs))
    const d = await PDFDocument.load(out)
    const annots = d.getPage(0).node.Annots()!
    const subtypes: string[] = []
    for (let i = 0; i < annots.size(); i++) {
      const a = d.context.lookup(annots.get(i), PDFDict)
      subtypes.push((a.get(PDFName.of('Subtype')) as PDFName).decodeText())
      expect((a.get(PDFName.of('QuadPoints')) as PDFArray).size()).toBe(8)
      expect(a.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))).toBeInstanceOf(PDFRef)
    }
    expect(subtypes).toEqual(['Highlight', 'Underline', 'StrikeOut'])
    // pdf.js paints the highlight (yellow behind text, multiply)
    const px = await renderPixels(out, 0)
    const i = (115 * px.width + 70) * 4
    expect([px.data[i], px.data[i + 1], px.data[i + 2]]).toEqual([253, 224, 71])
  })

  it('link annotations carry the right URI and rectangle; internal links point at the page', async () => {
    const bytes = await makePdf(['p1', 'p2'])
    const out = await exportEdited(bytes, doc([makeLink(0, { x: 100, y: 200, w: 150, h: 20 }, { kind: 'url', url: 'https://example.com/a?b=1&c=2' }), makeLink(0, { x: 100, y: 300, w: 80, h: 20 }, { kind: 'page', page: 1 })]))
    const d = await PDFDocument.load(out)
    const annots = d.getPage(0).node.Annots()!
    const a0 = d.context.lookup(annots.get(0), PDFDict)
    expect(a0.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString).decodeText()).toBe('https://example.com/a?b=1&c=2')
    const rect = (a0.lookup(PDFName.of('Rect'), PDFArray).asArray() as unknown as { asNumber(): number }[]).map((x) => x.asNumber())
    expect(rect).toEqual([100, 842 - 220, 250, 842 - 200])
    const a1 = d.context.lookup(annots.get(1), PDFDict)
    const dest = a1.lookup(PDFName.of('Dest'), PDFArray)
    expect(dest.get(0)).toBe(d.getPage(1).ref)
    // pdf.js sees both as links
    const js = await openWithPdfjs(out)
    const ann = await (await js.getPage(1)).getAnnotations()
    expect(ann.filter((a) => a.subtype === 'Link').length).toBe(2)
    expect(ann.find((a) => a.url)?.url).toContain('https://example.com/a')
    await js.loadingTask.destroy()
  })

  it('handles rotated pages and crop-box offsets: text is upright and positioned where the user placed it', async () => {
    for (const rot of [90, 180, 270]) {
      const bytes = await makePdf(['Rotated page'], { rotate: [rot], cropbox: [10, 20, 500, 760] })
      const t = makeText(0, { x: 120, y: 150 }, { ...DEFAULTS.text, size: 18 }, 'PLACED')
      const r = makeShape('rect', 0, { x: 200, y: 300, w: 100, h: 40 }, { stroke: null, strokeWidth: 0, fill: '#00ff00' })
      const out = await exportEdited(bytes, doc([t, r]))
      const { items } = await pageItems(out, 1)
      const hit = items.find((i) => i.str === 'PLACED')!
      expect(hit.x).toBeCloseTo(120, 0)
      expect(hit.y).toBeCloseTo(150 + 18 * 0.9465, 0)
      const px = await renderPixels(out, 0)
      const i = (320 * px.width + 250) * 4
      expect([px.data[i], px.data[i + 1], px.data[i + 2]]).toEqual([0, 255, 0])
      const base = await renderPixels(bytes, 0)
      expect(diffOutside(base, px, 1, [{ x: t.x, y: t.y, w: 120, h: t.h }, r], 3)).toBe(0)
    }
  })

  it('Unicode text (Cyrillic, Greek, accents) is embedded with the bundled Noto Sans and does not throw', async () => {
    const bytes = await makePdf(['x'])
    const t = makeText(0, { x: 80, y: 300 }, DEFAULTS.text, 'Привет мир Ελληνικά ąę € — “quotes”')
    const out = await exportEdited(bytes, doc([t]), {}, deps)
    expect((await pageTexts(out))[0]).toContain('Привет мир')
    expect((await pageTexts(out))[0]).toContain('Ελληνικά')
  })

  it('reports a clear error for characters no bundled font can draw', async () => {
    const bytes = await makePdf(['x'])
    const t = makeText(0, { x: 80, y: 300 }, DEFAULTS.text, '日本語')
    await expect(exportEdited(bytes, doc([t]), {}, deps)).rejects.toThrow(/not available/)
  })

  it('wraps fixed-width text and honours alignment', async () => {
    const bytes = await makePdf(['x'])
    const t = { ...makeText(0, { x: 100, y: 300 }, { ...DEFAULTS.text, size: 14 }, 'alpha beta gamma delta epsilon zeta eta theta', 120), autoWidth: false, w: 120 }
    const out = await exportEdited(bytes, doc([t]))
    const { items } = await pageItems(out, 1)
    const ys = new Set(items.filter((i) => /alpha|beta|gamma|delta|epsilon|zeta|eta|theta/.test(i.str)).map((i) => Math.round(i.y)))
    expect(ys.size).toBeGreaterThan(2)
  })
})

describe('forms', () => {
  async function makeForm() {
    const d = await PDFDocument.create()
    const p = d.addPage([595, 842])
    const form = d.getForm()
    const name = form.createTextField('person.name')
    name.addToPage(p, { x: 50, y: 700, width: 200, height: 24 })
    const agree = form.createCheckBox('agree')
    agree.addToPage(p, { x: 50, y: 650, width: 18, height: 18 })
    const color = form.createRadioGroup('color')
    color.addOptionToPage('red', p, { x: 50, y: 600, width: 16, height: 16 })
    color.addOptionToPage('blue', p, { x: 90, y: 600, width: 16, height: 16 })
    const country = form.createDropdown('country')
    country.addOptions(['India', 'France', 'Peru'])
    country.addToPage(p, { x: 50, y: 550, width: 150, height: 22 })
    return d.save()
  }

  it('detects existing AcroForm fields with their widget rectangles in page space', async () => {
    const fields = detectFields(await PDFDocument.load(await makeForm()))
    expect(fields.map((f) => `${f.name}:${f.kind}`)).toEqual(['person.name:text', 'agree:checkbox', 'color:radio', 'country:dropdown'])
    const name = fields[0].widgets[0]
    expect(name.page).toBe(0)
    expectRect(name.rect, { x: 50, y: 842 - 724, w: 200, h: 24 })
    expect(fields[2].widgets.length).toBe(2)
    expect(fields[2].options).toEqual(['red', 'blue'])
    expect(fields[3].options).toEqual(['India', 'France', 'Peru'])
  })

  it('fills existing fields and the values read back; text shows on the render', async () => {
    const bytes = await makeForm()
    const out = await exportEdited(bytes, doc([], { formValues: { 'person.name': 'Ada Lovelace', agree: true, color: 'blue', country: 'France' } }))
    const d = await PDFDocument.load(out)
    const form = d.getForm()
    expect((form.getField('person.name') as PDFTextField).getText()).toBe('Ada Lovelace')
    expect((form.getField('agree') as PDFCheckBox).isChecked()).toBe(true)
    expect((form.getField('color') as PDFRadioGroup).getSelected()).toBe('blue')
    expect((form.getField('country') as PDFDropdown).getSelected()).toEqual(['France'])
    const js = await openWithPdfjs(out)
    const ann = await (await js.getPage(1)).getAnnotations()
    expect(ann.find((a) => a.fieldName === 'person.name')?.fieldValue).toBe('Ada Lovelace')
    await js.loadingTask.destroy()
  })

  it('flatten option makes the filled values permanent (no fields left)', async () => {
    const out = await exportEdited(await makeForm(), doc([], { formValues: { 'person.name': 'Flat Value' } }), { flattenForm: true })
    expect((await PDFDocument.load(out)).getForm().getFields().length).toBe(0)
    expect((await pageTexts(out))[0]).toContain('Flat Value')
  })

  it('creates real fillable AcroForm fields from the editor (text, checkbox, radio group, dropdown)', async () => {
    const bytes = await makePdf(['Form page'])
    const t = { ...makeField('text', 0, { x: 50, y: 200, w: 200, h: 24 }, 'first'), value: 'preset' }
    const c = { ...makeField('checkbox', 0, { x: 50, y: 250, w: 18, h: 18 }, 'ok'), value: true }
    const r1 = { ...makeField('radio', 0, { x: 50, y: 300, w: 16, h: 16 }, 'size'), options: ['small'] }
    const r2 = { ...makeField('radio', 0, { x: 120, y: 300, w: 16, h: 16 }, 'size'), options: ['large'], value: true as const }
    const dd = { ...makeField('dropdown', 0, { x: 50, y: 350, w: 150, h: 22 }, 'pick'), options: ['A', 'B'], value: 'B' }
    const out = await exportEdited(bytes, doc([t, c, r1, r2, dd]))
    const form = (await PDFDocument.load(out)).getForm()
    expect(form.getFields().map((f) => f.getName()).sort()).toEqual(['first', 'ok', 'pick', 'size'])
    expect((form.getField('first') as PDFTextField).getText()).toBe('preset')
    expect((form.getField('ok') as PDFCheckBox).isChecked()).toBe(true)
    expect((form.getField('size') as PDFRadioGroup).getOptions()).toEqual(['small', 'large'])
    expect((form.getField('size') as PDFRadioGroup).getSelected()).toBe('large')
    expect((form.getField('pick') as PDFDropdown).getSelected()).toEqual(['B'])
    // and the new fields can be read back as fields by the detector, on the right page spot
    const det = detectFields(await PDFDocument.load(out))
    expectRect(det.find((f) => f.name === 'first')!.widgets[0].rect, { x: 50, y: 200, w: 200, h: 24 })
  })

  it('field name clashes get a unique suffix instead of throwing', async () => {
    const out = await exportEdited(await makeForm(), doc([makeField('text', 0, { x: 300, y: 100, w: 100, h: 20 }, 'agree')]))
    const names = (await PDFDocument.load(out)).getForm().getFields().map((f) => f.getName())
    expect(names).toContain('agree_2')
  })
})

function collectContent(d: PDFDocument): string[] {
  const node = d.getPage(0).node
  const c = node.get(PDFName.of('Contents'))
  const refs: PDFRef[] = c instanceof PDFRef ? [c] : ((c as PDFArray).asArray() as PDFRef[])
  return refs.map((r) => {
    const s = d.context.lookup(r)
    return Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')
  })
}

function expectRect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  // pdf-lib grows widget rectangles by half the border width
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(1)
}

void rgb
