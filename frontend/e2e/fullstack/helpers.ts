import { expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { unzipSync } from 'fflate'

export const BACKEND = 'http://127.0.0.1:8100'
export const NOKEY_BACKEND = 'http://127.0.0.1:8110'
export const FAKE_LLM = 'http://127.0.0.1:8102'
export const fx = (name: string) => resolve(join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', name))

let counter = 0
export interface Session {
  token: string
  user: { id: string; email: string; name: string | null }
  expires_in: number
}

/** Create a real user on the backend (registration API). */
export async function registerUser(backend = BACKEND): Promise<Session & { email: string; password: string }> {
  const email = `e2e-${Date.now()}-${++counter}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const password = 'correct horse battery'
  const res = await fetch(`${backend}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name: 'E2E' }) })
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; expires_in: number; user: Session['user'] }
  return { token: body.access_token, user: body.user, expires_in: body.expires_in, email, password }
}

/** Register a user on the API and start the page already signed in (same storage the app uses after a real login). */
export async function signIn(page: Page, backend = BACKEND) {
  const s = await registerUser(backend)
  await page.addInitScript(
    ([k, v]) => {
      try {
        sessionStorage.setItem(k, v)
      } catch {
        /* ignore */
      }
    },
    ['rooman.auth.v1', JSON.stringify({ token: s.token, user: s.user, expiresAt: Date.now() + s.expires_in * 1000 })],
  )
  return s
}

export async function upload(page: Page, files: string | string[]) {
  await page.getByTestId('file-input').first().setInputFiles(files)
}

/** Click Run, wait for the result panel, return the path of the downloaded result file. */
export async function runAndSave(page: Page): Promise<{ path: string; name: string }> {
  await expect(page.getByTestId('run-button')).toBeEnabled({ timeout: 30_000 })
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 150_000 })
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const path = await download.path()
  if (!path) throw new Error('download failed')
  return { path, name: download.suggestedFilename() }
}

export const bytesOf = (path: string) => new Uint8Array(readFileSync(path))

export function unzipText(path: string, entry: string): string {
  const files = unzipSync(bytesOf(path))
  const f = files[entry]
  if (!f) throw new Error(`${entry} not in zip; has: ${Object.keys(files).join(', ')}`)
  return new TextDecoder().decode(f)
}
export const zipEntries = (path: string) => Object.keys(unzipSync(bytesOf(path)))

/** All text stored in an .xlsx (shared strings and inline strings in every worksheet). */
export function xlsxText(path: string): string {
  const files = unzipSync(bytesOf(path))
  return Object.entries(files)
    .filter(([n]) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .map(([, b]) => new TextDecoder().decode(b))
    .join('\n')
}
