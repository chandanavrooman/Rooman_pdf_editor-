import { expect, type Locator, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(import.meta.dirname, '.tmp')
mkdirSync(DIR, { recursive: true })

export const PAGE_W = 400
export const PAGE_H = 300

/** Small landscape pages so the whole page fits the viewer without scrolling. Page i has "<label> page i" at PS (40, 50). */
export async function writeEditorPdf(name: string, pages = 2, label = 'Original'): Promise<string> {
  const d = await PDFDocument.create()
  const font = await d.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) {
    const p = d.addPage([PAGE_W, PAGE_H])
    p.drawText(`${label} page ${i}`, { x: 40, y: PAGE_H - 70, size: 22, font, color: rgb(0, 0, 0) })
    p.drawText('The quick brown fox jumps over the lazy dog', { x: 40, y: PAGE_H - 110, size: 12, font })
  }
  const path = join(DIR, name)
  writeFileSync(path, await d.save())
  return path
}

export function writePng(name: string, w = 60, h = 30, color = '#16a34a'): string {
  const c = createCanvas(w, h)
  const x = c.getContext('2d')
  x.fillStyle = color
  x.fillRect(0, 0, w, h)
  x.fillStyle = '#fff'
  x.fillRect(4, 4, w / 3, h / 3)
  const path = join(DIR, name)
  writeFileSync(path, c.toBuffer('image/png'))
  return path
}

export async function openEditor(page: Page, route: string, pdfPath: string, opts: { fit?: boolean } = {}) {
  await page.goto(route)
  await page.getByTestId('file-input').setInputFiles(pdfPath)
  await expect(page.getByTestId('editor-root')).toBeVisible()
  await expect(page.getByTestId('page-overlay').first()).toBeVisible()
  if (opts.fit !== false) await fitPage(page)
}

/** Zoom out until one whole page fits in the viewer's visible area. */
export async function fitPage(page: Page) {
  const scroll = page.getByTestId('viewer-scroll')
  for (let i = 0; i < 6; i++) {
    const o = await page.getByTestId('page-overlay').first().boundingBox()
    const s = await scroll.boundingBox()
    if (o && s && o.height <= s.height - 24) break
    await page.getByRole('button', { name: 'Zoom out' }).click()
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(250)
}

export async function overlay(page: Page, i = 0): Promise<Locator> {
  const o = page.getByTestId('page-overlay').nth(i)
  await o.scrollIntoViewIfNeeded()
  return o
}

/** Convert page-space points to screen coordinates for page i. */
export async function toScreen(page: Page, i: number, x: number, y: number) {
  const o = await overlay(page, i)
  const b = (await o.boundingBox())!
  const k = b.width / PAGE_W
  return { x: b.x + x * k, y: b.y + y * k, k }
}

export async function clickPs(page: Page, i: number, x: number, y: number) {
  const p = await toScreen(page, i, x, y)
  await page.mouse.click(p.x, p.y)
}

export async function dragPs(page: Page, i: number, from: [number, number], to: [number, number], steps = 8) {
  const a = await toScreen(page, i, from[0], from[1])
  const b = await toScreen(page, i, to[0], to[1])
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps })
  await page.mouse.up()
}

const MENU_OF: Record<string, string> = { table: 'text', image: 'images', 'delete-image': 'images', 'field-text': 'forms', 'field-checkbox': 'forms', 'field-radio': 'forms', 'field-dropdown': 'forms', highlight: 'annotate', underline: 'annotate', strike: 'annotate', draw: 'annotate', rect: 'shapes', ellipse: 'shapes', line: 'shapes', arrow: 'shapes' }

/** Choose a tool; tools in a drop-down (Forms, Annotate, Shapes, Table) are reached through their menu, as a user would. */
export async function openToolMenu(page: Page, id: string) {
  const menu = MENU_OF[id]
  if (menu && !(await page.getByTestId(`tool-${id}`).isVisible())) await page.getByTestId(`toolmenu-${menu}`).click()
}

/** The tool is the active one. A tool inside a drop-down is checked by opening its menu again (a chosen item closes the menu). */
export async function expectToolOn(page: Page, id: string) {
  const menu = MENU_OF[id]
  if (menu && !(await page.getByTestId(`tool-${id}`).isVisible())) {
    await page.getByTestId(`toolmenu-${menu}`).click()
    await expect(page.getByTestId(`tool-${id}`)).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId(`toolmenu-${menu}`).click() // close it again (Escape would also switch the tool back to Select)
  } else await expect(page.getByTestId(`tool-${id}`)).toHaveAttribute('aria-pressed', 'true')
}

export async function pickTool(page: Page, id: string) {
  await openToolMenu(page, id)
  await page.getByTestId(`tool-${id}`).click()
  await expectToolOn(page, id)
}

/** A real AcroForm PDF (text field, checkbox, radio group, dropdown, multiline) on a 400x300 page. */
export async function writeFormPdf(name: string): Promise<string> {
  const d = await PDFDocument.create()
  const font = await d.embedFont(StandardFonts.Helvetica)
  const p = d.addPage([PAGE_W, PAGE_H])
  p.drawText('Application form', { x: 30, y: 270, size: 16, font })
  const form = d.getForm()
  form.createTextField('full_name').addToPage(p, { x: 120, y: 230, width: 220, height: 22 })
  form.createCheckBox('agree').addToPage(p, { x: 120, y: 195, width: 16, height: 16 })
  const radio = form.createRadioGroup('color')
  radio.addOptionToPage('red', p, { x: 120, y: 165, width: 14, height: 14 })
  radio.addOptionToPage('blue', p, { x: 180, y: 165, width: 14, height: 14 })
  const dd = form.createDropdown('country')
  dd.addOptions(['India', 'France', 'Peru'])
  dd.addToPage(p, { x: 120, y: 130, width: 150, height: 22 })
  const notes = form.createTextField('notes')
  notes.enableMultiline()
  notes.addToPage(p, { x: 120, y: 60, width: 220, height: 50 })
  const path = join(DIR, name)
  writeFileSync(path, await d.save())
  return path
}

export async function exportAndDownload(page: Page): Promise<string> {
  await page.getByTestId('export-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 30_000 })
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const path = await download.path()
  if (!path) throw new Error('download failed')
  return path
}
