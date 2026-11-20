import { expect, test, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { unzipSync } from 'fflate'
import { statSync } from 'node:fs'
import { pageTexts } from '../../src/test/pdfText'
import { watchErrors } from '../helpers'
import { FAKE_LLM, bytesOf, fx, signIn, upload } from './helpers'

// Every test in this file talks to the SCRIPTED MODEL (TEST DOUBLE) at :8102 — there is no real AI model involved.
// Everything after the model (SSE streaming, citations, MCP tool calls, confirmations, PDF processing, downloads) is real.

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

async function openChat(page: Page, file = fx('multipage.pdf')) {
  await page.goto('/ai-chat')
  await upload(page, file)
  await expect(page.getByTestId('chat-input')).toBeEnabled({ timeout: 30_000 }) // enabled once the file is on the server
}

async function ask(page: Page, text: string) {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send').click()
}

async function download(page: Page, name: string | RegExp) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId('chat-download').filter({ hasText: name }).first().click()])
  const path = await d.path()
  if (!path) throw new Error('no download')
  return path
}

test('scripted model (test double): chat with a PDF streams an answer and [p. N] chips scroll the viewer', async ({ page }) => {
  const errors = watchErrors(page)
  await openChat(page)
  await expect(page.getByText('Your file is uploaded to the server')).toBeVisible()
  await ask(page, 'What is in chapter 2?')
  const text = page.getByTestId('assistant-text').last()
  await expect(text).toContainText('Chapter 2 is described on')
  const chip = text.getByTestId('citation-chip').filter({ hasText: 'p. 2' })
  await expect(chip).toBeVisible()
  await expect(page.getByLabel('Page number')).toHaveValue('1')
  await chip.click()
  await expect(page.getByLabel('Page number')).toHaveValue('2')
  // the backend verified the cited pages and returned them as structured citations
  await expect(page.getByTestId('citations')).toContainText('p. 2')
  // the model really got the user's key and the configured model name
  const stats = await (await fetch(`${FAKE_LLM}/__stats`)).json()
  expect(stats.lastAuth).toBe('Bearer test-key-not-a-real-key')
  expect(stats.lastModel).toBe('scripted-model')
  // conversation history is sent along on the next turn
  await ask(page, 'And the introduction?')
  await expect(page.getByTestId('assistant-message')).toHaveCount(2)
  expect(errors).toEqual([])
})

test('scripted model (test double): "extract pages 1-3, then compress it" runs two real MCP tools and yields a downloadable 3-page PDF', async ({ page }) => {
  await openChat(page)
  const original = statSync(fx('multipage.pdf')).size
  await ask(page, 'Please extract pages 1-3, then compress it.')
  const cards = page.getByTestId('tool-card')
  await expect(cards).toHaveCount(2, { timeout: 90_000 })
  await expect(cards.nth(0)).toHaveAttribute('data-tool', 'extract_pages')
  await expect(cards.nth(1)).toHaveAttribute('data-tool', 'compress_pdf')
  await expect(cards.nth(0)).toHaveAttribute('data-status', 'ok')
  await expect(cards.nth(1)).toHaveAttribute('data-status', 'ok')
  await expect(cards.nth(0)).toContainText('page count 3 as expected') // result verification shown to the user
  await expect(page.getByTestId('assistant-text').last()).toContainText('compressed')
  const path = await download(page, /\.pdf/)
  const doc = await PDFDocument.load(bytesOf(path))
  expect(doc.getPageCount()).toBe(3)
  expect(statSync(path).size).toBeLessThan(original)
  expect((await pageTexts(bytesOf(path)))[2]).toContain('Chapter 3')
})

test('scripted model (test double): a destructive tool waits for confirmation, then deletes the pages for real', async ({ page }) => {
  await openChat(page)
  await ask(page, 'Please delete pages 1,2 from this file.')
  const confirmation = page.getByTestId('confirmation')
  await expect(confirmation).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('confirmation-message')).toContainText('multipage.pdf')
  // nothing has run yet: no finished tool card and no download
  await expect(page.getByTestId('chat-download')).toHaveCount(0)
  await expect(page.locator('[data-testid=tool-card][data-status=ok]')).toHaveCount(0)
  await page.getByTestId('confirm-approve').click()
  await expect(page.locator('[data-testid=tool-card][data-tool=delete_pages][data-status=ok]')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('assistant-text').last()).toContainText('removed pages 1 and 2')
  const path = await download(page, /\.pdf/)
  const texts = await pageTexts(bytesOf(path))
  expect(texts).toHaveLength(10)
  expect(texts[0]).toContain('Chapter 3')
})

test('scripted model (test double): cancelling a destructive action does nothing', async ({ page }) => {
  await openChat(page)
  await ask(page, 'Please delete pages 1,2 from this file.')
  await expect(page.getByTestId('confirmation')).toBeVisible({ timeout: 60_000 })
  await page.getByTestId('confirm-decline').click()
  await expect(page.getByTestId('assistant-text').last()).toContainText('did not delete anything', { timeout: 60_000 })
  await expect(page.getByTestId('chat-download')).toHaveCount(0)
  await expect(page.getByTestId('confirmation')).toContainText('You cancelled this action')
})

test('scripted model (test double): Summarize streams a summary; the text can be downloaded', async ({ page }) => {
  await page.goto('/summarize-pdf')
  await upload(page, fx('multipage.pdf'))
  await expect(page.getByText('uploaded', { exact: false }).first()).toBeVisible()
  await page.getByTestId('ai-run').click()
  await expect(page.getByTestId('ai-text')).toContainText('scripted answer', { timeout: 60_000 })
  await expect(page.getByTestId('edit-again')).toBeVisible()
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-text').click()])
  expect(new TextDecoder().decode(bytesOf((await d.path())!))).toContain('scripted answer')
})

test('scripted model (test double): Ask questions answers with a page citation chip', async ({ page }) => {
  await page.goto('/ask-pdf')
  await upload(page, fx('multipage.pdf'))
  await page.getByTestId('ask-question').fill('What is in chapter 2?')
  await page.getByTestId('ai-run').click()
  await expect(page.getByTestId('ai-text')).toContainText('Chapter 2 is described on', { timeout: 60_000 })
  await page.getByTestId('ai-text').getByTestId('citation-chip').filter({ hasText: 'p. 2' }).click()
  await expect(page.getByLabel('Page number')).toHaveValue('2')
})

test('scripted model (test double): Translate streams per page and creates a downloadable Word file', async ({ page }) => {
  await page.goto('/translate-pdf')
  await upload(page, fx('table.pdf'))
  await page.getByTestId('translate-lang').fill('Spanish')
  await page.getByTestId('ai-run').click()
  await expect(page.getByTestId('ai-text')).toContainText('scripted answer', { timeout: 60_000 })
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-document').click()])
  expect(d.suggestedFilename()).toMatch(/\.docx$/)
  const entries = Object.keys(unzipSync(bytesOf((await d.path())!)))
  expect(entries).toContain('word/document.xml')
})

test('scripted model (test double): Explain needs a page or a passage, then streams an explanation', async ({ page }) => {
  await page.goto('/explain-pdf')
  await upload(page, fx('multipage.pdf'))
  await expect(page.getByTestId('ai-run')).toBeDisabled()
  await page.getByTestId('explain-page').fill('2')
  await expect(page.getByTestId('ai-run')).toBeEnabled({ timeout: 30_000 })
  await page.getByTestId('ai-run').click()
  await expect(page.getByTestId('ai-text')).toContainText('scripted answer', { timeout: 60_000 })
})

test('scripted model (test double): Compare shows a real diff, the AI summary comes from the double', async ({ page }) => {
  await page.goto('/compare-pdf')
  await upload(page, [fx('multipage.pdf'), fx('table.pdf')])
  await expect(page.getByTestId('ai-file-row')).toHaveCount(2)
  await page.getByTestId('ai-run').click()
  await expect(page.getByTestId('diff-view')).toBeVisible({ timeout: 60_000 })
  expect(await page.getByTestId('diff-change').count()).toBeGreaterThan(0)
  await expect(page.getByTestId('diff-summary')).toContainText(/\d+ changes?/)
  await expect(page.getByTestId('ai-text')).toContainText('scripted answer')
})
