import { expect, test } from '@playwright/test'
import { watchErrors } from '../helpers'
import { NOKEY_BACKEND, bytesOf, fx, runAndSave, signIn, upload, xlsxText } from './helpers'

// This project runs against a backend started WITHOUT AI_API_KEY.

test.beforeEach(async ({ page }) => {
  await signIn(page, NOKEY_BACKEND)
})

test('AI chat shows a clear "no AI key" error instead of failing silently', async ({ page }) => {
  await page.goto('/ai-chat')
  await expect(page.getByTestId('ai-key-missing')).toContainText('The server has no AI key configured: set AI_API_KEY in .env')
  await upload(page, fx('multipage.pdf'))
  await expect(page.getByTestId('chat-input')).toBeEnabled({ timeout: 30_000 })
  await page.getByTestId('chat-input').fill('Summarize this')
  await page.getByTestId('chat-send').click()
  const err = page.getByTestId('ai-error')
  await expect(err).toBeVisible()
  await expect(err).toHaveAttribute('data-code', 'AI_KEY_MISSING')
  await expect(err).toContainText('set AI_API_KEY in .env')
})

test('Summarize is blocked with the same message when no key is configured', async ({ page }) => {
  await page.goto('/summarize-pdf')
  await expect(page.getByTestId('ai-key-missing')).toBeVisible()
  await upload(page, fx('multipage.pdf'))
  await expect(page.getByTestId('ai-run')).toBeDisabled()
})

test('Extract tables to Excel works without any AI key', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/extract-tables')
  await upload(page, fx('table.pdf'))
  const out = await runAndSave(page)
  expect(out.name).toMatch(/\.xlsx$/)
  const shared = xlsxText(out.path)
  for (const cell of ['Item', 'Region', 'Widget', 'Thingamajig']) expect(shared).toContain(cell)
  expect(bytesOf(out.path).byteLength).toBeGreaterThan(1000)
  await expect(page.getByTestId('result-info').first()).toContainText('table')
  expect(errors).toEqual([])
})

test('Compare works without an AI key when the AI summary is switched off', async ({ page }) => {
  await page.goto('/compare-pdf')
  await upload(page, [fx('multipage.pdf'), fx('table.pdf')])
  await expect(page.getByTestId('ai-file-row')).toHaveCount(2)
  await expect(page.getByTestId('ai-run')).toBeDisabled() // AI summary is on by default but impossible
  await page.getByRole('checkbox', { name: /summary of the differences with AI/ }).uncheck()
  await expect(page.getByTestId('ai-run')).toBeEnabled({ timeout: 30_000 })
  await page.getByTestId('ai-run').click()
  await expect(page.getByTestId('diff-view')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('diff-summary')).toContainText(/\d+ changes?/)
  expect(await page.getByTestId('diff-change').count()).toBeGreaterThan(0)
  await expect(page.getByTestId('ai-error')).toHaveCount(0)
})
