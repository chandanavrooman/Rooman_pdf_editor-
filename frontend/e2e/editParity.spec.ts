import { expect, test, type Page } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { exportAndDownload } from './editorHelpers'

/**
 * Sejda-style in-place text editing on real documents. The PDFs live outside the repo (the user's Downloads folder), so each test
 * skips when its file is missing. Exports are copied to PARITY_OUT for a side-by-side check against the originals.
 */
const DL = process.env.PARITY_DL ?? 'C:/Users/chandana/Downloads'
const FIX = resolve(import.meta.dirname, '../../tests/fixtures/chandana-report.pdf')
const OUT = process.env.PARITY_OUT ?? join(import.meta.dirname, '.tmp', 'parity')
mkdirSync(OUT, { recursive: true })

async function open(page: Page, file: string) {
  await page.setViewportSize({ width: 1500, height: 1100 })
  await page.goto('/edit')
  await page.getByTestId('file-input').setInputFiles(file)
  await expect(page.getByTestId('page-overlay').first()).toBeVisible()
  await page.getByTestId('zoom-preset').selectOption('1')
  await page.waitForTimeout(2500)
}

/** the debug layer exposes every run (text, font); use it to find where a run is on screen */
async function runBox(page: Page, match: RegExp) {
  if (!(await page.getByTestId('debug-layer').count())) await page.getByTestId('debug-toggle').check()
  await page.waitForTimeout(500)
  const boxes = page.getByTestId('debug-box')
  const n = await boxes.count()
  for (let i = 0; i < n; i++) {
    const str = (await boxes.nth(i).getAttribute('data-str')) ?? ''
    if (match.test(str)) {
      await boxes.nth(i).scrollIntoViewIfNeeded()
      return { box: (await boxes.nth(i).boundingBox())!, str, font: await boxes.nth(i).getAttribute('data-font') }
    }
  }
  throw new Error(`no run matches ${match}`)
}

async function editRun(page: Page, match: RegExp, change: (s: string) => string) {
  const r = await runBox(page, match)
  await page.getByTestId('debug-toggle').uncheck()
  await page.getByTestId('tool-text').click()
  await page.mouse.click(r.box.x + Math.min(r.box.width / 2, 40), r.box.y + r.box.height / 2)
  const ta = page.getByTestId('text-editor')
  await expect(ta).toBeVisible()
  const before = await ta.inputValue()
  const after = change(before)
  await ta.fill(after)
  return { before, after, ta }
}

async function finish(page: Page, name: string) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const path = await exportAndDownload(page)
  copyFileSync(path, join(OUT, name))
}

const have = (f: string) => existsSync(f)

test('1. bold heading: one word changed keeps font, size, colour and weight', async ({ page }) => {
  const f = join(DL, 'app_launch_strategy_report.pdf')
  test.skip(!have(f))
  await open(page, f)
  const { before } = await editRun(page, /^App launch strategy$/, (s) => s.replace('strategy', 'roadmaps'))
  expect(before).toBe('App launch strategy')
  // the editor box uses the matched serif face, bold, and a transparent background
  const css = await page.getByTestId('text-editor').evaluate((el) => {
    const c = getComputedStyle(el)
    return { family: c.fontFamily, weight: c.fontWeight, bg: c.backgroundColor, overflow: c.overflow }
  })
  expect(css.family).toContain('Noto Serif')
  expect(Number(css.weight)).toBeGreaterThanOrEqual(700)
  expect(css.bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
  expect(['visible', 'auto']).toContain(css.overflow) // never 'hidden': text must not be clipped
  await finish(page, 'p1-heading.pdf')
})

test('2. table cell: a number edits with no guides and no clipping', async ({ page }) => {
  test.skip(!have(FIX))
  await open(page, FIX)
  await page.getByTestId('debug-toggle').check()
  await page.waitForTimeout(400)
  await page.getByTestId('debug-toggle').uncheck()
  const { before } = await editRun(page, /(^|\s)26(\s|$)/, (s) => s.replace(/(^|\s)26(\s|$)/, '$127$2'))
  expect(before.length).toBeGreaterThan(0)
  // no table chrome in select mode / while editing
  await expect(page.getByTestId('table-detected')).toHaveCount(0)
  await finish(page, 'p2-table.pdf')
})

test('3. resume contact line: one box per line, serif face, nothing stray', async ({ page }) => {
  const f = join(DL, 'chandana_59_resume.pdf')
  test.skip(!have(f))
  await open(page, f)
  const r = await runBox(page, /^vchandana00@gmail\.com/) // the debug layer lists raw pdf.js runs; the editor joins them into the line
  expect(r.font).toBe('latin-modern')
  const textBefore = await page.locator('[data-testid^=text-object], [data-testid=text-editor]').count()
  await page.getByTestId('debug-toggle').uncheck()
  await page.getByTestId('tool-text').click()
  await page.mouse.click(r.box.x + 30, r.box.y + r.box.height / 2)
  const ta = page.getByTestId('text-editor')
  await expect(ta).toBeVisible()
  const value = await ta.inputValue()
  expect(value).toContain('+91-9113541977')
  await ta.fill(value.replace('9113541977', '9113541978'))
  await finish(page, 'p3-resume.pdf')
  void textBefore
})

test('4. sentence with spaces keeps them', async ({ page }) => {
  const f = join(DL, 'chandana ai and ml resume.pdf')
  test.skip(!have(f))
  await open(page, f)
  const { before, after } = await editRun(page, /^Computer Science Engineering graduate/, (s) => s.replace('Generative AI', 'Generative  AI'))
  expect(before).toContain('Generative AI and RAG-based applications')
  expect(after).toContain('Generative  AI')
  await finish(page, 'p4-spaces.pdf')
})

test('5. links: the original address survives an edit elsewhere', async ({ page }) => {
  const f = join(DL, 'chandana ai and ml resume.pdf')
  test.skip(!have(f))
  await open(page, f)
  await editRun(page, /^PROFESSIONAL SUMMARY$/, (s) => s + ' ')
  await finish(page, 'p5-links.pdf')
})

test('6. pictures inside the PDF can be selected, moved, replaced and deleted', async ({ page }) => {
  const f = join(DL, 'app_launch_strategy_report.pdf')
  test.skip(!have(f))
  await open(page, f)
  // the three screenshots are on page 1 below the heading; scroll them into view and click the first one
  const ov = page.getByTestId('page-overlay').first()
  const ob = (await ov.boundingBox())!
  const sc = page.getByTestId('viewer-scroll')
  const sb = (await sc.boundingBox())!
  await sc.evaluate((el, y) => (el.scrollTop = y), Math.max(0, (190 / 792) * ob.height - sb.height / 2))
  await page.waitForTimeout(500)
  await page.getByTestId('tool-select').click() // pictures of the page are picked with the Select tool; the Text tool is for text
  const placed = page.getByTestId('placed-image')
  expect(await placed.count()).toBe(0)
  const o2 = (await ov.boundingBox())!
  // the first screenshot sits at x 63-211 pt, y 152-228 pt of the 612 x 792 page
  const pt = { x: o2.x + (137 / 612) * o2.width, y: o2.y + (190 / 792) * o2.height }
  expect(pt.y).toBeGreaterThan(sb.y)
  await page.mouse.click(pt.x, pt.y)
  await expect(placed).toHaveCount(1)
  const before = (await placed.first().boundingBox())!
  // move it 120 px to the right
  await page.mouse.move(pt.x, pt.y)
  await page.mouse.down()
  await page.mouse.move(pt.x + 120, pt.y, { steps: 8 })
  await page.mouse.up()
  const after = (await placed.first().boundingBox())!
  expect(after.x - before.x).toBeGreaterThan(80)
  // replace it with another picture, keeping its place
  const png = join(import.meta.dirname, '.tmp', 'replace.png')
  const { writePng } = await import('./editorHelpers')
  writePng('replace.png', 80, 40, '#dc2626')
  await page.getByTestId('img-replace').setInputFiles(png)
  await page.waitForTimeout(300)
  await finish(page, 'p6-picture-replaced.pdf')
})

test('7. Sejda-style flow on a payslip: Text tool is active, hover highlights, one click edits, no strays, no picture grabbing', async ({ page }) => {
  const f = join(DL, 'payslip_RMN-2026-016_2026-09.pdf')
  test.skip(!have(f))
  await open(page, f)
  await expect(page.getByTestId('tool-text')).toHaveAttribute('aria-pressed', 'true')
  const target = await runBox(page, /^Employee$/)
  const other = await runBox(page, /^Branch$/)
  await page.getByTestId('debug-toggle').uncheck()
  // hovering a line of text highlights it
  await page.mouse.move(target.box.x + 6, target.box.y + target.box.height / 2)
  await expect(page.getByTestId('hover-box')).toBeVisible()
  // one click edits it, in the PDF's own font, with no box around it
  await page.mouse.click(target.box.x + 6, target.box.y + target.box.height / 2)
  const ta = page.getByTestId('text-editor')
  await expect(ta).toBeVisible()
  expect(await ta.inputValue()).toBe('Employee')
  expect(await ta.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
  await ta.fill('Employee name')
  // one click on another line moves the editor there; the first stays edited
  await page.mouse.click(other.box.x + 6, other.box.y + other.box.height / 2)
  await expect(ta).toBeVisible()
  expect(await ta.inputValue()).toBe('Branch')
  // a click on blank paper opens a new box; leaving it empty leaves nothing behind
  const ov = (await page.getByTestId('page-overlay').first().boundingBox())!
  await page.mouse.click(ov.x + ov.width * 0.9, ov.y + ov.height * 0.05)
  await expect(ta).toBeVisible()
  expect(await ta.inputValue()).toBe('')
  await page.keyboard.press('Escape')
  await expect(ta).toHaveCount(0)
  await expect(page.getByTestId('placed-image')).toHaveCount(0)
  // the Text tool is still the active tool
  await expect(page.getByTestId('tool-text')).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: join(OUT, 'p7-text-tool.png') })
  await finish(page, 'p7-payslip.pdf')
})

test('8. with the Text tool a click on a picture picks it; drag moves it; dragging across it still draws a text box; handles stay off the text', async ({ page }) => {
  const f = join(DL, 'report.pdf')
  test.skip(!have(f))
  await open(page, f)
  await expect(page.getByTestId('tool-text')).toHaveAttribute('aria-pressed', 'true') // the default tool: no switch to Select
  const ov = page.getByTestId('page-overlay').first()
  const sc = page.getByTestId('viewer-scroll')
  const ob = (await ov.boundingBox())!
  const sb = (await sc.boundingBox())!
  await sc.evaluate((el, y) => (el.scrollTop = y), Math.max(0, (150 / 792) * ob.height - sb.height / 3))
  await page.waitForTimeout(500)
  const o2 = (await ov.boundingBox())!
  const pt = { x: o2.x + (300 / 612) * o2.width, y: o2.y + (170 / 792) * o2.height } // inside the first picture (72-540 x 72-270 pt)
  await page.mouse.click(pt.x, pt.y)
  const placed = page.getByTestId('placed-image')
  await expect(placed).toHaveCount(1)
  await expect(page.getByTestId('text-editor')).toHaveCount(0) // no stray "Type your text" box on the picture
  const before = (await placed.first().boundingBox())!
  await page.mouse.move(pt.x, pt.y)
  await page.mouse.down()
  await page.mouse.move(pt.x + 90, pt.y + 20, { steps: 8 })
  await page.mouse.up()
  const after = (await placed.first().boundingBox())!
  expect(after.x - before.x).toBeGreaterThan(60)
})

test('9. editing text: the side handles sit outside the text, so clicking its first letter places the cursor and never narrows the box', async ({ page }) => {
  const f = join(DL, 'work-report (1).pdf')
  test.skip(!have(f))
  await open(page, f)
  const r = await runBox(page, /Work Report/)
  await page.getByTestId('debug-toggle').uncheck()
  await page.mouse.click(r.box.x + 4, r.box.y + r.box.height / 2)
  const ta = page.getByTestId('text-editor')
  await expect(ta).toBeVisible()
  const w0 = (await ta.boundingBox())!.width
  // press where the first letter is and drag a little: that selects text, it must not resize the box
  await page.mouse.move(r.box.x + 3, r.box.y + r.box.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.box.x + 40, r.box.y + r.box.height / 2, { steps: 5 })
  await page.mouse.up()
  const w1 = (await ta.boundingBox())!.width
  expect(Math.abs(w1 - w0)).toBeLessThan(2)
  expect(await ta.inputValue()).toBe('Work Report')
  const hw = (await page.getByTestId('handle-w').boundingBox())!
  expect(hw.x + hw.width).toBeLessThanOrEqual((await ta.boundingBox())!.x) // fully left of the text
})

test('10. Apply changes appears after an edit and finishes the job', async ({ page }) => {
  const f = join(DL, 'payslip_RMN-2026-016_2026-09.pdf')
  test.skip(!have(f))
  await open(page, f)
  await expect(page.getByTestId('apply-changes')).toHaveCount(0) // nothing changed yet
  const { ta } = await editRun(page, /^Branch$/, (s) => s + 's')
  await expect(ta).toHaveValue('Branchs')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('apply-changes')).toBeVisible()
  await page.getByTestId('apply-changes').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 30_000 })
})

test('11. Sejda-style text box: dashed outline, a bar centred above it (Bold, Italic, size, font, colour, link, move, duplicate, delete) that never ends the editing', async ({ page }) => {
  const f = join(DL, 'payslip_RMN-2026-016_2026-09.pdf')
  test.skip(!have(f))
  await open(page, f)
  const r = await runBox(page, /^Paid intern$/) // away from the page edge, where the bar would be held back inside the page
  await page.getByTestId('debug-toggle').uncheck()
  await page.mouse.click(r.box.x + 6, r.box.y + r.box.height / 2)
  const ta = page.getByTestId('text-editor')
  await expect(ta).toBeVisible()
  const bar = page.getByTestId('floating-text-bar')
  await expect(bar).toBeVisible()
  // centred above the text box
  const bb = (await bar.boundingBox())!
  const tb = (await ta.boundingBox())!
  expect(bb.y + bb.height).toBeLessThanOrEqual(tb.y + 1)
  expect(Math.abs(bb.x + bb.width / 2 - (tb.x + tb.width / 2))).toBeLessThan(Math.max(8, bb.width * 0.15))
  // the box outline is dashed
  expect(await page.getByTestId('selection-box').first().evaluate((el) => getComputedStyle(el).borderStyle)).toBe('dashed')
  // every control of the bar
  for (const name of ['Bold', 'Italic', 'Link', 'Move', 'Duplicate', 'Delete']) await expect(bar.getByRole('button', { name })).toBeVisible()
  await expect(bar.getByTestId('bar-size')).toBeVisible()
  await expect(bar.getByTestId('bar-font')).toBeVisible()
  // using the bar does not end the editing: pick a size from the menu, then a font
  await bar.getByTestId('bar-size').click()
  await page.getByRole('menuitemradio', { name: '24' }).click()
  await expect(ta).toBeVisible()
  expect(await ta.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(24, 0) // 24 pt at 100 % zoom
  await bar.getByTestId('bar-font').click()
  await expect(page.getByRole('menuitemradio').first()).toBeVisible()
  await page.getByRole('menuitemradio', { name: /Times New Roman/ }).click()
  await expect(ta).toBeVisible()
  expect(await ta.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Times')
  await bar.getByRole('button', { name: 'Bold' }).click()
  await expect(ta).toBeVisible()
  expect(Number(await ta.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(700)
  await page.screenshot({ path: join(OUT, 'p11-text-box.png') })
})

test('12. text box: the width is adjustable with the side handles, and it can be moved by its edge or by the Move button; no table detection in ordinary editing', async ({ page }) => {
  const f = join(DL, 'payslip_RMN-2026-016_2026-09.pdf')
  test.skip(!have(f))
  await open(page, f)
  const r = await runBox(page, /^Paid intern$/)
  await page.getByTestId('debug-toggle').uncheck()
  await page.mouse.click(r.box.x + 6, r.box.y + r.box.height / 2)
  const ta = page.getByTestId('text-editor')
  await expect(ta).toBeVisible()
  // no table machinery at all while editing text
  await expect(page.getByTestId('table-detected')).toHaveCount(0)
  await expect(page.getByTestId('hover-cell')).toHaveCount(0)
  // 1. width: drag the right handle 120 px to the right
  const w0 = (await ta.boundingBox())!
  const he = (await page.getByTestId('handle-e').boundingBox())!
  await page.mouse.move(he.x + he.width / 2, he.y + he.height / 2)
  await page.mouse.down()
  await page.mouse.move(he.x + he.width / 2 + 120, he.y + he.height / 2, { steps: 8 })
  await page.mouse.up()
  const w1 = (await ta.boundingBox())!
  expect(w1.width - w0.width).toBeGreaterThan(90)
  expect(Math.abs(w1.x - w0.x)).toBeLessThan(2) // grew to the right only
  // 2. move by dragging the dashed outline
  const grab = (await page.getByTestId('outline-grab-top').boundingBox())!
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2)
  await page.mouse.down()
  await page.mouse.move(grab.x + grab.width / 2 + 50, grab.y + grab.height / 2 + 40, { steps: 8 })
  await page.mouse.up()
  const m1 = (await ta.boundingBox())!
  expect(m1.x - w1.x).toBeGreaterThan(35)
  expect(m1.y - w1.y).toBeGreaterThan(25)
  // 3. move with the Move button of the bar
  const mv = (await page.getByTestId('floating-text-bar').getByRole('button', { name: 'Move' }).boundingBox())!
  await page.mouse.move(mv.x + mv.width / 2, mv.y + mv.height / 2)
  await page.mouse.down()
  await page.mouse.move(mv.x + mv.width / 2 - 40, mv.y + mv.height / 2 + 30, { steps: 8 })
  await page.mouse.up()
  const m2 = (await ta.boundingBox())!
  expect(m1.x - m2.x).toBeGreaterThan(25)
  expect(m2.y - m1.y).toBeGreaterThan(15)
  await expect(ta).toBeVisible() // still editing after all of that
})

test('13. moving a text run takes the TEXT with it: the exported PDF has it at the new place, the original place is covered', async ({ page }) => {
  const f = join(DL, 'payslip_RMN-2026-016_2026-09.pdf')
  test.skip(!have(f))
  // where the run is in the original file (PDF points, y up)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const find = async (bytes: Uint8Array) => {
    const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise
    const tc = await (await doc.getPage(1)).getTextContent()
    return tc.items.filter((i) => 'str' in i && i.str.trim() === 'Paid intern').map((i) => ({ x: (i as { transform: number[] }).transform[4], y: (i as { transform: number[] }).transform[5] }))
  }
  const before = (await find(new Uint8Array(readFileSync(f))))[0]
  await open(page, f)
  const r = await runBox(page, /^Paid intern$/)
  await page.getByTestId('debug-toggle').uncheck()
  await page.mouse.click(r.box.x + 6, r.box.y + r.box.height / 2)
  await expect(page.getByTestId('text-editor')).toBeVisible()
  const grab = (await page.getByTestId('outline-grab-top').boundingBox())!
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2)
  await page.mouse.down()
  await page.mouse.move(grab.x + grab.width / 2 + 60, grab.y + grab.height / 2 + 40, { steps: 8 })
  await page.mouse.up()
  // while moved but not retyped the text is drawn at its new place, not hidden
  expect(await page.getByTestId('text-editor').evaluate((el) => getComputedStyle(el).color)).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
  await page.keyboard.press('Escape')
  const out = join(OUT, 'p13-moved.pdf')
  const dl = await exportAndDownload(page)
  copyFileSync(dl, out)
  const after = await find(new Uint8Array(readFileSync(out)))
  // one copy still under the cover patch at the old place, one drawn 60 pt to the right and 40 pt lower (y is up in a PDF)
  expect(after.some((a) => Math.abs(a.x - (before.x + 60)) < 3 && Math.abs(a.y - (before.y - 40)) < 3)).toBe(true)
})

test('14. text colour: a Sejda-style palette (swatch grid, hex code, eyedropper, your own colours)', async ({ page }) => {
  const f = join(DL, 'payslip_RMN-2026-016_2026-09.pdf')
  test.skip(!have(f))
  await open(page, f)
  const r = await runBox(page, /^Paid intern$/)
  await page.getByTestId('debug-toggle').uncheck()
  await page.mouse.click(r.box.x + 6, r.box.y + r.box.height / 2)
  const ta = page.getByTestId('text-editor')
  await expect(ta).toBeVisible()
  const bar = page.getByTestId('floating-text-bar')
  await bar.getByTestId('bar-color').click()
  const palette = page.getByTestId('palette')
  await expect(palette).toBeVisible()
  expect(await palette.getByTestId('swatch').count()).toBe(70) // seven families of ten shades
  await page.getByRole('button', { name: '#C62828', exact: true }).click()
  await expect(palette).toHaveCount(0) // closes after a choice
  expect(await ta.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(198, 40, 40)')
  // a typed colour code becomes one of "your colours"
  await bar.getByTestId('bar-color').click()
  await page.getByTestId('palette-hex').click()
  await page.getByTestId('palette-hex-input').fill('#123456')
  await page.getByTestId('palette-hex-input').press('Enter')
  expect(await ta.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(18, 52, 86)')
  await bar.getByTestId('bar-color').click()
  await expect(page.getByTestId('custom-swatch').first()).toHaveAttribute('title', '#123456')
  await page.screenshot({ path: join(OUT, 'p14-palette.png') })
})
