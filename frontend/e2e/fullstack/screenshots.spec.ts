import { expect, test } from '@playwright/test'
import { fx, signIn, upload } from './helpers'

// Visual evidence for the server-tool and AI screens (light + dark). Written to e2e/screenshots (git-ignored).
test('screenshots: auth dialog, a server tool, chat, compare', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/compress-pdf')
  await page.getByTestId('gate-sign-in').click()
  await expect(page.getByTestId('auth-dialog')).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/auth-dialog-light.png' })
  await page.keyboard.press('Escape')
  await page.getByTestId('sign-in').click()
  await expect(page.getByTestId('auth-page')).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/auth-page-light.png' })

  await signIn(page)
  await page.goto('/compress-pdf')
  await upload(page, fx('large.pdf'))
  await expect(page.getByTestId('run-button')).toBeEnabled()
  await page.screenshot({ path: 'e2e/screenshots/compress-options-light.png', fullPage: true })
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 60_000 })
  await page.screenshot({ path: 'e2e/screenshots/compress-result-light.png', fullPage: true })

  await page.goto('/ai-chat')
  await upload(page, fx('multipage.pdf'))
  await expect(page.getByTestId('chat-input')).toBeEnabled({ timeout: 30_000 })
  await page.getByTestId('chat-input').fill('What is in chapter 2?')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('citation-chip').first()).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/chat-light.png' })
  await page.getByRole('button', { name: /switch to dark mode/i }).click()
  await page.screenshot({ path: 'e2e/screenshots/chat-dark.png' })

  await page.goto('/compare-pdf')
  await upload(page, [fx('multipage.pdf'), fx('table.pdf')])
  await expect(page.getByTestId('ai-file-row')).toHaveCount(2)
  await page.getByTestId('ai-run').click()
  await expect(page.getByTestId('diff-view')).toBeVisible({ timeout: 60_000 })
  await page.screenshot({ path: 'e2e/screenshots/compare-dark.png', fullPage: true })
})
