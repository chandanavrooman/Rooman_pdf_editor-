import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'
import { pageCountOf, runAndDownload, writePdf } from './helpers'

const DIR = join(import.meta.dirname, '.tmp')

function png(w: number, h: number, color: string): Uint8Array {
  const c = createCanvas(w, h)
  const x = c.getContext('2d')
  x.fillStyle = color
  x.fillRect(0, 0, w, h)
  x.fillStyle = '#fff'
  x.fillRect(4, 4, w / 3, h / 3)
  return new Uint8Array(c.toBuffer('image/png'))
}

test('Extract images: each picture comes out as a PNG, tiny ones are skipped', async ({ page }) => {
  const d = await PDFDocument.create()
  const p = d.addPage([400, 400])
  p.drawImage(await d.embedPng(png(200, 120, '#16a34a')), { x: 20, y: 250, width: 200, height: 120 })
  p.drawImage(await d.embedPng(png(150, 150, '#2563eb')), { x: 20, y: 60, width: 150, height: 150 })
  p.drawImage(await d.embedPng(png(16, 16, '#dc2626')), { x: 300, y: 60, width: 16, height: 16 })
  const f = join(DIR, 'imgs.pdf')
  writeFileSync(f, await d.save())
  await page.goto('/extract-images')
  await page.getByTestId('file-input').first().setInputFiles(f)
  await expect(page.getByTestId('file-row')).toContainText('page')
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 30_000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const files = unzipSync(new Uint8Array(readFileSync((await dl.path())!)))
  const names = Object.keys(files).sort()
  expect(names).toHaveLength(2)
  for (const n of names) expect(n).toMatch(/imgs-page-1-image-\d\.png$/)
  // real PNG data
  for (const u of Object.values(files)) expect(Array.from(u.slice(1, 4))).toEqual([0x50, 0x4e, 0x47])
})

test('Remove annotations: marks go, links stay unless asked', async ({ page }) => {
  const d = await PDFDocument.create()
  const p = d.addPage([300, 300])
  const mk = (sub: string, extra: Record<string, unknown> = {}) => d.context.register(d.context.obj({ Type: 'Annot', Subtype: sub, Rect: [10, 10, 90, 30], ...extra }))
  p.node.set(PDFName.of('Annots'), d.context.obj([mk('Highlight'), mk('Text', { Contents: 'note' }), mk('Link', { A: { S: 'URI', URI: 'https://example.com' } })]))
  const f = join(DIR, 'annots.pdf')
  writeFileSync(f, await d.save())
  await page.goto('/remove-annotations')
  await page.getByTestId('file-input').first().setInputFiles(f)
  await expect(page.getByTestId('file-row')).toContainText('page')
  const out = await runAndDownload(page)
  const doc = await PDFDocument.load(readFileSync(out))
  const a = doc.getPage(0).node.Annots()!
  expect(a.size()).toBe(1)
  expect((a.lookup(0, PDFDict).get(PDFName.of('Subtype')) as PDFName).decodeText()).toBe('Link')
})

test('Create bookmarks: typed list becomes an outline; bad lines are explained', async ({ page }) => {
  const f = await writePdf('bm.pdf', 6, 'Chapter')
  await page.goto('/create-bookmarks')
  await page.getByTestId('file-input').first().setInputFiles(f)
  await expect(page.getByTestId('file-row')).toContainText('pages')
  await page.getByTestId('bm-text').fill('Intro, 1\n  Background, 2\nResults, 99')
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await expect(page.getByRole('alert').or(page.getByText('page 99 is not in the document'))).toBeVisible()
  await page.getByTestId('bm-text').fill('Intro, 1\n  Background, 2\nResults, 5')
  await expect(page.getByTestId('bm-count')).toHaveText('3 bookmarks will be saved.')
  const out = await runAndDownload(page)
  const doc = await PDFDocument.load(readFileSync(out))
  expect(doc.catalog.lookup(PDFName.of('Outlines'), PDFDict).get(PDFName.of('Count'))?.toString()).toBe('3')
  expect(await pageCountOf(out)).toBe(6)
})

test('Rename: pattern names are previewed and used', async ({ page }) => {
  const a = await writePdf('r-a.pdf', 1, 'A')
  const b = await writePdf('r-b.pdf', 1, 'B')
  await page.goto('/rename-pdf')
  await page.getByTestId('file-input').first().setInputFiles([a, b])
  await expect(page.getByTestId('file-row')).toHaveCount(2)
  await page.getByRole('radio', { name: /A pattern/ }).check()
  await page.getByTestId('rename-pattern').fill('Invoice-{n:3}')
  await expect(page.getByTestId('rename-new')).toHaveText(['Invoice-001.pdf', 'Invoice-002.pdf'])
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 30_000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const files = unzipSync(new Uint8Array(readFileSync((await dl.path())!)))
  expect(Object.keys(files).sort()).toEqual(['Invoice-001.pdf', 'Invoice-002.pdf'])
})

test('Workflows: steps run in order and are remembered', async ({ page }) => {
  const f = await writePdf('wf.pdf', 4, 'W')
  await page.goto('/workflow')
  await page.getByTestId('file-input').first().setInputFiles(f)
  await expect(page.getByTestId('file-row')).toContainText('pages')
  await page.getByTestId('wf-add-kind').selectOption('delete-pages')
  await page.getByTestId('wf-add').click()
  await expect(page.getByRole('alert')).toContainText('Type the pages')
  await expect(page.getByTestId('run-button')).toBeDisabled()
  await page.getByLabel('Pages').fill('1')
  await page.getByTestId('wf-add-kind').selectOption('split-half')
  await page.getByTestId('wf-add').click()
  await expect(page.getByTestId('wf-step')).toHaveCount(2)
  const out = await runAndDownload(page)
  expect(await pageCountOf(out)).toBe(6) // 4 pages - 1 = 3, each split in two
  await page.reload()
  await page.getByTestId('file-input').first().setInputFiles(f)
  await expect(page.getByTestId('wf-step')).toHaveCount(2)
})
