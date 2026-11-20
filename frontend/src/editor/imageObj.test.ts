import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'
import { exportEdited } from './export'
import { hitTest, rotateAbout } from './geometry'
import { makeImage } from './objects'
import { svgSize } from './signature'
import type { EditorDoc, ImageObj } from './types'
import { renderPixels } from '@/test/nodeRender'


async function blankPdf() {
  const d = await PDFDocument.create()
  const font = await d.embedFont(StandardFonts.Helvetica)
  const p = d.addPage([595, 842])
  p.drawText('page', { x: 60, y: 760, size: 12, font })
  return d.save()
}

/** left half red, right half blue */
function twoColorPng(w = 100, h = 20) {
  const c = createCanvas(w, h)
  const x = c.getContext('2d')
  x.fillStyle = '#ff0000'
  x.fillRect(0, 0, w / 2, h)
  x.fillStyle = '#0000ff'
  x.fillRect(w / 2, 0, w / 2, h)
  return new Uint8Array(c.toBuffer('image/png'))
}

const doc = (objects: ImageObj[]): EditorDoc => ({ objects, formValues: {}, assets: { a1: { bytes: twoColorPng(), mime: 'image/png' } } })

async function exported(o: ImageObj) {
  const px = await renderPixels(await exportEdited(await blankPdf(), doc([o])), 0)
  return (x: number, y: number) => [px.data[(y * px.width + x) * 4], px.data[(y * px.width + x) * 4 + 1], px.data[(y * px.width + x) * 4 + 2]]
}

const near = (a: number[], b: number[], tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

describe('image objects: rotation, opacity, hit testing', () => {
  const base = makeImage('image', 0, { x: 150, y: 290, w: 100, h: 20 }, 'a1') // centre (200, 300)

  it('unrotated image: red on the left, blue on the right', async () => {
    const at = await exported(base)
    expect(near(at(170, 300), [255, 0, 0])).toBe(true)
    expect(near(at(230, 300), [0, 0, 255])).toBe(true)
    expect(near(at(200, 340), [255, 255, 255])).toBe(true)
  })

  it('rotated 90 degrees clockwise about its centre: red goes to the top, blue to the bottom', async () => {
    const at = await exported({ ...base, rotation: 90 })
    expect(near(at(200, 260), [255, 0, 0])).toBe(true) // 40 above the centre
    expect(near(at(200, 340), [0, 0, 255])).toBe(true) // 40 below
    expect(near(at(240, 300), [255, 255, 255])).toBe(true) // the old right end is empty now
  })

  it('rotated 180 degrees: red on the right', async () => {
    const at = await exported({ ...base, rotation: 180 })
    expect(near(at(230, 300), [255, 0, 0])).toBe(true)
    expect(near(at(170, 300), [0, 0, 255])).toBe(true)
  })

  it('opacity 50% blends with the page', async () => {
    const at = await exported({ ...base, opacity: 0.5 })
    const px = at(170, 300)
    expect(px[0]).toBe(255)
    expect(px[1]).toBeGreaterThan(115)
    expect(px[1]).toBeLessThan(140)
  })

  it('hit testing follows the rotation', () => {
    const r = { ...base, rotation: 90 }
    expect(hitTest(r, { x: 200, y: 345 }, 0)).toBe(true) // inside the rotated (vertical) shape
    expect(hitTest(r, { x: 245, y: 300 }, 0)).toBe(false) // inside the UNrotated box only
    expect(hitTest(base, { x: 245, y: 300 }, 0)).toBe(true)
  })

  it('rotateAbout turns clockwise on screen (y down)', () => {
    const p = rotateAbout({ x: 10, y: 0 }, { x: 0, y: 0 }, 90)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(10)
  })
})

describe('svgSize', () => {
  it('uses width and height', () => expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"></svg>')).toEqual({ width: 120, height: 60 }))
  it('falls back to the viewBox', () => expect(svgSize('<svg viewBox="0 0 200 50"></svg>')).toEqual({ width: 200, height: 50 }))
  it('derives a missing side from the viewBox ratio', () => expect(svgSize('<svg width="100" viewBox="0 0 200 50"></svg>')).toEqual({ width: 100, height: 25 }))
  it('uses the browser default when nothing is given', () => expect(svgSize('<svg></svg>')).toEqual({ width: 300, height: 150 }))
})
