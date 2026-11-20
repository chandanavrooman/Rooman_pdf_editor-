import { pickTool } from './editorHelpers'
import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { renderPixels } from '../src/test/nodeRender'

const FILE = resolve(import.meta.dirname, '../../tests/fixtures/three-pages.pdf')

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

test('Colour picker: presets, HEX, copy, advanced; no native colour input; the PDF gets exactly that colour', async ({ page }) => {
  await page.goto('/page-border')
  await page.getByTestId('file-input').first().setInputFiles(FILE)
  const trigger = page.locator('button[aria-haspopup=dialog]').first()
  await expect(trigger).toBeVisible()
  await expect(page.locator('input[type=color]')).toHaveCount(0)

  await trigger.click()
  const current = page.getByTestId('color-current')
  await expect(page.getByTestId('color-advanced')).toHaveCount(0) // compact by default
  await expect(page.locator('[data-testid^=preset-]')).toHaveCount(10)

  // one click on a preset; the selected one is marked
  await page.getByTestId('preset-teal').click()
  await expect(current).toHaveText('#1A9A8A')
  await expect(page.getByTestId('preset-teal')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('preset-red').click()
  await expect(page.getByTestId('preset-teal')).toHaveAttribute('aria-pressed', 'false')
  await expect(trigger).toHaveAttribute('aria-label', 'Color: #C3291E')

  // typing: valid values apply at once, short form too; invalid ones are refused with a message
  await page.getByTestId('color-hex').fill('#27449A')
  await expect(current).toHaveText('#27449A')
  await page.getByTestId('color-hex').fill('#0f0')
  await expect(current).toHaveText('#00FF00')
  await page.getByTestId('color-hex').fill('#12')
  await expect(page.getByRole('alert')).toContainText('Not a colour yet')
  await expect(current).toHaveText('#00FF00')
  await page.getByTestId('color-hex').blur()
  await expect(page.getByTestId('color-hex')).toHaveValue('#00FF00')

  // copy
  await page.getByTestId('color-copy').click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#00FF00')

  // advanced: spectrum, hue, RGB
  await page.getByTestId('color-more').click()
  await expect(page.getByTestId('color-advanced')).toBeVisible()
  await page.getByTestId('color-hue').fill('240')
  await expect(current).not.toHaveText('#00FF00')
  await page.getByTestId('color-r').fill('39')
  await page.getByTestId('color-g').fill('68')
  await page.getByTestId('color-b').fill('154')
  await expect(current).toHaveText('#27449A')
  await page.getByTestId('color-r').fill('300')
  await expect(current).toHaveText('#27449A') // 300 is not a colour value

  // keyboard: arrows move between presets, Escape closes and gives the focus back
  await page.getByTestId('preset-blue').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('preset-teal')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('color-picker')).toHaveCount(0)
  await expect(trigger).toBeFocused()

  // the colour the user typed is the colour in the file
  await trigger.click()
  await page.getByTestId('color-hex').fill('#c3291e')
  await page.keyboard.press('Escape')
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 30_000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const bytes = new Uint8Array(readFileSync((await dl.path())!))
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3)
  const px = await renderPixels(bytes, 0, 3)
  let exact = 0
  for (let i = 0; i < px.data.length; i += 4) if (px.data[i] === 195 && px.data[i + 1] === 41 && px.data[i + 2] === 30) exact++
  expect(exact).toBeGreaterThan(200) // the border line is #C3291E to the digit
})

test('Colour picker in the editor: property bar and floating toolbar use it too, and it stays on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/edit')
  await page.getByTestId('file-input').first().setInputFiles(FILE)
  await expect(page.getByTestId('page-overlay').first()).toBeVisible()
  await expect(page.locator('input[type=color]')).toHaveCount(0)
  await pickTool(page, 'rect')
  await page.getByTestId('prop-stroke').click()
  const box = (await page.getByTestId('color-picker').boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(800)
  await page.getByTestId('preset-purple').click()
  await expect(page.getByTestId('prop-stroke')).toHaveAttribute('aria-label', 'Outline: #7C3AED')
  await page.keyboard.press('Escape')
  await pickTool(page, 'table')
  await expect(page.locator('input[type=color]')).toHaveCount(0)
})
