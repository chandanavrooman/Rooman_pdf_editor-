import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, rgb } from 'pdf-lib'

const DIR = join(import.meta.dirname, '.tmp')
mkdirSync(DIR, { recursive: true })

/** portrait, landscape, portrait, portrait */
async function mixed() {
  const d = await PDFDocument.create()
  for (const [w, h] of [[400, 600], [600, 400], [300, 700], [400, 600]] as const) {
    const p = d.addPage([w, h])
    p.drawRectangle({ x: 4, y: 4, width: w - 8, height: h - 8, borderColor: rgb(0, 0.5, 0.5), borderWidth: 4 })
  }
  const path = join(DIR, 'resize-mixed.pdf')
  writeFileSync(path, await d.save())
  return path
}
const mmOf = (pt: number) => Math.round((pt / 72) * 25.4)
const settle = async (page: import('@playwright/test').Page) => {
  await page.waitForTimeout(450)
  await expect(page.locator('[data-testid=rp-result] .animate-spin')).toHaveCount(0, { timeout: 20_000 })
}

test('Resize pages: paper sizes, before/after preview, orientation, page choice, real output', async ({ page }) => {
  await page.goto('/resize-pages')
  await page.getByTestId('file-input').first().setInputFiles(await mixed())
  await expect(page.getByTestId('resize-preview')).toBeVisible({ timeout: 30_000 })

  // every paper size from A0 to A6 is offered, with its millimetres
  const options = await page.locator('select option').allTextContents()
  for (const label of ['A0 (841 × 1189 mm)', 'A1 (594 × 841 mm)', 'A2 (420 × 594 mm)', 'A3 (297 × 420 mm)', 'A4 (210 × 297 mm)', 'A5 (148 × 210 mm)', 'A6 (105 × 148 mm)']) expect(options).toContain(label)

  // the preview follows the settings
  await settle(page)
  await expect(page.getByTestId('rp-result-size')).toHaveText('210 × 297 mm')
  await page.locator('select').selectOption('a3')
  await settle(page)
  await expect(page.getByTestId('rp-result-size')).toHaveText('297 × 420 mm')
  await page.getByTestId('rp-next').click() // the landscape page gets a landscape sheet
  await settle(page)
  await expect(page.getByTestId('rp-result-size')).toHaveText('420 × 297 mm')
  await page.getByLabel('Automatically match page orientation').uncheck()
  await page.getByRole('radio', { name: /Portrait/ }).check()
  await settle(page)
  await expect(page.getByTestId('rp-result-size')).toHaveText('297 × 420 mm')
  await page.getByLabel('Automatically match page orientation').check()

  // fit and fill explain themselves; fill warns
  await page.getByTestId('rp-next').click() // tall narrow page
  await settle(page)
  await expect(page.getByTestId('rp-note')).toContainText('White space is added left and right')
  await page.getByRole('radio', { name: /^Fill/ }).check()
  await settle(page)
  await expect(page.getByTestId('rp-note')).toContainText('cropped')
  await expect(page.getByText('Some edges may be cropped')).toBeVisible()
  await page.getByRole('radio', { name: /^Fit/ }).check()

  // selected pages are checked against the document
  await page.locator('select').selectOption('a5')
  await page.getByRole('radio', { name: /Selected pages/ }).check()
  await page.getByTestId('resize-pages').fill('2-9')
  await expect(page.getByRole('alert')).toContainText('out of range')
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await page.getByTestId('resize-pages').fill('1-2, 4')
  await expect(page.getByText('3 pages will be resized; the other 1 stay unchanged.')).toBeVisible()

  // the file really changes
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 40_000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const doc = await PDFDocument.load(readFileSync((await dl.path())!))
  const sizes = doc.getPages().map((p) => [mmOf(p.getWidth()), mmOf(p.getHeight())])
  expect(sizes).toEqual([[148, 210], [210, 148], [106, 247], [148, 210]]) // 1, 2 and 4 resized to A5; page 3 untouched
})
