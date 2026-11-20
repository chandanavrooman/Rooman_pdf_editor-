import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { pageCountOf, runAndDownload, writePdf } from './helpers'

test('Alternate & Mix: A1 B1 A2 B2 ...', async ({ page }) => {
  const a = await writePdf('mix-a.pdf', 3, 'A')
  const b = await writePdf('mix-b.pdf', 2, 'B')
  await page.goto('/alternate-mix')
  await page.getByTestId('file-input').first().setInputFiles([a, b])
  await expect(page.getByTestId('file-row')).toHaveCount(2)
  const out = await runAndDownload(page)
  expect(await pageCountOf(out)).toBe(5)
})

test('Split in half: every page becomes two', async ({ page }) => {
  const f = await writePdf('half.pdf', 3, 'H')
  await page.goto('/split-half')
  await page.getByTestId('file-input').first().setInputFiles(f)
  await expect(page.getByTestId('file-row')).toContainText('pages')
  const out = await runAndDownload(page)
  const doc = await PDFDocument.load(readFileSync(out))
  expect(doc.getPageCount()).toBe(6)
  // portrait pages are cut across the middle: 595 x 421
  expect(Math.round(doc.getPage(0).getHeight())).toBe(421)
})

test('Flip: same size, same page count', async ({ page }) => {
  const f = await writePdf('flip.pdf', 2, 'F')
  await page.goto('/flip-pdf')
  await page.getByTestId('file-input').first().setInputFiles(f)
  await expect(page.getByTestId('file-row')).toContainText('pages')
  const out = await runAndDownload(page)
  const doc = await PDFDocument.load(readFileSync(out))
  expect(doc.getPageCount()).toBe(2)
  expect(Math.round(doc.getPage(0).getWidth())).toBe(595)
})

test('Grayscale: pages come back as gray pictures', async ({ page }) => {
  const f = await writePdf('gray.pdf', 2, 'G')
  await page.goto('/grayscale-pdf')
  await page.getByTestId('file-input').first().setInputFiles(f)
  await expect(page.getByTestId('file-row')).toContainText('pages')
  const out = await runAndDownload(page)
  expect(await pageCountOf(out)).toBe(2)
})

test('Split by text: a new PDF starts at every page with the words', async ({ page }) => {
  const f = await writePdf('bytext.pdf', 4, 'Chapter')
  await page.goto('/split-pdf')
  await page.getByTestId('file-input').first().setInputFiles(f)
  await expect(page.getByTestId('file-row')).toContainText('pages')
  await page.getByRole('radio', { name: /By text/ }).check()
  await page.getByTestId('split-text').fill('page 3')
  await expect(page.getByTestId('split-count')).toHaveText('2 PDFs')
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 60_000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const files = unzipSync(new Uint8Array(readFileSync((await dl.path())!)))
  const counts = await Promise.all(Object.values(files).map(async (u) => (await PDFDocument.load(u)).getPageCount()))
  expect(counts.sort()).toEqual([2, 2])
})
