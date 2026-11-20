import { expect, test } from '@playwright/test'

test('AI PDF opens the assistant, whose menu lists every AI feature', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto('/')
  await page.getByRole('link', { name: 'AI PDF', exact: true }).first().click()
  await expect(page).toHaveURL(/\/ai-assistant$/)
  await expect(page.getByRole('heading', { name: 'AI PDF Assistant' })).toBeVisible()
  const menu = page.getByTestId('ai-menu')
  for (const name of ['AI PDF Assistant', 'Chat with PDF', 'Ask questions', 'Summarize PDF', 'Translate PDF', 'Generate questions', 'Explain PDF', 'Extract tables to Excel', 'Compare documents']) {
    await expect(menu.getByRole('link', { name })).toBeVisible()
  }
  await expect(menu.getByRole('link', { name: 'AI PDF Assistant' })).toHaveAttribute('aria-current', 'page')
  // no model selector anywhere: one centrally configured model
  await expect(page.getByRole('combobox', { name: /model/i })).toHaveCount(0)
  // nothing can be sent before a PDF is added
  await expect(page.getByTestId('chat-input')).toBeDisabled()
  await expect(page.getByTestId('chat-send')).toBeDisabled()
  await page.screenshot({ path: 'e2e/.tmp/ai-assistant.png' })
})

test('Generate questions page has its options and opens from the menu', async ({ page }) => {
  await page.goto('/ai-assistant')
  await page.getByTestId('ai-menu').getByRole('link', { name: 'Generate questions' }).click()
  await expect(page).toHaveURL(/\/generate-questions$/)
  await expect(page.getByRole('heading', { name: 'Generate questions' })).toBeVisible()
})
