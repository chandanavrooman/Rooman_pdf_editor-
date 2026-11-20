import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'

const FILE = resolve(import.meta.dirname, '../../tests/fixtures/three-pages.pdf')

test('Add margins: live preview, validation, per-side margins, real output', async ({ page }) => {
  await page.goto('/page-margins')
  await page.getByTestId('file-input').setInputFiles(FILE)
  await expect(page.getByTestId('file-row')).toContainText('3 pages')
  const guide = page.getByTestId('margin-guide')
  const px = async () => {
    const [g, c] = await Promise.all([guide.boundingBox(), page.getByTestId('margin-preview-canvas').boundingBox()])
    return { left: g!.x - c!.x, top: g!.y - c!.y, right: c!.x + c!.width - (g!.x + g!.width), bottom: c!.y + c!.height - (g!.y + g!.height), page: c!.width }
  }
  await expect(guide).toBeVisible({ timeout: 20_000 })
  const m = await px()
  expect(m.left / m.page).toBeCloseTo(10 / 210, 1) // 10 mm of an A4 width

  // the preview follows the number
  await page.getByTestId('margin-mm').fill('30')
  await expect.poll(async () => (await px()).left / (await px()).page, { timeout: 15_000 }).toBeCloseTo(30 / 210, 1)

  // invalid values: a message, no Apply, no preview
  const apply = page.getByTestId('run-button')
  await page.getByTestId('margin-mm').fill('-5')
  await expect(page.getByRole('alert').first()).toContainText('cannot be negative')
  await expect(apply).toBeDisabled()
  await page.getByTestId('margin-mm').fill('120')
  await expect(page.getByRole('alert').first()).toContainText('leave no room')
  await expect(apply).toBeDisabled()

  // different margins per side
  await page.getByLabel('Different per side').check()
  await page.getByTestId('margin-top').fill('40')
  await page.getByTestId('margin-bottom').fill('10')
  await page.getByTestId('margin-left').fill('25')
  await page.getByTestId('margin-right').fill('10')
  await expect(apply).toBeEnabled()
  await expect.poll(async () => { const g = await px(); return Math.round((g.top / g.page) * 210) }, { timeout: 15_000 }).toBe(40)
  await page.getByTestId('preview-next').click()
  await expect(page.getByTestId('preview-page')).toContainText('Page 2 of 3')

  // the file really changes: size kept, three pages
  await apply.click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 40_000 })
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const out = (await download.path())!
  const pdf = await PDFDocument.load(readFileSync(out))
  const orig = await PDFDocument.load(readFileSync(FILE))
  expect(pdf.getPageCount()).toBe(3)
  expect(pdf.getPage(0).getSize().width).toBeCloseTo(orig.getPage(0).getSize().width, 1)
  expect(pdf.getPage(0).getSize().height).toBeCloseTo(orig.getPage(0).getSize().height, 1)
})
