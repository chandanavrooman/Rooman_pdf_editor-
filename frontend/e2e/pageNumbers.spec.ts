import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { makePdf } from '../src/test/pdfs'
import { pageItems, pageTexts } from '../src/test/pdfText'

const DIR = join(import.meta.dirname, '.tmp')
mkdirSync(DIR, { recursive: true })

const settle = async (page: Page) => {
  await page.waitForTimeout(450)
  await expect(page.locator('[data-testid=stamp-preview] [role=status]')).toHaveCount(0, { timeout: 20_000 })
}

test('Add page numbers: visual positions, formats with examples, clear labels, live preview, real output', async ({ page }) => {
  const file = join(DIR, 'pn12.pdf')
  writeFileSync(file, await makePdf(12))
  await page.goto('/add-page-numbers')
  await page.getByTestId('file-input').first().setInputFiles(file)
  await expect(page.getByTestId('sp-canvas')).toBeVisible({ timeout: 30_000 })
  await settle(page)

  // six little pages, the chosen one marked
  await expect(page.locator('[data-testid=position-grid] label')).toHaveText(['Top left', 'Top centre', 'Top right', 'Bottom left', 'Bottom centre', 'Bottom right'])
  await expect(page.getByTestId('pos-bottom-center')).toBeChecked()
  await page.getByTestId('pos-top-right').click()
  await expect(page.getByTestId('pos-top-right')).toBeChecked()

  // formats show their look on this document
  expect(await page.locator('select').first().locator('option').allTextContents()).toEqual(['1', 'Page 1', 'Page 1 of 12', '1 / 12', '01', 'Custom…'])
  await page.locator('select').first().selectOption('{page:2}')
  await expect(page.getByTestId('pn-example')).toContainText('01')
  await expect(page.getByTestId('pn-example')).toContainText('03')

  // labels
  await expect(page.getByText('Apply to specific pages')).toBeVisible()
  await expect(page.getByText('Only number these pages')).toHaveCount(0)
  await expect(page.getByText('Leave this empty to number every page (all 12)')).toBeVisible()
  await expect(page.getByText('The number given to the first page of this PDF')).toBeVisible()

  // the preview is the real page with the real number
  await page.locator('select').first().selectOption('Page {page} of {pages}')
  await page.getByTestId('pn-start').fill('5')
  await settle(page)
  await expect(page.getByTestId('sp-caption')).toContainText('Page 5 of 16')
  await page.getByTestId('pn-start').fill('-2')
  await expect(page.getByRole('alert').first()).toContainText('whole number')
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await page.getByTestId('pn-start').fill('1')
  await page.getByTestId('pn-pages').fill('3-5')
  await settle(page)
  await expect(page.getByTestId('sp-page')).toHaveText('Page 3 of 12') // the preview moved to the first chosen page
  await page.getByTestId('sp-prev').click()
  await settle(page)
  await expect(page.getByTestId('sp-caption')).toContainText('gets no number')

  // colour from the shared picker, then the file
  await page.locator('button[aria-haspopup=dialog]').first().click()
  await page.getByTestId('color-hex').fill('#c3291e')
  await page.keyboard.press('Escape')
  await page.getByTestId('pos-bottom-center').click()
  await page.locator('select').first().selectOption('{page} / {pages}') // (the test file itself already says "Page n of 12")
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 40_000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const bytes = new Uint8Array(readFileSync((await dl.path())!))
  const texts = await pageTexts(bytes)
  expect(texts.map((t) => /\d+ \/ 12/.test(t))).toEqual([false, false, true, true, true, false, false, false, false, false, false, false])
  expect(texts[3]).toContain('4 / 12')
  const { items, height } = await pageItems(bytes, 4)
  const n = items.find((i) => i.str.startsWith('4 / 12'))!
  expect(n.y / height).toBeGreaterThan(0.9) // bottom of the page
})
