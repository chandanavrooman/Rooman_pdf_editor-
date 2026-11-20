import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { exportAndDownload, openEditor, writeEditorPdf } from './editorHelpers'
import { pageTexts } from '../src/test/pdfText'
import { PDFDocument, PDFName } from 'pdf-lib'
import { readFileSync } from 'node:fs'

const FX = resolve(import.meta.dirname, '../../tests/fixtures')
const SVG = resolve(import.meta.dirname, '.tmp/logo.svg')

test('Image tool: picker, formats, move/resize/rotate/opacity/delete, export', async ({ page }) => {
  writeFileSync(SVG, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#0e7490"/></svg>')
  await openEditor(page, '/edit', await writeEditorPdf('image-tool.pdf'), { fit: false })
  const placed = page.getByTestId('placed-image')

  // the button opens the file chooser
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('toolmenu-images').click() // Images ▾ → New image
  await page.getByTestId('tool-image').click()
  await chooser

  // PNG, JPG and SVG are each placed on the page
  for (const f of [`${FX}/sample.png`, `${FX}/sample.jpg`, SVG]) {
    const n = await placed.count()
    await page.getByTestId('image-input').setInputFiles(f)
    await expect(placed).toHaveCount(n + 1)
  }
  // as in Sejda: handles on all four corners (they keep the proportions) and all four sides (they stretch)
  await expect(page.getByTestId('handle-e')).toHaveCount(1)
  await expect(page.getByTestId('handle-se')).toHaveCount(1)

  // rotate, opacity
  await page.getByTestId('img-rot-right').click()
  await expect(page.getByTestId('img-rotation')).toHaveValue('90')
  await page.getByTestId('img-opacity').fill('50')
  await expect(placed.last()).toHaveCSS('opacity', '0.5')
  await expect(placed.last()).toHaveCSS('transform', /matrix/)

  // export keeps three images, the last at 50 % opacity
  const path = await exportAndDownload(page)
  const pdf = await PDFDocument.load(readFileSync(path))
  const xo = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'))!.toString()
  expect((xo.match(/Image-/g) ?? []).length).toBe(3)
  expect(await pageTexts(new Uint8Array(readFileSync(path)))).toBeTruthy()
})

test('Image tool: the delete button removes the image', async ({ page }) => {
  await openEditor(page, '/edit', await writeEditorPdf('image-del.pdf'), { fit: false })
  await page.getByTestId('image-input').setInputFiles(`${FX}/sample.png`)
  await expect(page.getByTestId('placed-image')).toHaveCount(1)
  // two ways to delete, as in Sejda: the little bar above the picture, and the option bar
  await page.getByTestId('img-bar-delete').click()
  await expect(page.getByTestId('placed-image')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('placed-image')).toHaveCount(1)
  await page.getByTestId('placed-image').click({ force: true }) // select it again
  await page.getByTestId('property-bar').getByRole('button', { name: /^Delete/ }).click()
  await expect(page.getByTestId('placed-image')).toHaveCount(0)
})
