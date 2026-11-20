import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { makePdf, makePdfWithBookmarks } from '../src/test/pdfs'

const DIR = join(import.meta.dirname, '.tmp')
mkdirSync(DIR, { recursive: true })
const save = (name: string, bytes: Uint8Array) => {
  const p = join(DIR, name)
  writeFileSync(p, bytes)
  return p
}
async function open(page: Page, file: string) {
  await page.goto('/split-pdf')
  await page.getByTestId('file-input').first().setInputFiles(file)
  await expect(page.getByTestId('file-row')).toContainText('pages')
}
const pick = (page: Page, name: RegExp) => page.getByRole('radio', { name }).check()
const rows = (page: Page) => page.locator('[data-testid=split-parts] li')
async function unzipDownload(page: Page) {
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 60_000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  return unzipSync(new Uint8Array(readFileSync((await dl.path())!)))
}
const pages = async (u: Uint8Array) => (await PDFDocument.load(u)).getPageCount()

test('Split: only the settings of the chosen method are shown', async ({ page }) => {
  await open(page, save('s12.pdf', await makePdf(12)))
  const shown = async () => ({ ranges: await page.getByTestId('split-ranges').count(), every: await page.getByTestId('split-every').count(), size: await page.getByTestId('split-size').count(), marks: await page.getByTestId('split-bookmarks').count() })
  expect(await shown()).toEqual({ ranges: 1, every: 0, size: 0, marks: 0 })
  await pick(page, /Every X pages/)
  expect(await shown()).toEqual({ ranges: 0, every: 1, size: 0, marks: 0 })
  await pick(page, /By file size/)
  expect(await shown()).toEqual({ ranges: 0, every: 0, size: 1, marks: 0 })
})

test('Split by ranges: summary, overlap and range errors, real files', async ({ page }) => {
  await open(page, save('s10.pdf', await makePdf(10)))
  await page.getByTestId('split-ranges').fill('1-5, 3-7')
  await expect(page.getByRole('alert')).toContainText('both contain pages 3–5')
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await page.getByTestId('split-ranges').fill('1-12')
  await expect(page.getByRole('alert')).toContainText('out of range')
  await page.getByTestId('split-ranges').fill('1-3, 4-6, 7-10')
  await expect(page.getByTestId('split-count')).toHaveText('3 PDFs')
  await expect(rows(page)).toHaveCount(3)
  await expect(rows(page).nth(2)).toContainText('pages 7–10')
  const z = await unzipDownload(page)
  expect(Object.keys(z)).toHaveLength(3)
  expect((await Promise.all(Object.values(z).map(pages))).sort((a, b) => a - b)).toEqual([3, 3, 4])
})

test('Split every X pages: the incomplete last group is kept and explained', async ({ page }) => {
  await open(page, save('s12b.pdf', await makePdf(12)))
  await pick(page, /Every X pages/)
  await page.getByTestId('split-every').fill('3')
  await expect(page.getByTestId('split-count')).toHaveText('4 PDFs')
  await page.getByTestId('split-every').fill('5')
  await expect(page.getByTestId('split-count')).toHaveText('3 PDFs')
  await expect(page.getByTestId('split-summary')).toContainText('last PDF has only 2 pages')
  await page.getByTestId('split-every').fill('2.5')
  await expect(page.getByRole('alert')).toContainText('whole number')
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await page.getByTestId('split-every').fill('5')
  const z = await unzipDownload(page)
  expect((await Promise.all(Object.values(z).map(pages))).sort((a, b) => a - b)).toEqual([2, 5, 5])
})

test('Split by bookmarks: pick which bookmarks to use; no-bookmark PDFs get a clear message', async ({ page }) => {
  await open(page, save('bm.pdf', await makePdfWithBookmarks(12, [{ title: 'Intro', page: 0 }, { title: 'Part A', page: 4 }, { title: 'Part B', page: 8 }])))
  await pick(page, /By bookmarks/)
  await expect(page.locator('[data-testid=split-bookmarks] li')).toHaveCount(3)
  await expect(page.getByTestId('split-count')).toHaveText('3 PDFs')
  await page.getByTestId('mark-1').uncheck()
  await expect(page.getByTestId('split-count')).toHaveText('2 PDFs')
  await expect(rows(page).first()).toContainText('pages 1–8')
  await page.getByTestId('marks-none').click()
  await expect(page.getByRole('alert')).toContainText('Tick at least one bookmark')
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await page.getByTestId('marks-all').click()
  const z = await unzipDownload(page)
  expect(Object.keys(z).sort()).toEqual(['bm-01-Intro.pdf', 'bm-02-Part A.pdf', 'bm-03-Part B.pdf'])
})

test('Split by bookmarks: a PDF without bookmarks says so', async ({ page }) => {
  await open(page, save('nobm.pdf', await makePdf(4)))
  await pick(page, /By bookmarks/)
  await expect(page.getByText('This PDF has no bookmarks')).toBeVisible()
  await expect(page.getByTestId('run-button')).toBeDisabled()
})

test('Split by file size: exact plan before splitting, every file within the limit', async ({ page }) => {
  await open(page, save('heavy.pdf', await makePdf(20, { filler: 60 })))
  await pick(page, /By file size/)
  await page.locator('select').selectOption('KB')
  await page.getByTestId('split-size').fill('-3')
  await expect(page.getByRole('alert')).toContainText('cannot be negative')
  await page.getByTestId('split-size').fill('2')
  await expect(page.getByRole('alert')).toContainText('at least 10 KB')
  await page.getByTestId('split-size').fill('15')
  await expect(rows(page).first()).toBeVisible({ timeout: 30_000 })
  const planned = Number((await page.getByTestId('split-count').textContent())!.replace(/\D/g, ''))
  expect(planned).toBeGreaterThan(1)
  const z = await unzipDownload(page)
  expect(Object.keys(z)).toHaveLength(planned) // the plan on screen was the real result
  for (const u of Object.values(z)) expect(u.byteLength).toBeLessThanOrEqual(15 * 1024)
})
