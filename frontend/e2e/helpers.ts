import { expect, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(import.meta.dirname, '.tmp')
mkdirSync(DIR, { recursive: true })

/** Create a real PDF on disk; page i says "<label> page i". */
export async function writePdf(name: string, pages: number, label = name): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595, 842])
    p.drawText(`${label} page ${i}`, { x: 60, y: 760, size: 28, font })
  }
  const path = join(DIR, name)
  writeFileSync(path, await doc.save())
  return path
}

export async function pageCountOf(path: string): Promise<number> {
  return (await PDFDocument.load(readFileSync(path))).getPageCount()
}

/** Collect console errors / page errors so tests can assert the app stayed clean. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

export async function runAndDownload(page: Page): Promise<string> {
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const path = await download.path()
  if (!path) throw new Error('download failed')
  return path
}
