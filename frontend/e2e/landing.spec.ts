import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers'

test('the first page is Edit PDF', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/localhost:\d+\/$/) // no redirect: the home page itself is the Edit PDF page
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit PDF')
  await expect(page.getByText('Choose a PDF to edit')).toBeVisible()
})

test('tools directory: search, honest badges, light/dark screenshots', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/tools')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('All tools')
  await expect(page.getByText('Drop PDF files to get started')).toHaveCount(0) // the directory is the whole page
  await expect(page.getByTestId('tool-card-merge-pdf')).toContainText('Runs in your browser')
  await expect(page.getByTestId('tool-card-compress-pdf')).toContainText('Uploads file to server')
  await expect(page.getByTestId('tool-card-compress-pdf')).not.toContainText('Not available yet')
  await expect(page.getByTestId('tool-card-pdf-to-jpg')).toContainText('Uploads file to server') // PDF→JPG/PNG/text run on the server
  await expect(page.getByText('Not available yet')).toHaveCount(0) // every listed tool is implemented

  await page.getByTestId('tool-search').fill('combine')
  await expect(page.getByTestId('tool-card-merge-pdf')).toBeVisible()
  await expect(page.getByTestId('tool-card-split-pdf')).toHaveCount(0)
  await page.getByTestId('tool-search').fill('zzzzz')
  await expect(page.getByRole('status')).toContainText('No tools match')
  await page.getByTestId('tool-search').fill('')

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({ path: 'e2e/screenshots/landing-light.png' })
  await page.getByRole('button', { name: /switch to dark mode/i }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.screenshot({ path: 'e2e/screenshots/landing-dark.png' })
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/) // persisted
  await page.setViewportSize({ width: 390, height: 800 })
  await page.screenshot({ path: 'e2e/screenshots/landing-mobile-dark.png', fullPage: false })
  expect(errors).toEqual([])
})

test('a server tool page is reachable without a backend and tells the user to sign in (honest gate)', async ({ page }) => {
  await page.route('**/api/system/capabilities', (r) => r.abort())
  await page.goto('/compress-pdf')
  await expect(page.getByText('Sign in to use server tools')).toBeVisible()
})

test('rejects a file that is not a PDF even if named .pdf', async ({ page }) => {
  await page.goto('/merge-pdf')
  await page.getByTestId('file-input').first().setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is not a pdf at all') })
  await expect(page.getByRole('alert')).toContainText('not a valid PDF')
})
