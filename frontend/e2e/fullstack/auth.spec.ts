import { expect, test } from '@playwright/test'
import { watchErrors } from '../helpers'
import { fx, upload } from './helpers'

test('register, sign out, sign in with the real backend; server tools need a login', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/compress-pdf')
  // not signed in: the tool says so and cannot run
  await expect(page.getByTestId('gate-sign-in')).toBeVisible()
  await upload(page, fx('multipage.pdf'))
  await expect(page.getByTestId('file-row')).toHaveCount(1)
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await expect(page.getByText('This tool uploads your file to our server')).toBeVisible()
  await expect(page.getByText(/after 60 minutes at the latest/)).toBeVisible() // TTL comes from /api/system/capabilities

  // create an account through the dialog
  const email = `ui-${Date.now()}@example.com`
  await page.getByTestId('gate-sign-in').click()
  await expect(page.getByTestId('auth-dialog')).toBeVisible()
  await page.getByTestId('auth-switch').click()
  await page.getByTestId('auth-email').fill(email)
  await page.getByTestId('auth-password').fill('short') // < 8 chars: backend validation error is shown
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('auth-error')).toBeVisible()
  await page.getByTestId('auth-password').fill('a-long-enough-password')
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('auth-dialog')).toBeHidden()
  await expect(page.getByTestId('user-menu')).toContainText(email)
  await expect(page.getByTestId('run-button')).toBeEnabled()

  // reload keeps the session (sessionStorage), logout clears it
  await page.reload()
  await expect(page.getByTestId('user-menu')).toBeVisible()
  await page.getByTestId('logout').click()
  await expect(page.getByTestId('sign-in')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('sign-in')).toBeVisible()

  // wrong password, then the right one
  await page.getByTestId('sign-in').click()
  await page.getByTestId('auth-email').fill(email)
  await page.getByTestId('auth-password').fill('wrong-password-123')
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('auth-error')).toContainText(/password/i)
  await page.getByTestId('auth-password').fill('a-long-enough-password')
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('user-menu')).toContainText(email)
  // the only console errors allowed are the expected HTTP 4xx of the failed registration/login attempts
  expect(errors.filter((e) => !/status of (4\d\d)/.test(e))).toEqual([])
})

test('browser-only tools never ask for a login and never call the backend', async ({ page }) => {
  const api: string[] = []
  page.on('request', (r) => r.url().includes('/api/') && api.push(r.url()))
  await page.goto('/rotate-pdf')
  await upload(page, fx('multipage.pdf'))
  await expect(page.getByTestId('file-row')).toHaveCount(1)
  await expect(page.getByText('Your files stay on this device')).toBeVisible()
  expect(api).toEqual([])
})

test('a server tool is blocked with a clear message when the program is missing on the server (simulated capabilities)', async ({ page }) => {
  // UI-rendering check only: the capabilities response is overridden to say Ghostscript is missing.
  await page.route('**/api/system/capabilities', async (route) => {
    const real = await (await route.fetch()).json()
    real.programs.gs = { ...real.programs.gs, available: false, install: 'brew install ghostscript' }
    real.tools.compress = false
    await route.fulfill({ json: real })
  })
  await page.goto('/compress-pdf')
  await expect(page.getByTestId('tool-missing')).toContainText('brew install ghostscript')
  await upload(page, fx('multipage.pdf'))
  await expect(page.getByTestId('run-button')).toBeDisabled()
})

test('sign-up and sign-in pages: create account, return to the tool, sign out, wrong password, safe redirect', async ({ page }) => {
  const errors = watchErrors(page)
  const email = `page-${Date.now()}@example.com`
  const password = 'demo-password-123'

  // header "Sign in" goes to the /login page and remembers where you were
  await page.goto('/compress-pdf')
  await page.getByTestId('sign-in').click()
  await expect(page).toHaveURL(/\/login\?next=%2Fcompress-pdf$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()

  // switch to sign-up (URL changes, next is kept), create an account, land back on the tool signed in
  await page.getByTestId('auth-switch').click()
  await expect(page).toHaveURL(/\/signup\?next=%2Fcompress-pdf$/)
  await page.getByTestId('auth-name').fill('Demo User')
  await page.getByTestId('auth-email').fill(email)
  await page.getByTestId('auth-password').fill(password)
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.getByTestId('auth-password')).toHaveAttribute('type', 'text')
  await page.getByTestId('auth-submit').click()
  await expect(page).toHaveURL(/\/compress-pdf$/)
  await expect(page.getByTestId('user-menu')).toContainText('Demo User')
  await expect(page.getByTestId('gate-sign-in')).toHaveCount(0)

  // signing up twice with the same email is refused with a clear message
  await page.getByTestId('logout').click()
  await page.goto('/signup')
  await page.getByTestId('auth-email').fill(email)
  await page.getByTestId('auth-password').fill(password)
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('auth-error')).toContainText(/already exists/i)

  // wrong password, then the right one; an off-site ?next= is ignored (no open redirect)
  await page.goto('/login?next=//evil.example.com')
  await page.getByTestId('auth-email').fill(email)
  await page.getByTestId('auth-password').fill('not-the-password')
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('auth-error')).toContainText(/password/i)
  await page.getByTestId('auth-password').fill(password)
  await page.getByTestId('auth-submit').click()
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$|localhost:\d+\/$/)
  await expect(page.getByTestId('user-menu')).toContainText('Demo User')

  // visiting /login while signed in says so
  await page.goto('/login')
  await expect(page.getByTestId('auth-signed-in')).toContainText(email)
  expect(errors.filter((e) => !/status of (4\d\d)/.test(e))).toEqual([])
})
