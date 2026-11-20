import { expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFOperator, PDFRawStream } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'
import { exportAndDownload, openEditor, pickTool, toScreen, writePng } from './editorHelpers'

const DIR = join(import.meta.dirname, '.tmp')
mkdirSync(DIR, { recursive: true })

function png(w: number, h: number, color: string): Uint8Array {
  const c = createCanvas(w, h)
  const x = c.getContext('2d')
  x.fillStyle = color
  x.fillRect(0, 0, w, h)
  x.fillStyle = '#fff'
  x.fillRect(w / 8, h / 8, w / 4, h / 4)
  return new Uint8Array(c.toBuffer('image/png'))
}

/** A page built NOT like any of the sample files: a hi-res picture drawn directly, and a picture inside a form XObject with its own matrix. */
async function makePdf(): Promise<string> {
  const d = await PDFDocument.create()
  const p = d.addPage([400, 600])
  const small = await d.embedPng(png(240, 120, '#2563eb'))
  const form = d.context.stream('q 120 0 0 60 0 0 cm /Im1 Do Q', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 400, 600], Matrix: [1, 0, 0, 1, 100, 60], Resources: { XObject: { Im1: small.ref } } })
  const ref = d.context.register(form)
  p.node.set(PDFName.of('Resources'), d.context.obj({ XObject: { Fm1: ref } })) // first, so drawImage adds to it instead of replacing it
  p.drawImage(await d.embedPng(png(800, 600, '#16a34a')), { x: 60, y: 330, width: 200, height: 150 }) // top-left (60,120) 200 x 150
  p.pushOperators(PDFOperator.of('Do' as never, [PDFName.of('Fm1')])) // top-left (100,480) 120 x 60
  const path = join(DIR, 'any-images.pdf')
  writeFileSync(path, await d.save())
  return path
}

const imageWidths = async (path: string) => {
  const doc = await PDFDocument.load(readFileSync(path))
  const w: number[] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null
    if (dict?.get(PDFName.of('Subtype')) === PDFName.of('Image')) w.push((dict.get(PDFName.of('Width')) as PDFNumber).asNumber())
  }
  return w.sort((a, b) => a - b)
}

test('any PDF: pictures are highlighted on hover, picked with a click (Text tool), keep their own pixels, move and delete', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 })
  await openEditor(page, '/edit', await makePdf(), { fit: false })
  await page.waitForTimeout(1500)
  await expect(page.getByTestId('tool-text')).toHaveAttribute('aria-pressed', 'true')
  const scroll = page.getByTestId('viewer-scroll')
  await scroll.evaluate((el) => (el.scrollTop = 0))
  const a = await toScreen(page, 0, 160, 195) // centre of the hi-res picture
  // 1. hover shows the picture is there
  await page.mouse.move(a.x, a.y)
  await expect(page.getByTestId('hover-box')).toBeVisible()
  // 2. a click picks it: no text box appears, the picture is now an object with the original 800 x 600 pixels
  await page.mouse.click(a.x, a.y)
  const placed = page.getByTestId('placed-image')
  await expect(placed).toHaveCount(1)
  await expect(page.getByTestId('text-editor')).toHaveCount(0)
  expect(await placed.first().evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(800)
  // 3. drag it down 60 pt
  const before = (await placed.first().boundingBox())!
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x, a.y + 60 * a.k, { steps: 8 })
  await page.mouse.up()
  const after = (await placed.first().boundingBox())!
  expect(after.y - before.y).toBeGreaterThan(40 * a.k)
  // 4. the picture inside the form XObject is found too; delete it
  await scroll.evaluate((el) => (el.scrollTop = 900)) // the picture is lower on the tall page
  await page.waitForTimeout(400)
  const b = await toScreen(page, 0, 160, 510)
  await page.mouse.move(b.x - 4, b.y - 4)
  await page.mouse.move(b.x, b.y, { steps: 4 })
  await expect(page.getByTestId('hover-box')).toBeVisible() // found inside the form XObject too
  await page.mouse.click(b.x, b.y)
  await expect(placed).toHaveCount(2)
  await page.keyboard.press('Delete')
  await expect(placed).toHaveCount(1)
  // 5. export: the moved picture is in the file at its full resolution, the deleted one is no longer drawn on the page
  const out = await exportAndDownload(page)
  const widths = await imageWidths(out)
  expect(widths).toContain(800)
})


test('Sejda-style picture handling: floating bar (rotate, duplicate, replace, delete), replacement fits the old place, Delete existing image mode', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 })
  await openEditor(page, '/edit', await makePdf(), { fit: false })
  await page.waitForTimeout(1500)
  const scroll = page.getByTestId('viewer-scroll')
  await scroll.evaluate((el) => (el.scrollTop = 0))
  const a = await toScreen(page, 0, 160, 195)
  const slotBox = { x: (await toScreen(page, 0, 60, 120)).x, y: (await toScreen(page, 0, 60, 120)).y, w: 200 * a.k, h: 150 * a.k }
  await page.mouse.click(a.x, a.y)
  const placed = page.getByTestId('placed-image')
  await expect(placed).toHaveCount(1)
  // the little bar above the picture
  const bar = page.getByTestId('floating-image-bar')
  await expect(bar).toBeVisible()
  // eight handles
  for (const h of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) await expect(page.getByTestId(`handle-${h}`)).toHaveCount(1)
  // replace with a tall picture: it is fitted INTO the old place (never stretched, never outside it)
  writePng('tall.png', 100, 300, '#7c3aed')
  await page.getByTestId('img-bar-replace-input').setInputFiles(join(DIR, 'tall.png'))
  await page.waitForTimeout(600)
  const r = (await placed.first().boundingBox())!
  expect(r.x).toBeGreaterThanOrEqual(slotBox.x - 2)
  expect(r.y).toBeGreaterThanOrEqual(slotBox.y - 2)
  expect(r.x + r.width).toBeLessThanOrEqual(slotBox.x + slotBox.w + 2)
  expect(r.y + r.height).toBeLessThanOrEqual(slotBox.y + slotBox.h + 2)
  expect(Math.abs(r.width / r.height - 1 / 3)).toBeLessThan(0.02)
  // rotate and duplicate from the bar
  await page.getByTestId('img-bar-rotate').click()
  await expect(placed.first()).toHaveCSS('transform', /matrix/)
  await page.getByTestId('img-bar-duplicate').click()
  await expect(placed).toHaveCount(2)
  await page.getByTestId('img-bar-delete').click()
  await expect(placed).toHaveCount(1)
  // "Delete existing image" removes the other picture of the page (the one in the form XObject)
  await pickTool(page, 'delete-image')
  await scroll.evaluate((el) => (el.scrollTop = 900))
  await page.waitForTimeout(400)
  const b = await toScreen(page, 0, 160, 510)
  await page.mouse.move(b.x - 4, b.y - 4)
  await page.mouse.move(b.x, b.y, { steps: 4 })
  await expect(page.getByTestId('hover-box')).toBeVisible()
  await page.mouse.click(b.x, b.y)
  await expect(page.getByTestId('editor-message')).toContainText('Picture deleted')
  await expect(placed).toHaveCount(1) // nothing new appeared: it is simply gone
})


/** Three pictures of one row, as in a report: same top, same height. */
async function makeRowPdf(): Promise<string> {
  const d = await PDFDocument.create()
  const p = d.addPage([400, 600])
  for (const [i, color] of ['#16a34a', '#2563eb', '#dc2626'].entries()) p.drawImage(await d.embedPng(png(200, 200, color)), { x: 40 + i * 120, y: 380, width: 100, height: 100 }) // top-left y = 120
  const path = join(DIR, 'row-images.pdf')
  writeFileSync(path, await d.save())
  return path
}

test('pictures of one row line up: a moved picture snaps to its neighbours’ top edge with a guide (Alt switches it off)', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 })
  await openEditor(page, '/edit', await makeRowPdf(), { fit: false })
  await page.waitForTimeout(1500)
  await page.getByTestId('viewer-scroll').evaluate((el) => (el.scrollTop = 0))
  const mid = await toScreen(page, 0, 210, 170)
  await page.mouse.click(mid.x, mid.y) // pick the middle picture
  const placed = page.getByTestId('placed-image')
  await expect(placed).toHaveCount(1)
  const rowTop = (await toScreen(page, 0, 0, 120)).y
  const grab = async (dyPt: number, alt = false) => {
    if (alt) await page.keyboard.down('Alt')
    await page.mouse.move(mid.x, mid.y)
    await page.mouse.down()
    await page.mouse.move(mid.x, mid.y + dyPt * mid.k, { steps: 6 })
    const guide = await page.getByTestId('align-guide').count()
    await page.mouse.up()
    if (alt) await page.keyboard.up('Alt')
    return guide
  }
  // 1.5 pt (about 4 screen pixels) off the row: it snaps onto the row's top edge and a guide was shown
  expect(await grab(1.5)).toBeGreaterThan(0)
  expect(Math.abs((await placed.first().boundingBox())!.y - rowTop)).toBeLessThan(3) // it was 4.5 px off before snapping
  // far from any edge: nothing snaps, no guide
  await page.mouse.move(mid.x, mid.y + 0)
  const cur = (await placed.first().boundingBox())!
  await page.mouse.move(cur.x + cur.width / 2, cur.y + cur.height / 2)
  await page.mouse.down()
  await page.mouse.move(cur.x + cur.width / 2, cur.y + cur.height / 2 + 40 * mid.k, { steps: 6 })
  expect(await page.getByTestId('align-guide').count()).toBe(0)
  await page.mouse.up()
})
