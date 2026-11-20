import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { pickTool } from './editorHelpers'

const REPORT = resolve(import.meta.dirname, '../../tests/fixtures/chandana-report.pdf')

test('Table tool: detected cells show, rows and columns can be added, deleted and resized', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 })
  await page.goto('/edit')
  await page.getByTestId('file-input').setInputFiles(REPORT)
  await expect(page.getByTestId('page-overlay').first()).toBeVisible()
  await page.getByTestId('zoom-preset').selectOption('1')
  await page.waitForTimeout(1200)

  await pickTool(page, 'table')
  await expect(page.getByTestId('table-detected')).toHaveCount(1)
  expect(await page.getByTestId('table-detected-cell').count()).toBeGreaterThanOrEqual(20)

  await page.getByTestId('table-detected-cell').nth(4).click({ force: true })
  const active = page.getByTestId('table-active')
  await expect(active).toContainText('of 10, column 1 of 2')
  const rows = async () => page.locator('[data-testid^=row-handle-]').count()
  const cols = async () => page.locator('[data-testid^=col-handle-]').count()
  expect([await rows(), await cols()]).toEqual([10, 2])

  await page.getByTestId('tbl-row-below').click()
  expect(await rows()).toBe(11)
  await page.getByTestId('tbl-row-above').click()
  expect(await rows()).toBe(12)
  await page.getByTestId('tbl-col-right').click()
  expect(await cols()).toBe(3)
  await page.getByTestId('tbl-col-left').click()
  expect(await cols()).toBe(4)
  await page.getByTestId('tbl-del-row').click()
  expect(await rows()).toBe(11)
  await page.getByTestId('tbl-del-col').click()
  expect(await cols()).toBe(3)

  // drag a column boundary 60 px to the right and a row boundary 24 px down
  const sc = await page.getByTestId('viewer-scroll').boundingBox()
  const x0 = (await page.getByTestId('col-handle-0').boundingBox())!
  const cy = Math.max(x0.y, sc!.y) + 60
  await page.mouse.move(x0.x + 4, cy)
  await page.mouse.down()
  await page.mouse.move(x0.x + 64, cy, { steps: 8 })
  await page.mouse.up()
  const x1 = (await page.getByTestId('col-handle-0').boundingBox())!
  expect(x1.x - x0.x).toBeGreaterThan(40)
  const r0 = (await page.getByTestId('row-handle-1').boundingBox())!
  await page.mouse.move(r0.x + 40, r0.y + 4)
  await page.mouse.down()
  await page.mouse.move(r0.x + 40, r0.y + 28, { steps: 8 })
  await page.mouse.up()
  const r1 = (await page.getByTestId('row-handle-1').boundingBox())!
  expect(r1.y - r0.y).toBeGreaterThan(15)
})
