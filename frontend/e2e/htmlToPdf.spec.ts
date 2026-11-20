import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

test('HTML to PDF: takes an .html file and offers its page options', async ({ page }) => {
  const f = join(import.meta.dirname, '.tmp', 'page.html')
  writeFileSync(f, '<h1>Hello</h1><p>World</p>')
  await page.goto('/html-to-pdf')
  await expect(page.getByRole('heading', { name: 'HTML to PDF' })).toBeVisible()
  await page.getByTestId('file-input').first().setInputFiles(f)
  await expect(page.getByTestId('file-row')).toContainText('page.html')
  await expect(page.getByText('Orientation')).toBeVisible()
  await expect(page.getByText(/scripts are not run/)).toBeVisible()
})
