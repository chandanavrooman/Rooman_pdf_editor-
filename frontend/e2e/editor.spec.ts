import { expect, test } from '@playwright/test'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFTextField } from 'pdf-lib'
import { readFileSync } from 'node:fs'
import { clickPs, dragPs, exportAndDownload, fitPage, openEditor, overlay, pickTool, toScreen, writeEditorPdf, writeFormPdf, writePng } from './editorHelpers'
import { watchErrors } from './helpers'
import { pageItems as pageItemsFromBytes, pageTexts } from '../src/test/pdfText'
import { darkPixelsIn, renderPixels } from '../src/test/nodeRender'

test.use({ viewport: { width: 1500, height: 1000 } })

const objectCount = (page: import('@playwright/test').Page, n = 1) => page.locator(`[role=button][aria-label*="on page ${n}"]`).count()

test('edit: text, shapes, whiteout, highlight, draw, image, signature, link; move/resize/undo/redo; export is the original plus the edits', async ({ page }) => {
  const errors = watchErrors(page)
  const pdf = await writeEditorPdf('edit-full.pdf')
  await openEditor(page, '/edit', pdf)

  // text (click, type, finish)
  await pickTool(page, 'text')
  await clickPs(page, 0, 60, 150)
  await page.getByTestId('text-editor').fill('E2E TEXT 123')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('text-editor')).toHaveCount(0)

  // rectangle, then move + resize + undo + redo
  await pickTool(page, 'rect')
  await dragPs(page, 0, [200, 140], [300, 200])
  const sel = page.getByTestId('selection-box')
  await expect(sel).toBeVisible()
  const b0 = (await sel.boundingBox())!
  await dragPs(page, 0, [250, 170], [280, 190]) // move by (30, 20) pt
  const b1 = (await sel.boundingBox())!
  expect(b1.x - b0.x).toBeGreaterThan(20)
  expect(b1.y - b0.y).toBeGreaterThan(10)
  expect(Math.abs(b1.width - b0.width)).toBeLessThan(1)
  const se = page.getByTestId('handle-se')
  const hb = (await se.boundingBox())!
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + 60, hb.y + 40, { steps: 6 })
  await page.mouse.up()
  const b2 = (await sel.boundingBox())!
  expect(b2.width).toBeGreaterThan(b1.width + 30)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => Math.round((await sel.boundingBox())!.width)).toBe(Math.round(b1.width))
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(async () => Math.round((await sel.boundingBox())!.width)).toBe(Math.round(b2.width))

  // whiteout over the second original line
  await pickTool(page, 'whiteout')
  await dragPs(page, 0, [30, 94], [390, 122])
  // highlight the heading (snaps to the text)
  await pickTool(page, 'highlight')
  await dragPs(page, 0, [38, 48], [250, 80])
  // freehand
  await pickTool(page, 'draw')
  await dragPs(page, 0, [60, 230], [170, 262], 14)
  await pickTool(page, 'select')

  // image
  await page.getByTestId('image-input').setInputFiles(writePng('e2e-img.png'))
  await expect(page.getByTestId('placed-image')).toHaveCount(1) // placed straight away, no second click needed
  // signature (typed)
  await page.getByTestId('tool-signature').click()
  await page.getByTestId('sig-tab-type').click()
  await page.getByTestId('signature-text').fill('Ada Lovelace')
  await page.getByTestId('signature-use').click()
  await expect(page.getByTestId('signature-dialog')).toHaveCount(0)
  await clickPs(page, 0, 300, 255)
  // link
  await pickTool(page, 'link')
  await dragPs(page, 0, [190, 226], [290, 244])
  await page.getByTestId('link-url').fill('https://example.com/e2e')

  const before = await objectCount(page)
  expect(before).toBe(8) // text, rect, whiteout, highlight, draw, image, signature, link
  const out = await exportAndDownload(page)

  const bytes = new Uint8Array(readFileSync(out))
  const d = await PDFDocument.load(bytes)
  expect(d.getPageCount()).toBe(2)
  const annots = d.getPage(0).node.Annots()!
  const kinds: string[] = []
  let uri = ''
  for (let i = 0; i < annots.size(); i++) {
    const a = d.context.lookup(annots.get(i), PDFDict)
    const sub = (a.get(PDFName.of('Subtype')) as PDFName).decodeText()
    kinds.push(sub)
    if (sub === 'Link') uri = a.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString).decodeText()
  }
  expect(kinds.sort()).toEqual(['Highlight', 'Link'])
  expect(uri).toBe('https://example.com/e2e')
  const xo = d.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
  expect(xo.keys().length).toBe(2) // image + signature
  const texts = await pageTexts(bytes)
  expect(texts[0]).toContain('E2E TEXT 123')
  expect(texts[0]).toContain('Original page 1') // original text is untouched (the whiteout only covers it)
  expect(texts[1]).toContain('Original page 2')
  const px = await renderPixels(bytes, 0, 1)
  expect(darkPixelsIn(px, 1, { x: 40, y: 98, w: 340, h: 18 }).dark).toBe(0) // whiteout really hides the second line

  // "Edit again" returns to the editor with every edit still there
  await page.getByTestId('edit-again').click()
  await expect(page.getByTestId('editor-root')).toBeVisible()
  await expect(page.getByTestId('page-overlay').first()).toBeVisible()
  expect(await objectCount(page)).toBe(before)
  expect(errors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([])
})

test('keyboard: arrows nudge, Delete removes, Ctrl+D duplicates, Escape returns to Select; unsaved-changes guard', async ({ page }) => {
  const pdf = await writeEditorPdf('edit-kb.pdf', 1)
  await openEditor(page, '/edit', pdf)
  await pickTool(page, 'ellipse')
  await dragPs(page, 0, [100, 150], [160, 200])
  const sel = page.getByTestId('selection-box')
  const a = (await sel.boundingBox())!
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  const b = (await sel.boundingBox())!
  expect(b.x).toBeGreaterThan(a.x)
  expect(b.y - a.y).toBeGreaterThan(5)
  await page.keyboard.press('Control+d')
  expect(await objectCount(page)).toBe(2)
  await page.keyboard.press('Delete')
  expect(await objectCount(page)).toBe(1)
  await pickTool(page, 'rect')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')

  // leaving with unsaved edits asks first
  const dialogs: string[] = []
  page.on('dialog', async (d) => {
    dialogs.push(d.message())
    await d.dismiss()
  })
  await page.getByRole('link', { name: 'Rooman PDF home' }).click()
  await expect.poll(() => dialogs.length).toBe(1)
  expect(dialogs[0]).toMatch(/unsaved/i)
  await expect(page).toHaveURL(/\/edit$/)
})

test('highlight / underline / strike-through snap to text lines and fall back to a rectangle on empty space', async ({ page }) => {
  const pdf = await writeEditorPdf('edit-marks.pdf', 1)
  await openEditor(page, '/edit', pdf)
  await pickTool(page, 'highlight')
  await dragPs(page, 0, [30, 45], [300, 82])
  await pickTool(page, 'underline')
  await dragPs(page, 0, [30, 98], [380, 120])
  await pickTool(page, 'strike')
  await dragPs(page, 0, [100, 200], [200, 230]) // empty area -> fallback rectangle
  expect(await objectCount(page)).toBe(3)
  const out = await exportAndDownload(page)
  const d = await PDFDocument.load(new Uint8Array(readFileSync(out)))
  const annots = d.getPage(0).node.Annots()!
  const subs: string[] = []
  for (let i = 0; i < annots.size(); i++) {
    const a = d.context.lookup(annots.get(i), PDFDict)
    subs.push((a.get(PDFName.of('Subtype')) as PDFName).decodeText())
    expect((a.get(PDFName.of('QuadPoints')) as PDFArray).size()).toBe(8)
  }
  expect(subs).toEqual(['Highlight', 'Underline', 'StrikeOut'])
})

test('Unicode text exports with the bundled font (Cyrillic + Greek) and plain text stays standard', async ({ page }) => {
  const pdf = await writeEditorPdf('edit-uni.pdf', 1)
  await openEditor(page, '/edit', pdf)
  await pickTool(page, 'text')
  await clickPs(page, 0, 40, 160)
  await page.getByTestId('text-editor').fill('Привет мир Ελληνικά')
  await page.keyboard.press('Escape')
  const out = await exportAndDownload(page)
  const texts = await pageTexts(new Uint8Array(readFileSync(out)))
  expect(texts[0]).toContain('Привет мир')
  expect(texts[0]).toContain('Ελληνικά')
})

test('an unsupported character gives a clear error instead of a broken file', async ({ page }) => {
  const pdf = await writeEditorPdf('edit-cjk.pdf', 1)
  await openEditor(page, '/edit', pdf)
  await pickTool(page, 'text')
  await clickPs(page, 0, 40, 160)
  await page.getByTestId('text-editor').fill('日本語')
  await page.keyboard.press('Escape')
  await page.getByTestId('export-button').click()
  await expect(page.getByTestId('editor-error')).toContainText(/not available/i)
  await expect(page.getByTestId('editor-root')).toBeVisible() // still in the editor, edits kept
})

test('links need a valid address before export', async ({ page }) => {
  const pdf = await writeEditorPdf('edit-link.pdf', 1)
  await openEditor(page, '/edit', pdf)
  await pickTool(page, 'link')
  await dragPs(page, 0, [40, 200], [140, 220])
  await page.getByTestId('link-url').fill('not a url')
  await page.getByTestId('export-button').click()
  await expect(page.getByTestId('editor-error')).toContainText(/cannot be exported.*address/i)
})

test('signature: draw on the pad, place it, resize it with a corner handle; it is saved for next time', async ({ page }) => {
  const pdf = await writeEditorPdf('sig-draw.pdf', 1)
  await openEditor(page, '/sign-pdf', pdf, { fit: false })
  await expect(page.getByTestId('signature-dialog')).toBeVisible() // sign mode opens the dialog straight away
  const pad = page.getByTestId('signature-pad')
  const pb = (await pad.boundingBox())!
  await page.mouse.move(pb.x + 30, pb.y + 90)
  await page.mouse.down()
  for (let i = 0; i < 20; i++) await page.mouse.move(pb.x + 30 + i * 12, pb.y + 90 + Math.sin(i / 2) * 40, { steps: 2 })
  await page.mouse.up()
  await page.getByTestId('signature-use').click()
  await fitPage(page)
  await clickPs(page, 0, 200, 220)
  const sel = page.getByTestId('selection-box')
  await expect(sel).toBeVisible()
  const w0 = (await sel.boundingBox())!.width
  const hb = (await page.getByTestId('handle-se').boundingBox())!
  await page.mouse.move(hb.x + 5, hb.y + 5)
  await page.mouse.down()
  await page.mouse.move(hb.x + 65, hb.y + 35, { steps: 6 })
  await page.mouse.up()
  expect((await sel.boundingBox())!.width).toBeGreaterThan(w0 + 30)
  const out = await exportAndDownload(page)
  const d = await PDFDocument.load(new Uint8Array(readFileSync(out)))
  expect(d.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict).keys().length).toBe(1)
  // the drawn signature was remembered in this browser
  await page.getByTestId('edit-again').click()
  await page.getByTestId('tool-signature').click()
  await expect(page.getByTestId('saved-signature')).toHaveCount(1)
})

test('fill forms: existing AcroForm fields become inputs; values are written into the PDF', async ({ page }) => {
  const errors = watchErrors(page)
  const pdf = await writeFormPdf('form.pdf')
  await openEditor(page, '/fill-form', pdf)
  await expect(page.getByTestId('fill-detected')).toContainText('Fillable form detected. Click any field to enter your information.')
  await expect(page.getByTestId('fill-summary')).toContainText('5 fields found')
  await page.locator('input[data-field="full_name"]').fill('Ada Lovelace')
  await page.locator('input[data-field="agree"]').check()
  await page.getByTestId('form-field-color-blue').check()
  await page.locator('select[data-field="country"]').selectOption('France')
  await page.locator('textarea[data-field="notes"]').fill('line one\nline two')
  const out = await exportAndDownload(page)
  const form = (await PDFDocument.load(new Uint8Array(readFileSync(out)))).getForm()
  expect((form.getField('full_name') as PDFTextField).getText()).toBe('Ada Lovelace')
  expect((form.getField('agree') as PDFCheckBox).isChecked()).toBe(true)
  expect((form.getField('color') as PDFRadioGroup).getSelected()).toBe('blue')
  expect((form.getField('country') as PDFDropdown).getSelected()).toEqual(['France'])
  expect((form.getField('notes') as PDFTextField).getText()).toBe('line one\nline two')
  expect(errors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([])

  // "Edit again" keeps the typed values in the inputs; flattening then removes the fields but keeps the text
  await page.getByTestId('edit-again').click()
  await expect(page.locator('input[data-field="full_name"]')).toHaveValue('Ada Lovelace')
  await page.getByTestId('flatten-form').check()
  const flat = await exportAndDownload(page)
  const fb = new Uint8Array(readFileSync(flat))
  expect((await PDFDocument.load(fb)).getForm().getFields().length).toBe(0)
  expect((await pageTexts(fb))[0]).toContain('Ada Lovelace')
})

test('form fields added in the editor are real, fillable AcroForm fields at the placed position', async ({ page }) => {
  const pdf = await writeEditorPdf('add-fields.pdf', 1)
  await openEditor(page, '/edit', pdf)
  await pickTool(page, 'field-text')
  await dragPs(page, 0, [100, 150], [260, 176])
  await page.getByTestId('field-name').fill('customer')
  await pickTool(page, 'field-checkbox')
  await clickPs(page, 0, 100, 200)
  await pickTool(page, 'field-dropdown')
  await dragPs(page, 0, [100, 230], [240, 254])
  const out = await exportAndDownload(page)
  const form = (await PDFDocument.load(new Uint8Array(readFileSync(out)))).getForm()
  expect(form.getFields().map((f) => f.getName()).sort()).toEqual(['checkbox_1', 'customer', 'dropdown_1'])
  const w = (form.getField('customer') as PDFTextField).acroField.getWidgets()[0].getRectangle()
  expect(Math.abs(w.x - 100)).toBeLessThan(3)
  expect(Math.abs(w.width - 160)).toBeLessThan(6)
  expect(Math.abs(w.y - (300 - 176))).toBeLessThan(4)
})


test('three tools in a row on one uploaded file (Rotate → Edit → Sign): no detached-buffer errors, rotation and edits all survive', async ({ page }) => {
  const errors = watchErrors(page)
  const src = await writeEditorPdf('chain-editor.pdf', 2)
  await page.goto('/rotate-pdf')
  await page.getByTestId('file-input').first().setInputFiles(src)
  await expect(page.getByTestId('file-row')).toContainText('chain-editor.pdf')

  // tool 1: rotate every page by 180°
  await expect(page.getByTestId('page-grid')).toBeVisible()
  await page.getByTestId('rotate-all-right').click()
  await page.getByTestId('rotate-all-right').click()
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible()

  // tool 2: carry the result into the editor, add text on the (rotated) page, export
  await page.getByTestId('result-panel').getByRole('link', { name: /Edit PDF/ }).click()
  await expect(page.getByTestId('editor-root')).toBeVisible()
  await expect(page.getByTestId('page-overlay').first()).toBeVisible()
  await fitPage(page)
  await pickTool(page, 'text')
  await clickPs(page, 0, 60, 150)
  await page.getByTestId('text-editor').fill('CHAIN TEXT')
  await page.keyboard.press('Escape')
  await page.getByTestId('export-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 30_000 })

  // tool 3: carry THAT result into Sign
  await page.getByTestId('result-panel').getByRole('link', { name: /Sign PDF/ }).click()
  await expect(page.getByTestId('signature-dialog')).toBeVisible()
  await page.getByTestId('sig-tab-type').click()
  await page.getByTestId('signature-text').fill('Chain Signer')
  await page.getByTestId('signature-use').click()
  await fitPage(page)
  await clickPs(page, 0, 250, 230)
  const out = await exportAndDownload(page)

  const bytes = new Uint8Array(readFileSync(out))
  const d = await PDFDocument.load(bytes)
  expect(d.getPageCount()).toBe(2)
  expect(d.getPage(0).getRotation().angle).toBe(180)
  expect(d.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict).keys().length).toBe(1)
  const texts = await pageTexts(bytes)
  expect(texts[0]).toContain('CHAIN TEXT')
  expect(texts[0]).toContain('Original page 1')
  const { items } = await pageItemsFromBytes(bytes, 1)
  const hit = items.find((i) => i.str === 'CHAIN TEXT')!
  expect(Math.abs(hit.x - 60)).toBeLessThan(2)
  expect(Math.abs(hit.y - (150 - 8 + 16 * 0.9465))).toBeLessThan(2)
  expect(errors.filter((e) => /detach|ArrayBuffer/i.test(e))).toEqual([])
  expect(errors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([])
})

test('editor looks right in light and dark mode', async ({ page }) => {
  const pdf = await writeEditorPdf('look.pdf')
  await openEditor(page, '/edit', pdf)
  await pickTool(page, 'text')
  await clickPs(page, 0, 60, 150)
  await page.getByTestId('text-editor').fill('Looks good')
  await page.keyboard.press('Escape')
  await pickTool(page, 'rect')
  await dragPs(page, 0, [200, 140], [320, 210])
  await pickTool(page, 'highlight')
  await dragPs(page, 0, [38, 48], [250, 80])
  await page.screenshot({ path: 'e2e/screenshots/editor-light.png' })
  await page.getByRole('button', { name: /switch to dark mode/i }).click()
  await page.screenshot({ path: 'e2e/screenshots/editor-dark.png' })
  await page.setViewportSize({ width: 420, height: 900 })
  await page.screenshot({ path: 'e2e/screenshots/editor-mobile.png' })
  // the toolbar stays usable on a narrow screen: every tool button is reachable
  await expect(page.getByTestId('tool-select')).toBeVisible()
  await expect(page.getByTestId('toolmenu-text')).toBeVisible()
  void overlay
  void toScreen
})
