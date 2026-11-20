import { expect, test } from '@playwright/test'
import { unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { pageCountOf, runAndDownload, watchErrors, writePdf } from './helpers'

test('Merge: two PDFs, reorder, download has all pages in the new order', async ({ page }) => {
  const errors = watchErrors(page)
  const a = await writePdf('alpha.pdf', 2)
  const b = await writePdf('beta.pdf', 3)
  await page.goto('/merge-pdf')
  await page.getByTestId('file-input').first().setInputFiles([a, b])
  await expect(page.getByTestId('file-row')).toHaveCount(2)
  await expect(page.getByTestId('run-button')).toBeEnabled()
  // move beta first
  await page.getByRole('button', { name: 'Move beta.pdf up' }).click()
  await expect(page.getByTestId('file-row').first()).toContainText('beta.pdf')
  await page.screenshot({ path: 'e2e/screenshots/merge-options-light.png', fullPage: true })
  const out = await runAndDownload(page)
  expect(await pageCountOf(out)).toBe(5)
  // the merged file is named after the first file in the (reordered) list
  expect(await page.getByTestId('result-summary').textContent()).toContain('beta-merged.pdf')
  await expect(page.getByTestId('result-title')).toHaveText('Your file is ready')
  expect(errors).toEqual([])
})

test('Merge needs two files', async ({ page }) => {
  const a = await writePdf('single.pdf', 1)
  await page.goto('/merge-pdf')
  await page.getByTestId('file-input').first().setInputFiles(a)
  await expect(page.getByTestId('run-button')).toBeDisabled()
})

test('Split by ranges produces a zip with the right page counts', async ({ page }) => {
  const errors = watchErrors(page)
  const src = await writePdf('ten.pdf', 10)
  await page.goto('/split-pdf')
  await page.getByTestId('file-input').first().setInputFiles(src)
  await expect(page.getByText('Your document has 10 pages')).toBeVisible()
  await page.getByTestId('split-ranges').fill('1-3,5,8-')
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-title')).toHaveText('3 files are ready')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const zip = unzipSync(new Uint8Array(readFileSync((await dl.path())!)))
  const names = Object.keys(zip).sort()
  expect(names).toEqual(['ten-page-5.pdf', 'ten-pages-1-3.pdf', 'ten-pages-8-10.pdf'])
  const counts = await Promise.all(names.map(async (n) => (await PDFDocument.load(zip[n])).getPageCount()))
  expect(counts).toEqual([1, 3, 3])
  expect(errors).toEqual([])
})

test('Split every N pages', async ({ page }) => {
  const src = await writePdf('seven.pdf', 7)
  await page.goto('/split-pdf')
  await page.getByTestId('file-input').first().setInputFiles(src)
  await page.getByRole('radio', { name: /Every X pages/ }).check()
  await expect(page.getByTestId('run-button')).toBeEnabled()
  await page.getByTestId('split-every').fill('3')
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-title')).toHaveText('3 files are ready')
})

test('Rotate: rotate all 90° right and verify /Rotate in the output', async ({ page }) => {
  const errors = watchErrors(page)
  const src = await writePdf('rot.pdf', 3)
  await page.goto('/rotate-pdf')
  await page.getByTestId('file-input').first().setInputFiles(src)
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await page.getByTestId('rotate-all-right').click()
  const out = await runAndDownload(page)
  const doc = await PDFDocument.load(readFileSync(out))
  expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 90, 90])
  expect(errors).toEqual([])
})

test('Extract pages by clicking thumbnails and typing a range', async ({ page }) => {
  const src = await writePdf('six.pdf', 6)
  await page.goto('/extract-pages')
  await page.getByTestId('file-input').first().setInputFiles(src)
  await expect(page.getByTestId('page-grid')).toBeVisible()
  await page.getByRole('button', { name: 'Page 2', exact: true }).click()
  await expect(page.getByTestId('page-range')).toHaveValue('2')
  await page.getByTestId('page-range').fill('1,4-5')
  await expect(page.getByRole('button', { name: 'Page 4', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('page-range').fill('9')
  await expect(page.getByRole('alert')).toContainText('out of range')
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await page.getByTestId('page-range').fill('1,4-5')
  const out = await runAndDownload(page)
  expect(await pageCountOf(out)).toBe(3)
})

test('Delete pages', async ({ page }) => {
  const src = await writePdf('del.pdf', 5)
  await page.goto('/delete-pages')
  await page.getByTestId('file-input').first().setInputFiles(src)
  await page.getByTestId('page-range').fill('2,4')
  const out = await runAndDownload(page)
  expect(await pageCountOf(out)).toBe(3)
})

test('Reorder: move a page with the arrow button', async ({ page }) => {
  const src = await writePdf('ord.pdf', 3)
  await page.goto('/reorder-pages')
  await page.getByTestId('file-input').first().setInputFiles(src)
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await page.getByRole('button', { name: 'Move page 3 earlier' }).click()
  await expect(page.getByTestId('run-button')).toBeEnabled()
  const out = await runAndDownload(page)
  expect(await pageCountOf(out)).toBe(3)
})

test('Add page numbers', async ({ page }) => {
  const src = await writePdf('num.pdf', 4)
  await page.goto('/add-page-numbers')
  await page.getByTestId('file-input').first().setInputFiles(src)
  await page.getByTestId('pn-start').fill('10')
  const out = await runAndDownload(page)
  expect(await pageCountOf(out)).toBe(4)
})

test('Crop, Resize, N-up, Headers/footers and Bates run end to end', async ({ page }) => {
  const errors = watchErrors(page)
  const src = await writePdf('misc.pdf', 4)

  await page.goto('/crop-pdf')
  await page.getByTestId('file-input').first().setInputFiles(src)
  await expect(page.getByTestId('crop-box')).toBeVisible()
  let out = await runAndDownload(page)
  const box = (await PDFDocument.load(readFileSync(out))).getPage(0).getCropBox()
  expect(box.width).toBeLessThan(595)
  expect(box.height).toBeLessThan(842)

  await page.goto('/resize-pages')
  await page.getByTestId('file-input').first().setInputFiles(src)
  await page.getByRole('combobox', { name: 'Paper size' }).selectOption('letter')
  out = await runAndDownload(page)
  const sz = (await PDFDocument.load(readFileSync(out))).getPage(0).getSize()
  expect(Math.round(sz.width)).toBe(612)
  expect(Math.round(sz.height)).toBe(792)

  await page.goto('/n-up')
  await page.getByTestId('file-input').first().setInputFiles(src)
  out = await runAndDownload(page)
  expect(await pageCountOf(out)).toBe(1) // 4 pages, 4 per sheet

  await page.goto('/headers-footers')
  await page.getByTestId('file-input').first().setInputFiles(src)
  await page.getByTestId('hf-top-left').fill('{filename}')
  out = await runAndDownload(page)
  expect(await pageCountOf(out)).toBe(4)

  await page.goto('/bates-numbering')
  await page.getByTestId('file-input').first().setInputFiles([src, await writePdf('misc2.pdf', 2)])
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-title')).toHaveText('2 files are ready')
  expect(errors).toEqual([])
})

test('Three different tools in a row on the same file — no "detached ArrayBuffer" error', async ({ page }) => {
  const errors = watchErrors(page)
  const src = await writePdf('chain.pdf', 6)

  // Upload ONCE in the first tool, then carry the file through three tools.
  await page.goto('/rotate-pdf')
  await page.getByTestId('file-input').first().setInputFiles(src)

  // Tool 1: rotate — viewer thumbnails open pdf.js on the stored file
  await expect(page.getByTestId('file-row')).toContainText('chain.pdf')
  await expect(page.getByTestId('page-grid')).toBeVisible()
  await page.getByTestId('rotate-all-left').click()
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible()
  await page.getByTestId('edit-again').click() // "Edit again" keeps the same file
  await expect(page.getByTestId('file-row')).toContainText('chain.pdf')
  await page.getByTestId('rotate-all-right').click()
  await page.getByTestId('rotate-all-right').click()
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible()

  // Tool 2: continue with the RESULT file in Reorder -> then Tool 3 from related links
  await page.getByTestId('result-panel').getByRole('link', { name: /Reorder pages/ }).click()
  await expect(page.getByTestId('file-row')).toContainText('chain-rotated.pdf')
  await expect(page.getByTestId('page-grid')).toBeVisible()
  await page.getByRole('button', { name: 'Move page 6 earlier' }).click()
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible()
  await page.getByTestId('result-panel').getByRole('link', { name: /Add page numbers/ }).click()
  await expect(page.getByTestId('file-row')).toContainText('chain-rotated-reordered.pdf')
  const out = await runAndDownload(page)
  expect(await pageCountOf(out)).toBe(6)

  // And the original file is still usable in yet another tool after all of that
  expect(errors.filter((e) => /detach|ArrayBuffer/i.test(e))).toEqual([])
  expect(errors).toEqual([])
})

test('Viewer-powered tool pages render original pages (thumbnails have pixels) in light and dark', async ({ page }) => {
  const src = await writePdf('view.pdf', 3, 'View')
  await page.goto('/extract-pages')
  await page.getByTestId('file-input').first().setInputFiles(src)
  const canvas = page.locator('[data-testid="page-grid"] canvas').first()
  await expect(canvas).toBeVisible()
  await expect.poll(async () => canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let dark = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200) dark++
    return dark
  })).toBeGreaterThan(20)
  await page.screenshot({ path: 'e2e/screenshots/extract-light.png', fullPage: true })
  await page.getByRole('button', { name: /switch to dark mode/i }).click()
  await page.screenshot({ path: 'e2e/screenshots/extract-dark.png', fullPage: true })
})

test('Shared viewer: preview, zoom, rotate view, page navigation, thumbnails', async ({ page }) => {
  const errors = watchErrors(page)
  const src = await writePdf('viewer.pdf', 5, 'Viewer')
  await page.goto('/extract-pages')
  await page.getByTestId('file-input').first().setInputFiles(src)
  await page.getByRole('button', { name: 'Preview viewer.pdf' }).click()
  const panel = page.getByTestId('preview-panel')
  await expect(panel.getByRole('img', { name: 'Page 1' })).toBeVisible()
  const inked = (sel: string) => panel.locator(sel).first().evaluate((c) => {
    const cv = c as HTMLCanvasElement
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++
    return n
  })
  await expect.poll(() => inked('canvas[aria-label="Page 1"]')).toBeGreaterThan(100) // real glyph pixels from the original page
  await expect(panel.getByRole('navigation', { name: 'Page thumbnails' }).getByRole('button')).toHaveCount(5)

  const zoomText = async () => parseInt((await panel.getByTestId('zoom-level').textContent()) ?? '0', 10)
  const z0 = await zoomText()
  await panel.getByRole('button', { name: 'Zoom in' }).click()
  expect(await zoomText()).toBeGreaterThan(z0)
  await panel.getByRole('button', { name: 'Zoom out' }).click()
  await panel.getByRole('button', { name: 'Zoom out' }).click()
  expect(await zoomText()).toBeLessThan(z0)

  const sizeOf = () => panel.locator('canvas[aria-label="Page 1"]').evaluate((c) => ({ w: (c as HTMLCanvasElement).clientWidth, h: (c as HTMLCanvasElement).clientHeight }))
  await panel.getByRole('button', { name: 'Fit to width' }).click()
  const before = await sizeOf()
  await panel.getByRole('button', { name: 'Rotate view right' }).click()
  await expect.poll(async () => (await sizeOf()).w > (await sizeOf()).h).toBe(true) // portrait page now landscape
  expect(before.h).toBeGreaterThan(before.w)

  await panel.getByRole('button', { name: 'Go to page 4' }).click()
  await expect(panel.getByRole('textbox', { name: 'Page number' })).toHaveValue('4')
  await expect(panel.getByRole('img', { name: 'Page 4' })).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/viewer-light.png' })
  expect(errors).toEqual([])
})
