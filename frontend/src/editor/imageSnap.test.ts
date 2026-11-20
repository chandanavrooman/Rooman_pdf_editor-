import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFOperator, degrees, rgb, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { pageImageRects } from './imageSnap'

function png(w: number, h: number, color: string, alpha = false): Uint8Array {
  const c = createCanvas(w, h)
  const x = c.getContext('2d')
  if (!alpha) {
    x.fillStyle = color
    x.fillRect(0, 0, w, h)
  } else {
    x.fillStyle = 'rgba(220,38,38,0.5)'
    x.beginPath()
    x.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, Math.PI * 2)
    x.fill()
  }
  x.fillStyle = '#fff'
  x.fillRect(4, 4, w / 4, h / 4)
  return new Uint8Array(c.toBuffer('image/png'))
}

async function rects(bytes: Uint8Array, page = 0) {
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise
  return pageImageRects(doc as never, page)
}
const near = (a: number, b: number, tol = 1.5) => Math.abs(a - b) <= tol

describe('pictures of ANY pdf are found where they are drawn', () => {
  it('a plain picture, a transparent PNG and a text line around them', async () => {
    const d = await PDFDocument.create()
    const p = d.addPage([400, 600])
    const f = await d.embedFont(StandardFonts.Helvetica)
    p.drawText('caption', { x: 40, y: 560, size: 12, font: f })
    p.drawImage(await d.embedPng(png(200, 100, '#16a34a')), { x: 50, y: 400, width: 200, height: 100 })
    p.drawImage(await d.embedPng(png(120, 120, '#000', true)), { x: 250, y: 100, width: 100, height: 100 })
    const r = await rects(await d.save())
    expect(r).toHaveLength(2)
    // page space is top-left origin: y = 600 - (bottom + height)
    const a = r.find((x) => near(x.w, 200))!
    expect([a.x, a.y, a.w, a.h].map(Math.round)).toEqual([50, 100, 200, 100])
    expect(a.upright).toBe(true)
    const b = r.find((x) => near(x.w, 100))!
    expect([b.x, b.y].map(Math.round)).toEqual([250, 400])
  })

  it('a picture inside a form XObject that has its own matrix (Word, Canva, Chrome exports)', async () => {
    const d = await PDFDocument.create()
    const p = d.addPage([400, 600])
    const img = await d.embedPng(png(160, 80, '#2563eb'))
    // /Fm1 draws the picture 160 x 80 at (0,0) of the form; the form is placed 100 right and 300 up by its own Matrix
    const form = d.context.stream('q 160 0 0 80 0 0 cm /Im1 Do Q', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 400, 600], Matrix: [1, 0, 0, 1, 100, 300],
      Resources: { XObject: { Im1: img.ref } },
    })
    const formRef = d.context.register(form)
    p.node.set(PDFName.of('Resources'), d.context.obj({ XObject: { Fm1: formRef } }))
    p.pushOperators(PDFOperator.of('Do' as never, [PDFName.of('Fm1')]))
    const r = await rects(await d.save())
    expect(r).toHaveLength(1)
    expect([r[0].x, r[0].y, r[0].w, r[0].h].map(Math.round)).toEqual([100, 220, 160, 80]) // 600 - (300 + 80)
  })

  it('a page with /Rotate: the picture is found where the viewer shows it, and is marked not upright when it is turned', async () => {
    const d = await PDFDocument.create()
    const p = d.addPage([400, 600])
    p.drawImage(await d.embedPng(png(200, 100, '#dc2626')), { x: 50, y: 400, width: 200, height: 100 })
    p.setRotation(degrees(90))
    const r = await rects(await d.save())
    expect(r).toHaveLength(1)
    // seen after turning the page 90 degrees clockwise: 600 wide, 400 high
    expect(near(r[0].w, 100) && near(r[0].h, 200)).toBe(true)
    expect(r[0].upright).toBe(false) // its pixels are turned on the page: the editor falls back to a crop of what is shown
  })

  it('skips tiny marks and a page-sized background, keeps several real pictures', async () => {
    const d = await PDFDocument.create()
    const p = d.addPage([400, 600])
    p.drawImage(await d.embedPng(png(400, 600, '#f8fafc')), { x: 0, y: 0, width: 400, height: 600 }) // background
    p.drawImage(await d.embedPng(png(10, 10, '#000')), { x: 20, y: 20, width: 10, height: 10 }) // bullet
    p.drawImage(await d.embedPng(png(300, 200, '#0ea5e9')), { x: 40, y: 300, width: 150, height: 100 })
    p.drawImage(await d.embedPng(png(300, 200, '#f59e0b')), { x: 220, y: 300, width: 150, height: 100 })
    p.drawRectangle({ x: 10, y: 10, width: 5, height: 5, color: rgb(0, 0, 0) })
    const r = await rects(await d.save())
    expect(r.map((x) => Math.round(x.x)).sort((a, b) => a - b)).toEqual([40, 220])
  })
})
