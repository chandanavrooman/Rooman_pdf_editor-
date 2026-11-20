import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { makePdf } from '../src/test/pdfs'
import { pageTexts } from '../src/test/pdfText'

const DIR = join(import.meta.dirname, '.tmp')
mkdirSync(DIR, { recursive: true })

const settle = async (page: Page) => {
  await page.waitForTimeout(500)
  await expect(page.locator('[data-testid=stamp-preview] [role=status]')).toHaveCount(0, { timeout: 20_000 })
}

test('Bates numbering: clear file order, live numbers and preview, one sequence across files', async ({ page }) => {
  const files = [
    { name: 'contract.pdf', pages: 3 },
    { name: 'exhibit-b.pdf', pages: 4 },
    { name: 'letter.pdf', pages: 2 },
  ].map((f) => ({ ...f, path: join(DIR, f.name) }))
  for (const f of files) writeFileSync(f.path, await makePdf(f.pages, { label: f.name }))

  await page.goto('/bates-numbering')
  await page.getByTestId('file-input').first().setInputFiles(files.map((f) => f.path))
  await expect(page.getByTestId('sp-canvas')).toBeVisible({ timeout: 30_000 })
  await settle(page)
  await expect(page.locator('input[type=color]')).toHaveCount(0)

  // the order is explained, and every file shows the numbers it will get
  await expect(page.getByTestId('files-hint')).toContainText('does not start again at 1')
  const rows = page.getByTestId('file-row')
  await expect(rows.nth(0)).toContainText('DOC-000001 to DOC-000003')
  await expect(rows.nth(1)).toContainText('DOC-000004 to DOC-000007')
  await expect(rows.nth(2)).toContainText('DOC-000008 to DOC-000009')
  await expect(page.getByTestId('bates-range')).toContainText('3 files, 9 pages: from DOC-000001 to DOC-000009')

  // the visual position grid and the helper text
  await expect(page.locator('[data-testid=position-grid] label')).toHaveText(['Top left', 'Top centre', 'Top right', 'Bottom left', 'Bottom centre', 'Bottom right'])
  await expect(page.getByTestId('pos-bottom-right')).toBeChecked()
  await expect(page.getByText('Short numbers get zeros in front: 6 digits gives 000001.')).toBeVisible()

  // changing the fields changes the numbers at once, in the list, the example and the preview
  await page.getByTestId('bates-prefix').fill('CASE-')
  await page.getByTestId('bates-start').fill('100')
  await page.getByTestId('bates-digits').fill('4')
  await page.getByTestId('bates-suffix').fill('-CONF')
  await expect(page.getByTestId('bates-example')).toContainText('CASE-0100-CONF')
  await expect(rows.nth(1)).toContainText('CASE-0103-CONF to CASE-0106-CONF')
  await page.getByTestId('bates-preview-file').selectOption({ index: 1 })
  await settle(page)
  await expect(page.getByTestId('sp-caption')).toContainText('Page 1 of exhibit-b.pdf gets CASE-0103-CONF')

  // wrong values are explained and stop the run
  await page.getByTestId('bates-digits').fill('15')
  await expect(page.getByRole('alert').first()).toContainText('1 to 12')
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await page.getByTestId('bates-digits').fill('4')
  await expect(page.getByTestId('run-button')).toBeEnabled()

  // reordering changes the numbers, not the total
  await page.getByRole('button', { name: 'Move letter.pdf up' }).click()
  await page.getByRole('button', { name: 'Move letter.pdf up' }).click()
  await expect(rows.nth(0)).toContainText('letter.pdf')
  await expect(rows.nth(0)).toContainText('CASE-0100-CONF to CASE-0101-CONF')
  await expect(rows.nth(1)).toContainText('CASE-0102-CONF to CASE-0104-CONF')
  await expect(page.getByTestId('bates-range')).toContainText('from CASE-0100-CONF to CASE-0108-CONF')

  // the files really carry one running sequence, in the new order
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 40_000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const zip = unzipSync(new Uint8Array(readFileSync((await dl.path())!)))
  const stamps = async (name: string) => (await pageTexts(zip[name])).map((t) => /CASE-\d{4}-CONF/.exec(t)?.[0])
  expect(await stamps('letter-bates.pdf')).toEqual(['CASE-0100-CONF', 'CASE-0101-CONF'])
  expect(await stamps('contract-bates.pdf')).toEqual(['CASE-0102-CONF', 'CASE-0103-CONF', 'CASE-0104-CONF'])
  expect(await stamps('exhibit-b-bates.pdf')).toEqual(['CASE-0105-CONF', 'CASE-0106-CONF', 'CASE-0107-CONF', 'CASE-0108-CONF'])
})
