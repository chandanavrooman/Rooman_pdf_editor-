import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { statSync } from 'node:fs'
import { pageTexts } from '../../src/test/pdfText'
import { watchErrors, writePdf } from '../helpers'
import { bytesOf, fx, runAndSave, signIn, unzipText, upload, xlsxText, zipEntries } from './helpers'

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('Compress large.pdf: before/after sizes are shown and the downloaded file really is smaller', async ({ page }) => {
  const errors = watchErrors(page)
  const original = statSync(fx('large.pdf')).size
  await page.goto('/compress-pdf')
  await upload(page, fx('large.pdf'))
  await page.getByRole('radio', { name: /High/ }).check()
  const out = await runAndSave(page)
  const after = statSync(out.path).size
  expect(after).toBeLessThan(original)
  const info = await page.getByTestId('result-info').first().textContent()
  expect(info).toMatch(/Before: [\d.]+ (MB|KB) → After: [\d.]+ (MB|KB) · saved \d+(\.\d)?%/)
  console.log(`compress: ${original} -> ${after} bytes; UI said: ${info}`)
  expect((await PDFDocument.load(bytesOf(out.path))).getPageCount()).toBeGreaterThan(0)
  expect(errors).toEqual([])
})

test('PDF to Word on the table PDF: real w:tbl with 6 rows x 5 columns, no filler text', async ({ page }) => {
  await page.goto('/pdf-to-word')
  await upload(page, fx('table.pdf'))
  const out = await runAndSave(page)
  expect(out.name).toMatch(/\.docx$/)
  const xml = unzipText(out.path, 'word/document.xml')
  expect(xml).toContain('<w:tbl>')
  const rows = xml.match(/<w:tr[ >]/g) ?? []
  expect(rows.length).toBe(6)
  const firstRow = xml.slice(xml.indexOf('<w:tr'), xml.indexOf('</w:tr>'))
  expect((firstRow.match(/<w:tc>/g) ?? []).length).toBe(5)
  for (const cell of ['Item', 'Region', 'Widget', 'Thingamajig', '1499.85']) expect(xml).toContain(cell)
  expect(xml).not.toMatch(/Page 1|Converted Document/)
})

test('PDF to Excel on the table PDF: the table cells are in the workbook', async ({ page }) => {
  await page.goto('/pdf-to-excel')
  await upload(page, fx('table.pdf'))
  const out = await runAndSave(page)
  expect(out.name).toMatch(/\.xlsx$/)
  const shared = xlsxText(out.path)
  for (const cell of ['Item', 'Doohickey', 'Thingamajig', 'South']) expect(shared).toContain(cell)
  expect(zipEntries(out.path).some((e) => e.startsWith('xl/worksheets/sheet'))).toBe(true)
})

test('Word to PDF (LibreOffice): the PDF contains the document text', async ({ page }) => {
  await page.goto('/word-to-pdf')
  await upload(page, fx('sample.docx'))
  const out = await runAndSave(page)
  const text = (await pageTexts(bytesOf(out.path))).join(' ')
  expect(text).toContain('Sample Word Document')
  expect(text).toContain('Hello from the Word fixture')
  expect(text).toContain('R2C2')
})

test('OCR (Tesseract) makes the scanned PDF searchable', async ({ page }) => {
  await page.goto('/ocr-pdf')
  await upload(page, fx('scanned.pdf'))
  // a scanned file has no text before OCR
  expect((await pageTexts(bytesOf(fx('scanned.pdf')))).join('').trim()).toBe('')
  const out = await runAndSave(page)
  const text = (await pageTexts(bytesOf(out.path))).join(' ').toUpperCase()
  expect(text).toContain('INVOICE')
  expect(text).toContain('TOTAL')
  expect(text).toContain('AMOUNT')
})

test('Protect then Unlock round trip (wrong password is rejected with a clear message)', async ({ page }) => {
  await page.goto('/protect-pdf')
  await upload(page, fx('multipage.pdf'))
  await page.getByTestId('protect-password').fill('s3cret-pass')
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await page.getByTestId('protect-password2').fill('s3cret-pass')
  const protectedOut = await runAndSave(page)
  // the file is really encrypted: pdf-lib refuses it unless told to ignore encryption
  await expect(PDFDocument.load(bytesOf(protectedOut.path))).rejects.toThrow(/encrypted/i)

  await page.goto('/unlock-pdf')
  await upload(page, protectedOut.path)
  await page.getByTestId('unlock-password').fill('nope-nope')
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('tool-error')).toContainText(/password/i)
  await page.getByTestId('unlock-password').fill('s3cret-pass')
  const unlocked = await runAndSave(page)
  expect((await PDFDocument.load(bytesOf(unlocked.path))).getPageCount()).toBe(12)
  expect((await pageTexts(bytesOf(unlocked.path)))[0]).toContain('Chapter 1')
})

test('Metadata: current values are shown, an edit is saved into the PDF', async ({ page }) => {
  await page.goto('/metadata-pdf')
  await upload(page, fx('multipage.pdf'))
  await expect(page.getByTestId('meta-title')).toHaveValue('Multipage fixture')
  await expect(page.getByTestId('meta-info')).toContainText('12 page')
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await page.getByTestId('meta-title').fill('Edited in the e2e test')
  await page.getByTestId('meta-author').fill('Rooman QA')
  const out = await runAndSave(page)
  const doc = await PDFDocument.load(bytesOf(out.path))
  expect(doc.getTitle()).toBe('Edited in the e2e test')
  expect(doc.getAuthor()).toBe('Rooman QA')
  expect(doc.getPageCount()).toBe(12)
})

test('Watermark (text) is stamped on the pages', async ({ page }) => {
  await page.goto('/watermark-pdf')
  await upload(page, fx('multipage.pdf'))
  await page.getByTestId('wm-text').fill('E2EMARK')
  const out = await runAndSave(page)
  const texts = await pageTexts(bytesOf(out.path))
  expect(texts).toHaveLength(12)
  expect(texts.every((t) => t.includes('E2EMARK'))).toBe(true)
})



test('Images to PDF: two images become a two-page PDF', async ({ page }) => {
  await page.goto('/jpg-to-pdf')
  await upload(page, [fx('sample.jpg'), fx('sample.png')])
  await expect(page.getByTestId('file-row')).toHaveCount(2)
  const out = await runAndSave(page)
  expect((await PDFDocument.load(bytesOf(out.path))).getPageCount()).toBe(2)
})

test('PDF to PNG returns a zip with one image per page', async ({ page }) => {
  await page.goto('/pdf-to-png')
  await upload(page, fx('table.pdf'))
  const out = await runAndSave(page)
  expect(zipEntries(out.path).filter((e) => e.endsWith('.png'))).toHaveLength(1)
})

test('PDF to text has no filler headings', async ({ page }) => {
  await page.goto('/pdf-to-text')
  await upload(page, fx('multipage.pdf'))
  const out = await runAndSave(page)
  const text = new TextDecoder().decode(bytesOf(out.path))
  expect(text).toContain('Chapter 3 heading')
  expect(text).not.toMatch(/--- Page|Converted Document/)
})

test('Chain: browser Merge → server Compress on the same result file (no detached buffer, no re-pick)', async ({ page }) => {
  const errors = watchErrors(page)
  const a = await writePdf('chain-a.pdf', 2)
  const b = await writePdf('chain-b.pdf', 3)
  await page.goto('/merge-pdf')
  await upload(page, [a, b])
  await expect(page.getByTestId('file-row')).toHaveCount(2)
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible()
  // carry the merged result into the server-side tool
  await page.getByRole('link', { name: /Compress PDF/ }).click()
  await expect(page.getByTestId('file-row')).toHaveCount(1)
  await expect(page.getByTestId('file-row')).toContainText('chain-a-merged.pdf')
  const out = await runAndSave(page)
  expect((await PDFDocument.load(bytesOf(out.path))).getPageCount()).toBe(5)
  // and the server result can be carried into a browser tool again
  await page.getByRole('link', { name: /Merge PDF/ }).click()
  await expect(page.getByTestId('file-row')).toHaveCount(1)
  expect(errors.filter((e) => /detached/i.test(e))).toEqual([])
})
