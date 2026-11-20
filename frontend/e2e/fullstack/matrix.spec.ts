/**
 * FEATURE × DOCUMENT MATRIX — every available tool, run through the real UI on every relevant kind of document,
 * with the downloaded output verified for real (page counts, rotation, sizes, text via pdf.js, docx/xlsx/pptx/zip contents).
 *
 * Runs against the full stack of playwright.fullstack.config.ts (real FastAPI backend, real MCP server, real Ghostscript /
 * Tesseract / LibreOffice). AI cases use the SCRIPTED MODEL (TEST DOUBLE) — everything after the model call is real.
 *
 * Every test carries a `matrix` annotation {tool, doc, variant}; tests that end in a deliberate, clear error message add a
 * `matrix-outcome` annotation "clear-error: <message>". e2e/fullstack/matrixReport.mjs turns the JSON report into a table.
 */
import { expect, test, type Page } from '@playwright/test'
import { PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFName, PDFRadioGroup, PDFTextField } from 'pdf-lib'
import { unzipSync } from 'fflate'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pageTexts } from '../../src/test/pdfText'
import { fitPage } from '../editorHelpers'
import { watchErrors } from '../helpers'
import { BACKEND, NOKEY_BACKEND, bytesOf, fx, registerUser, signIn, upload, xlsxText } from './helpers'

test.use({ viewport: { width: 1500, height: 1000 } })
test.setTimeout(300_000)

const TMP = join(import.meta.dirname, '..', '.tmp', 'matrix')
mkdirSync(TMP, { recursive: true })

const squash = (s: string) => s.replace(/\s+/g, '')

// ───────────────────────── documents ─────────────────────────
interface Doc {
  file: string
  pages: number
  /** one text marker per page (raw text as printed in the PDF); null = no text layer (scanned) */
  markers: string[] | null
}
const DOCS = {
  table: { file: 'table.pdf', pages: 1, markers: ['Quarterly Sales Report'] },
  multipage: { file: 'multipage.pdf', pages: 12, markers: Array.from({ length: 12 }, (_, i) => `CH${String(i + 1).padStart(2, '0')}X`) },
  scanned: { file: 'scanned.pdf', pages: 2, markers: null },
  mixed: { file: 'mixed.pdf', pages: 5, markers: [1, 2, 3, 4, 5].map((i) => `MIX0${i}`) },
  unicode: { file: 'unicode.pdf', pages: 2, markers: ['UNI1', 'UNI2'] },
  forms: { file: 'forms.pdf', pages: 1, markers: ['FORM01'] },
  images: { file: 'images.pdf', pages: 3, markers: ['IMG01', 'IMG02', 'IMG03'] },
  single: { file: 'single.pdf', pages: 1, markers: ['SNGL01'] },
  large: { file: 'large.pdf', pages: 4, markers: [1, 2, 3, 4].map((i) => `Large fixture page ${i}`) },
} satisfies Record<string, Doc>
type DocKey = keyof typeof DOCS
const ALL: DocKey[] = ['table', 'multipage', 'scanned', 'mixed', 'unicode', 'forms', 'images', 'single', 'large']
const NO_LARGE = ALL.filter((d) => d !== 'large')
const D = (k: DocKey): Doc => DOCS[k]

// ───────────────────────── matrix bookkeeping ─────────────────────────
function cell(tool: string, doc: string, variant?: string) {
  test.info().annotations.push({ type: 'matrix', description: JSON.stringify({ tool, doc, variant: variant ?? '' }) })
}
function clearError(message: string) {
  test.info().annotations.push({ type: 'matrix-outcome', description: `clear-error: ${message.trim().slice(0, 160)}` })
}
function note(message: string) {
  test.info().annotations.push({ type: 'matrix-note', description: message })
}

/** Declare one matrix cell as its own test. */
function mt(tool: string, doc: string, variant: string | undefined, server: boolean, fn: (page: Page) => Promise<void>) {
  test(`${tool} × ${doc}${variant ? ` (${variant})` : ''}`, async ({ page }) => {
    cell(tool, doc, variant)
    if (server) await signIn(page)
    const errors = watchErrors(page)
    await fn(page)
    // the app must stay clean: no uncaught exceptions, no detached buffers (HTTP 4xx of deliberate failures are fine)
    expect(errors.filter((e) => /pageerror|detach|ArrayBuffer/i.test(e))).toEqual([])
  })
}

// ───────────────────────── UI helpers ─────────────────────────
interface Out {
  path: string
  name: string
  bytes: Uint8Array
  info: string
  notice: string
}

async function open(page: Page, route: string, files: string | string[]) {
  await page.goto(route)
  await upload(page, files)
  await expect(page.getByTestId('file-row')).toHaveCount(Array.isArray(files) ? files.length : 1)
}

/** Click Run; resolve with the downloaded result, or throw with the tool's error message. */
async function run(page: Page): Promise<Out> {
  const btn = page.getByTestId('run-button')
  await expect(btn).toBeEnabled({ timeout: 60_000 })
  await btn.click()
  const result = page.getByTestId('result-panel')
  const error = page.getByTestId('tool-error')
  await expect(result.or(error)).toBeVisible({ timeout: 280_000 })
  if (await error.isVisible()) throw new Error(`tool error: ${await error.textContent()}`)
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  const path = await d.path()
  if (!path) throw new Error('download failed')
  const info = (await page.getByTestId('result-info').allTextContents()).join(' | ')
  const notice = (await page.getByTestId('result-notice').allTextContents()).join(' | ')
  return { path, name: d.suggestedFilename(), bytes: bytesOf(path), info, notice }
}

/** Click Run and expect a clear error message (returned). */
async function runExpectingError(page: Page, re: RegExp): Promise<string> {
  const btn = page.getByTestId('run-button')
  await expect(btn).toBeEnabled({ timeout: 60_000 })
  await btn.click()
  const error = page.getByTestId('tool-error')
  await expect(error).toBeVisible({ timeout: 280_000 })
  const msg = (await error.textContent()) ?? ''
  expect(msg).toMatch(re)
  return msg
}

/** Run; if the tool answers with an error, it must be a clear message matching `re` — recorded as a clear-error cell. */
async function runOrClearError(page: Page, re: RegExp): Promise<Out | null> {
  try {
    return await run(page)
  } catch (e) {
    const msg = String((e as Error).message)
    if (!msg.startsWith('tool error: ')) throw e
    expect(msg).toMatch(re)
    clearError(msg.replace('tool error: ', ''))
    return null
  }
}

async function pdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  const texts = (await pageTexts(bytes)).map(squash)
  return { doc, texts, pages: doc.getPageCount() }
}

function expectAllMarkers(texts: string[], d: Doc) {
  if (!d.markers) return
  const all = texts.join('|')
  for (const m of d.markers) expect(all, `marker ${m}`).toContain(squash(m))
}

function zip(bytes: Uint8Array) {
  return unzipSync(bytes)
}
const xmlText = (b: Uint8Array) => new TextDecoder().decode(b).replace(/<[^>]+>/g, '')

async function sourceRotations(d: Doc) {
  return (await PDFDocument.load(bytesOf(fx(d.file)))).getPages().map((p) => p.getRotation().angle)
}
function xobjectCount(doc: PDFDocument, i: number): number {
  const res = doc.getPage(i).node.Resources()
  const xo = res?.lookup(PDFName.of('XObject'))
  return xo instanceof PDFDict ? xo.keys().length : 0
}

// ───────────────────────── ORGANIZE (browser) ─────────────────────────
test.describe('organize (browser)', () => {
  for (const k of ALL) {
    mt('merge-pdf', k, undefined, false, async (page) => {
      const other: DocKey = k === 'single' ? 'table' : 'single'
      await open(page, '/merge-pdf', [fx(D(k).file), fx(D(other).file)])
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages + D(other).pages)
      if (D(k).markers) expect(r.texts[0]).toContain(squash(D(k).markers![0]))
      expect(r.texts[r.pages - 1]).toContain(squash(D(other).markers![0]))
    })

    mt('split-pdf', k, D(k).pages > 1 ? 'every 1 page' : 'range 1', false, async (page) => {
      await open(page, '/split-pdf', fx(D(k).file))
      if (D(k).pages > 1) {
        await page.getByRole('radio', { name: 'Every N pages' }).check()
        await page.getByTestId('split-every').fill('1')
        const out = await run(page)
        const parts = Object.entries(zip(out.bytes)).filter(([n]) => n.endsWith('.pdf'))
        expect(parts).toHaveLength(D(k).pages)
        const texts: string[] = []
        for (const [, b] of parts) {
          const r = await pdf(b)
          expect(r.pages).toBe(1)
          texts.push(...r.texts)
        }
        expectAllMarkers(texts, D(k))
      } else {
        await page.getByTestId('split-ranges').fill('1')
        const out = await run(page)
        const r = await pdf(out.bytes)
        expect(r.pages).toBe(1)
        expectAllMarkers(r.texts, D(k))
      }
    })

    mt('extract-pages', k, undefined, false, async (page) => {
      const target = D(k).pages > 1 ? 2 : 1
      await open(page, '/extract-pages', fx(D(k).file))
      await page.getByTestId('page-range').fill(String(target))
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(1)
      if (D(k).markers) expect(r.texts[0]).toContain(squash(D(k).markers![target - 1]))
    })

    mt('rotate-pdf', k, 'all +90°', false, async (page) => {
      const before = await sourceRotations(D(k))
      await open(page, '/rotate-pdf', fx(D(k).file))
      await page.getByTestId('rotate-all-right').click()
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.doc.getPages().map((p) => p.getRotation().angle)).toEqual(before.map((a) => (a + 90) % 360))
      expectAllMarkers(r.texts, D(k))
    })
  }

  for (const k of NO_LARGE) {
    mt('delete-pages', k, D(k).pages > 1 ? 'page 1' : 'only page', false, async (page) => {
      await open(page, '/delete-pages', fx(D(k).file))
      await page.getByTestId('page-range').fill('1')
      if (D(k).pages === 1) {
        // deleting every page must be refused with a message, not produce an empty PDF
        clearError(await runExpectingError(page, /every page|at least one page/i))
        return
      }
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages - 1)
      if (D(k).markers) {
        expect(r.texts[0]).toContain(squash(D(k).markers![1]))
        expect(r.texts.join('|')).not.toContain(squash(D(k).markers![0]))
      }
    })

    mt('reorder-pages', k, D(k).pages > 1 ? 'move page 2 first' : 'single page', false, async (page) => {
      await open(page, '/reorder-pages', fx(D(k).file))
      if (D(k).pages === 1) {
        await expect(page.getByTestId('run-button')).toBeDisabled() // nothing to reorder
        clearError('single page: nothing to reorder (Run stays disabled)')
        return
      }
      await page.getByRole('button', { name: 'Move page 2 earlier' }).click()
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
      if (D(k).markers) {
        expect(r.texts[0]).toContain(squash(D(k).markers![1]))
        expect(r.texts[1]).toContain(squash(D(k).markers![0]))
      }
    })

    mt('crop-pdf', k, 'default margins', false, async (page) => {
      await open(page, '/crop-pdf', fx(D(k).file))
      await expect(page.getByTestId('crop-box')).toBeVisible()
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
      for (const p of r.doc.getPages()) {
        const c = p.getCropBox()
        const m = p.getMediaBox()
        expect(c.width).toBeLessThan(m.width)
        expect(c.height).toBeLessThan(m.height)
      }
    })

    mt('resize-pages', k, 'to Letter', false, async (page) => {
      await open(page, '/resize-pages', fx(D(k).file))
      await page.getByRole('combobox', { name: 'Paper size' }).selectOption('letter')
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
      for (const p of r.doc.getPages()) {
        const { width, height } = p.getSize()
        expect([Math.round(width), Math.round(height)].sort((a, b) => a - b)).toEqual([612, 792])
      }
      expectAllMarkers(r.texts, D(k))
    })

    mt('n-up', k, '4 per sheet', false, async (page) => {
      await open(page, '/n-up', fx(D(k).file))
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(Math.ceil(D(k).pages / 4))
      expectAllMarkers(r.texts, D(k))
    })

    mt('add-page-numbers', k, 'start 101', false, async (page) => {
      await open(page, '/add-page-numbers', fx(D(k).file))
      await page.getByTestId('pn-start').fill('101')
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
      r.texts.forEach((t, i) => expect(t).toContain(String(101 + i)))
    })

    mt('headers-footers', k, '{page}/{pages}', false, async (page) => {
      await open(page, '/headers-footers', fx(D(k).file))
      await page.getByTestId('hf-top-left').fill('HDR{page}of{pages}')
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
      r.texts.forEach((t, i) => expect(t).toContain(`HDR${i + 1}of${D(k).pages}`))
      expectAllMarkers(r.texts, D(k))
    })

    mt('bates-numbering', k, 'prefix BAT start 7', false, async (page) => {
      await open(page, '/bates-numbering', fx(D(k).file))
      await page.getByTestId('bates-prefix').fill('BAT')
      await page.getByTestId('bates-start').fill('7')
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
      r.texts.forEach((t, i) => expect(t).toMatch(new RegExp(`BAT0*${7 + i}(?!\\d)`)))
    })
  }

  // extra variants on the documents where they matter
  mt('split-pdf', 'multipage', 'ranges 1-3,5,8-', false, async (page) => {
    await open(page, '/split-pdf', fx('multipage.pdf'))
    await page.getByTestId('split-ranges').fill('1-3,5,8-')
    const out = await run(page)
    const parts = Object.entries(zip(out.bytes)).filter(([n]) => n.endsWith('.pdf'))
    const counts = await Promise.all(parts.map(async ([, b]) => (await PDFDocument.load(b)).getPageCount()))
    expect(counts.sort((a, b) => a - b)).toEqual([1, 3, 5])
  })
  mt('split-pdf', 'multipage', 'by bookmarks', false, async (page) => {
    await open(page, '/split-pdf', fx('multipage.pdf'))
    await page.getByRole('radio', { name: 'Bookmarks' }).check()
    const out = await run(page)
    const parts = Object.entries(zip(out.bytes)).filter(([n]) => n.endsWith('.pdf'))
    expect(parts.length).toBeGreaterThan(1)
    const total = (await Promise.all(parts.map(async ([, b]) => (await PDFDocument.load(b)).getPageCount()))).reduce((a, b) => a + b, 0)
    expect(total).toBe(12)
  })
  mt('split-pdf', 'large', 'max 2 MB per file', false, async (page) => {
    await open(page, '/split-pdf', fx('large.pdf'))
    await page.getByRole('radio', { name: 'Maximum size' }).check()
    await page.getByTestId('split-size').fill('2')
    await page.getByRole('combobox', { name: 'Unit' }).selectOption({ label: 'MB' })
    const out = await run(page)
    const parts = Object.entries(zip(out.bytes)).filter(([n]) => n.endsWith('.pdf'))
    expect(parts.length).toBeGreaterThan(1)
    let total = 0
    for (const [, b] of parts) {
      expect(b.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024)
      total += (await PDFDocument.load(b)).getPageCount()
    }
    expect(total).toBe(4)
  })
})

// ───────────────────────── CONVERT FROM PDF (server) ─────────────────────────
test.describe('convert from PDF (server)', () => {
  for (const k of ALL) {
    mt('pdf-to-word', k, undefined, true, async (page) => {
      await open(page, '/pdf-to-word', fx(D(k).file))
      const out = await run(page)
      expect(out.name).toMatch(/\.docx$/)
      const files = zip(out.bytes)
      const xml = new TextDecoder().decode(files['word/document.xml'])
      const plain = squash(xmlText(files['word/document.xml']))
      if (D(k).markers) for (const m of D(k).markers!) expect(plain, `marker ${m}`).toContain(squash(m))
      if (k === 'table') expect(xml).toContain('<w:tbl>')
      if (k === 'scanned') {
        expect(plain.toUpperCase()).toContain('INVOICE') // OCR'd scanned pages
        note(`notice: ${out.notice}`)
      }
      expect(plain).not.toMatch(/---Page|ConvertedDocument/)
    })
  }

  for (const k of NO_LARGE) {
    mt('pdf-to-excel', k, undefined, true, async (page) => {
      await open(page, '/pdf-to-excel', fx(D(k).file))
      const out = await runOrClearError(page, /table/i)
      if (!out) return
      const files = zip(out.bytes)
      expect(Object.keys(files).some((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))).toBe(true)
      if (k === 'table') expect(xlsxText(out.path)).toContain('Widget')
    })

    for (const mode of ['image', 'editable'] as const) {
      mt('pdf-to-powerpoint', k, mode, true, async (page) => {
        await open(page, '/pdf-to-powerpoint', fx(D(k).file))
        if (mode === 'editable') await page.getByRole('radio', { name: /Editable text/ }).check()
        const out = await run(page)
        expect(out.name).toMatch(/\.pptx$/)
        const files = zip(out.bytes)
        const slides = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        expect(slides).toHaveLength(D(k).pages)
        if (mode === 'editable' && D(k).markers) {
          const all = squash(slides.map((s) => xmlText(files[s])).join('|'))
          for (const m of D(k).markers!) expect(all, `marker ${m}`).toContain(squash(m))
        }
      })
    }

    mt('pdf-to-png', k, '150 dpi', true, async (page) => {
      await open(page, '/pdf-to-png', fx(D(k).file))
      const out = await run(page)
      const imgs = Object.entries(zip(out.bytes)).filter(([n]) => n.endsWith('.png'))
      expect(imgs).toHaveLength(D(k).pages)
      for (const [, b] of imgs) expect([...b.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    })

    mt('pdf-to-text', k, undefined, true, async (page) => {
      await open(page, '/pdf-to-text', fx(D(k).file))
      const out = await runOrClearError(page, /text|OCR|scan/i)
      if (!out) return
      const text = new TextDecoder().decode(out.bytes)
      expect(text).not.toMatch(/--- Page|Converted Document/)
      if (D(k).markers) for (const m of D(k).markers!) expect(squash(text)).toContain(squash(m))
      if (k === 'unicode') expect(text).toContain('Привет')
      if (!D(k).markers) note(`scanned → text file of ${text.trim().length} chars; notice: ${out.notice}`)
    })
  }

  for (const k of ALL) {
    mt('pdf-to-jpg', k, '150 dpi', true, async (page) => {
      await open(page, '/pdf-to-jpg', fx(D(k).file))
      const out = await run(page)
      const imgs = Object.entries(zip(out.bytes)).filter(([n]) => /\.jpe?g$/.test(n))
      expect(imgs).toHaveLength(D(k).pages)
      for (const [, b] of imgs) expect([...b.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    })
  }
})

// ───────────────────────── CONVERT TO PDF (server) ─────────────────────────
test.describe('convert to PDF (server)', () => {
  const cases: [string, string, string | string[], string[]][] = [
    ['word-to-pdf', 'sample.docx', fx('sample.docx'), ['Sample Word Document', 'R2C2', 'R&D <team> & AT&T']],
    ['excel-to-pdf', 'sample.xlsx', fx('sample.xlsx'), ['Apple', 'Pear', 'Price']],
    ['powerpoint-to-pdf', 'sample.pptx', fx('sample.pptx'), ['Sample Slide Title', 'Slide body text']],
    ['jpg-to-pdf', 'sample.jpg', fx('sample.jpg'), []],
    ['png-to-pdf', 'sample.png', fx('sample.png'), []],
    ['jpg-to-pdf', 'sample.jpg + sample.png', [fx('sample.jpg'), fx('sample.png')], []],
    ['text-to-pdf', 'sample.txt', fx('sample.txt'), ['R&D <team> & AT&T: 5 < 7 > 3', 'Café crème, naïve façade', 'TXT02']],
  ]
  for (const [tool, doc, files, expected] of cases) {
    mt(tool, doc, undefined, true, async (page) => {
      await open(page, `/${tool}`, files)
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBeGreaterThanOrEqual(Array.isArray(files) ? files.length : 1)
      const all = r.texts.join('|')
      for (const t of expected) expect(all, t).toContain(squash(t))
      if (tool.startsWith('jpg') || tool.startsWith('png')) expect(xobjectCount(r.doc, 0)).toBeGreaterThan(0)
      expect(all).not.toMatch(/&amp;|&lt;|&gt;|ConvertedDocument|---Page/)
    })
  }
})

// ───────────────────────── OPTIMIZE (server) ─────────────────────────
test.describe('optimize (server)', () => {
  for (const k of ALL) {
    for (const level of ['Low', 'Medium', 'High'] as const) {
      if (k !== 'large' && k !== 'images' && level !== 'Medium') continue // all levels on the image-heavy files
      mt('compress-pdf', k, level.toLowerCase(), true, async (page) => {
        const original = statSync(fx(D(k).file)).size
        await open(page, '/compress-pdf', fx(D(k).file))
        await page.getByRole('radio', { name: new RegExp(`^${level}`) }).check()
        const out = await run(page)
        const r = await pdf(out.bytes)
        expect(r.pages).toBe(D(k).pages)
        expectAllMarkers(r.texts, D(k))
        if (k === 'large' || k === 'images') expect(out.bytes.byteLength).toBeLessThan(original)
        // the UI never claims a saving that did not happen
        if (out.bytes.byteLength >= original) expect(`${out.info} ${out.notice}`).toMatch(/not smaller|already|no saving|original/i)
        else expect(out.info).toMatch(/Before: .* → After: .*saved/)
        note(`${original} → ${out.bytes.byteLength} bytes; UI: ${out.info} ${out.notice}`.trim())
      })
    }
  }

  for (const k of NO_LARGE) {
    mt('repair-pdf', k, undefined, true, async (page) => {
      await open(page, '/repair-pdf', fx(D(k).file))
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
      expectAllMarkers(r.texts, D(k))
    })

    mt('flatten-pdf', k, undefined, true, async (page) => {
      await open(page, '/flatten-pdf', fx(D(k).file))
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
      expectAllMarkers(r.texts, D(k))
      if (k === 'forms') {
        expect(r.doc.getForm().getFields()).toHaveLength(0)
        expect(r.texts[0]).toContain('PrefilledName') // the field value is baked into the page
      }
    })

    mt('deskew-pdf', k, undefined, true, async (page) => {
      await open(page, '/deskew-pdf', fx(D(k).file))
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
    })
  }

  for (const k of ALL) {
    mt('ocr-pdf', k, 'English', true, async (page) => {
      await open(page, '/ocr-pdf', fx(D(k).file))
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
      if (k === 'scanned') {
        const all = r.texts.join('|').toUpperCase()
        for (const w of ['INVOICE', 'TOTAL', 'AMOUNT', 'SECONDPAGE']) expect(all).toContain(w)
      }
      expectAllMarkers(r.texts, D(k))
    })
  }

  mt('repair-pdf', 'corrupted', 'broken xref', true, async (page) => {
    await open(page, '/repair-pdf', fx('corrupted.pdf'))
    const out = await run(page)
    const r = await pdf(out.bytes)
    expect(r.pages).toBe(12)
    expect(r.texts[0]).toContain('CH01X')
    expect(r.texts[11]).toContain('CH12X')
  })
})

// ───────────────────────── SECURITY (server) ─────────────────────────
test.describe('security (server)', () => {
  for (const k of ALL) {
    mt('protect-pdf → unlock-pdf', k, 'round trip', true, async (page) => {
      await open(page, '/protect-pdf', fx(D(k).file))
      await page.getByTestId('protect-password').fill('matrix-pass-1')
      await page.getByTestId('protect-password2').fill('matrix-pass-1')
      const locked = await run(page)
      await expect(PDFDocument.load(locked.bytes)).rejects.toThrow(/encrypted/i)
      const lockedPath = join(TMP, `locked-${k}.pdf`)
      writeFileSync(lockedPath, locked.bytes)
      await open(page, '/unlock-pdf', lockedPath)
      await page.getByTestId('unlock-password').fill('matrix-pass-1')
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
      expectAllMarkers(r.texts, D(k))
    })

    mt('watermark-pdf', k, 'text', true, async (page) => {
      await open(page, '/watermark-pdf', fx(D(k).file))
      await page.getByTestId('wm-text').fill('WMKX')
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
      r.texts.forEach((t) => expect(t).toContain('WMKX'))
      expectAllMarkers(r.texts, D(k))
    })
  }

  for (const k of NO_LARGE) {
    mt('watermark-pdf', k, 'image', true, async (page) => {
      const src = await PDFDocument.load(bytesOf(fx(D(k).file)))
      await open(page, '/watermark-pdf', fx(D(k).file))
      await page.getByRole('radio', { name: 'Image', exact: true }).check()
      await page.getByTestId('wm-image').setInputFiles(fx('sample.png'))
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(D(k).pages)
      for (let i = 0; i < r.pages; i++) expect(xobjectCount(r.doc, i)).toBeGreaterThan(xobjectCount(src, i))
    })


    mt('metadata-pdf', k, 'edit title/author', true, async (page) => {
      await open(page, '/metadata-pdf', fx(D(k).file))
      await page.getByTestId('meta-title').fill('Matrix Título Ελληνικά')
      await page.getByTestId('meta-author').fill('Rooman QA')
      const out = await run(page)
      const r = await pdf(out.bytes)
      expect(r.doc.getTitle()).toBe('Matrix Título Ελληνικά')
      expect(r.doc.getAuthor()).toBe('Rooman QA')
      expect(r.pages).toBe(D(k).pages)
    })

    mt('extract-tables', k, 'no AI', true, async (page) => {
      await open(page, '/extract-tables', fx(D(k).file))
      const out = await runOrClearError(page, /table/i)
      if (!out) return
      expect(out.name).toMatch(/\.xlsx$/)
      expect(Object.keys(zip(out.bytes)).some((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))).toBe(true)
      if (k === 'table') expect(xlsxText(out.path)).toContain('Widget')
      note(out.info)
    })
  }
})

// ───────────────────────── EDITOR (browser) ─────────────────────────
type Pt = [number, number]
async function at(page: Page, i: number, [fx_, fy]: Pt) {
  const o = page.getByTestId('page-overlay').nth(i)
  await o.scrollIntoViewIfNeeded()
  const b = (await o.boundingBox())!
  return { x: b.x + fx_ * b.width, y: b.y + fy * b.height }
}
async function clickAt(page: Page, i: number, p: Pt) {
  const a = await at(page, i, p)
  await page.mouse.click(a.x, a.y)
}
async function dragAt(page: Page, i: number, from: Pt, to: Pt, steps = 8) {
  const a = await at(page, i, from)
  const b = await at(page, i, to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps })
  await page.mouse.up()
}
async function pick(page: Page, id: string) {
  await page.getByTestId(`tool-${id}`).click()
  await expect(page.getByTestId(`tool-${id}`)).toHaveAttribute('aria-pressed', 'true')
}
async function openEditor(page: Page, route: string, file: string) {
  await page.goto(route)
  await page.getByTestId('file-input').setInputFiles(file)
  await expect(page.getByTestId('editor-root')).toBeVisible()
  await expect(page.getByTestId('page-overlay').first()).toBeVisible()
  if (route !== '/sign-pdf') await fitPage(page)
}
async function exportEditor(page: Page): Promise<Uint8Array> {
  await page.getByTestId('export-button').click()
  const result = page.getByTestId('result-panel')
  const err = page.getByTestId('editor-error')
  await expect(result.or(err)).toBeVisible({ timeout: 60_000 })
  if (await err.isVisible()) throw new Error(`editor error: ${await err.textContent()}`)
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-button').click()])
  return bytesOf((await d.path())!)
}
function annotSubtypes(doc: PDFDocument, i: number): string[] {
  const annots = doc.getPage(i).node.Annots()
  if (!annots) return []
  const out: string[] = []
  for (let j = 0; j < annots.size(); j++) out.push((doc.context.lookup(annots.get(j), PDFDict).get(PDFName.of('Subtype')) as PDFName).decodeText())
  return out
}

test.describe('editor (browser)', () => {
  const EDITOR_DOCS: DocKey[] = ['mixed', 'unicode', 'forms']
  for (const k of EDITOR_DOCS) {
    mt('edit-pdf', k, 'all object types', false, async (page) => {
      const src = await PDFDocument.load(bytesOf(fx(D(k).file)))
      const xo0 = xobjectCount(src, 0)
      const annots0 = annotSubtypes(src, 0)
      await openEditor(page, '/edit', fx(D(k).file))
      const added = k === 'unicode' ? 'Ελληνικά Привет EDIT' : 'MATRIX EDIT TEXT'
      await pick(page, 'text')
      await clickAt(page, 0, [0.1, 0.45])
      await page.getByTestId('text-editor').fill(added)
      await page.keyboard.press('Escape')
      await pick(page, 'rect')
      await dragAt(page, 0, [0.55, 0.3], [0.75, 0.38])
      await pick(page, 'ellipse')
      await dragAt(page, 0, [0.55, 0.4], [0.75, 0.48])
      await pick(page, 'line')
      await dragAt(page, 0, [0.1, 0.55], [0.4, 0.55])
      await pick(page, 'arrow')
      await dragAt(page, 0, [0.1, 0.6], [0.4, 0.62])
      await pick(page, 'whiteout')
      await dragAt(page, 0, [0.6, 0.85], [0.9, 0.9])
      await pick(page, 'highlight')
      await dragAt(page, 0, [0.04, 0.05], [0.7, 0.1])
      await pick(page, 'underline')
      await dragAt(page, 0, [0.04, 0.09], [0.9, 0.13])
      await pick(page, 'strike')
      await dragAt(page, 0, [0.5, 0.7], [0.8, 0.73])
      await pick(page, 'draw')
      await dragAt(page, 0, [0.1, 0.75], [0.35, 0.8], 14)
      await pick(page, 'select')
      await page.getByTestId('image-input').setInputFiles(fx('sample.png'))
      await clickAt(page, 0, [0.8, 0.6])
      await page.getByTestId('tool-signature').click()
      await page.getByTestId('sig-tab-type').click()
      await page.getByTestId('signature-text').fill('Matrix Signer')
      await page.getByTestId('signature-use').click()
      await clickAt(page, 0, [0.75, 0.78])
      await pick(page, 'link')
      await dragAt(page, 0, [0.1, 0.9], [0.4, 0.94])
      await page.getByTestId('link-url').fill('https://example.com/matrix')
      const bytes = await exportEditor(page)
      const r = await pdf(bytes)
      expect(r.pages).toBe(D(k).pages)
      expect(r.doc.getPages().map((p) => p.getRotation().angle)).toEqual(src.getPages().map((p) => p.getRotation().angle))
      expect(r.texts[0]).toContain(squash(added))
      expectAllMarkers(r.texts, D(k))
      const subs = annotSubtypes(r.doc, 0)
      for (const s of ['Highlight', 'Underline', 'StrikeOut', 'Link']) expect(subs).toContain(s)
      expect(subs.length).toBeGreaterThanOrEqual(annots0.length + 4)
      expect(xobjectCount(r.doc, 0)).toBe(xo0 + 2) // image + signature
    })
  }

  mt('sign-pdf', 'unicode', 'draw signature', false, async (page) => {
    const src = await PDFDocument.load(bytesOf(fx('unicode.pdf')))
    await openEditor(page, '/sign-pdf', fx('unicode.pdf'))
    await expect(page.getByTestId('signature-dialog')).toBeVisible()
    const pad = page.getByTestId('signature-pad')
    const pb = (await pad.boundingBox())!
    await page.mouse.move(pb.x + 30, pb.y + 90)
    await page.mouse.down()
    for (let i = 0; i < 20; i++) await page.mouse.move(pb.x + 30 + i * 12, pb.y + 90 + Math.sin(i / 2) * 40, { steps: 2 })
    await page.mouse.up()
    await page.getByTestId('signature-use').click()
    await fitPage(page)
    await clickAt(page, 0, [0.6, 0.8])
    const r = await pdf(await exportEditor(page))
    expect(xobjectCount(r.doc, 0)).toBe(xobjectCount(src, 0) + 1)
    expectAllMarkers(r.texts, D('unicode'))
  })

  mt('sign-pdf', 'mixed', 'upload signature image', false, async (page) => {
    const src = await PDFDocument.load(bytesOf(fx('mixed.pdf')))
    await openEditor(page, '/sign-pdf', fx('mixed.pdf'))
    await page.getByTestId('sig-tab-upload').click()
    await page.getByTestId('signature-file').setInputFiles(fx('sample.png'))
    await page.getByTestId('signature-use').click()
    await fitPage(page)
    await clickAt(page, 0, [0.6, 0.8])
    const r = await pdf(await exportEditor(page))
    expect(xobjectCount(r.doc, 0)).toBe(xobjectCount(src, 0) + 1)
    expect(r.pages).toBe(5)
  })

  mt('sign-pdf', 'forms', 'typed signature', false, async (page) => {
    await openEditor(page, '/sign-pdf', fx('forms.pdf'))
    await page.getByTestId('sig-tab-type').click()
    await page.getByTestId('signature-text').fill('Forms Signer')
    await page.getByTestId('signature-use').click()
    await fitPage(page)
    await clickAt(page, 0, [0.6, 0.85])
    const r = await pdf(await exportEditor(page))
    expect(r.doc.getForm().getFields().length).toBe(4) // the existing fields are kept
    expect(xobjectCount(r.doc, 0)).toBeGreaterThan(0)
  })

  mt('edit-pdf', 'mixed', 'add form fields', false, async (page) => {
    await openEditor(page, '/edit', fx('mixed.pdf'))
    await pick(page, 'field-text')
    await dragAt(page, 0, [0.1, 0.55], [0.5, 0.58])
    await page.getByTestId('field-name').fill('customer')
    await pick(page, 'field-checkbox')
    await clickAt(page, 0, [0.1, 0.62])
    await pick(page, 'field-radio')
    await clickAt(page, 0, [0.2, 0.62])
    await pick(page, 'field-dropdown')
    await dragAt(page, 0, [0.1, 0.66], [0.4, 0.69])
    const r = await pdf(await exportEditor(page))
    const names = r.doc.getForm().getFields().map((f) => f.getName())
    expect(names).toContain('customer')
    expect(names.length).toBe(4)
    // the new fields really are fillable
    const form = r.doc.getForm()
    ;(form.getField('customer') as PDFTextField).setText('filled')
    expect((form.getField('customer') as PDFTextField).getText()).toBe('filled')
  })

  mt('fill-form', 'forms', 'fill existing fields', false, async (page) => {
    await openEditor(page, '/fill-form', fx('forms.pdf'))
    await expect(page.getByText(/4 form fields found/)).toBeVisible()
    await expect(page.locator('input[data-field="full_name"]')).toHaveValue('Prefilled Name')
    await page.locator('input[data-field="full_name"]').fill('Matrix Person')
    await page.locator('input[data-field="subscribe"]').uncheck()
    await page.getByTestId('form-field-plan-team').check()
    await page.locator('select[data-field="country"]').selectOption('Peru')
    const r = await pdf(await exportEditor(page))
    const form = r.doc.getForm()
    expect((form.getField('full_name') as PDFTextField).getText()).toBe('Matrix Person')
    expect((form.getField('subscribe') as PDFCheckBox).isChecked()).toBe(false)
    expect((form.getField('plan') as PDFRadioGroup).getSelected()).toBe('team')
    expect((form.getField('country') as PDFDropdown).getSelected()).toEqual(['Peru'])
  })

})

// ───────────────────────── AI (scripted model = TEST DOUBLE) ─────────────────────────
test.describe('AI pages — scripted model (test double)', () => {
  for (const k of ['table', 'multipage', 'unicode'] as DocKey[]) {
    mt('summarize-pdf', k, 'scripted model (test double)', true, async (page) => {
      await page.goto('/summarize-pdf')
      await upload(page, fx(D(k).file))
      await page.getByTestId('ai-run').click()
      await expect(page.getByTestId('ai-text')).toContainText('scripted answer', { timeout: 90_000 })
    })
    mt('ask-pdf', k, 'scripted model (test double)', true, async (page) => {
      await page.goto('/ask-pdf')
      await upload(page, fx(D(k).file))
      await page.getByTestId('ask-question').fill('What is in chapter 2?')
      await page.getByTestId('ai-run').click()
      await expect(page.getByTestId('ai-text')).toContainText('Chapter 2 is described on', { timeout: 90_000 })
      // citations are only kept for pages that exist in the document
      const chips = page.getByTestId('ai-text').getByTestId('citation-chip')
      await expect(chips.filter({ hasText: 'p. 1' })).toHaveCount(1)
      await expect(chips.filter({ hasText: 'p. 2' })).toHaveCount(D(k).pages >= 2 ? 1 : 0)
    })
    mt('translate-pdf', k, 'scripted model (test double)', true, async (page) => {
      await page.goto('/translate-pdf')
      await upload(page, fx(D(k).file))
      await page.getByTestId('translate-lang').fill('German')
      await page.getByTestId('ai-run').click()
      await expect(page.getByTestId('ai-text')).toContainText('scripted answer', { timeout: 90_000 })
      const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-document').click()])
      expect(Object.keys(unzipSync(bytesOf((await d.path())!)))).toContain('word/document.xml')
    })
    mt('explain-pdf', k, 'scripted model (test double)', true, async (page) => {
      await page.goto('/explain-pdf')
      await upload(page, fx(D(k).file))
      await page.getByTestId('explain-page').fill('1')
      await expect(page.getByTestId('ai-run')).toBeEnabled({ timeout: 30_000 })
      await page.getByTestId('ai-run').click()
      await expect(page.getByTestId('ai-text')).toContainText('scripted answer', { timeout: 90_000 })
    })
    mt('compare-pdf', `${k} vs single`, 'real diff + scripted summary', true, async (page) => {
      await page.goto('/compare-pdf')
      await upload(page, [fx(D(k).file), fx('single.pdf')])
      await expect(page.getByTestId('ai-file-row')).toHaveCount(2)
      await page.getByTestId('ai-run').click()
      await expect(page.getByTestId('diff-view')).toBeVisible({ timeout: 90_000 })
      expect(await page.getByTestId('diff-change').count()).toBeGreaterThan(0)
    })
    mt('chat-pdf', k, 'question with citations (test double)', true, async (page) => {
      await page.goto('/ai-chat')
      await upload(page, fx(D(k).file))
      await expect(page.getByTestId('chat-input')).toBeEnabled({ timeout: 60_000 })
      await page.getByTestId('chat-input').fill('What is in chapter 2?')
      await page.getByTestId('chat-send').click()
      await expect(page.getByTestId('assistant-text').last()).toContainText('Chapter 2 is described on', { timeout: 90_000 })
    })
  }
})

// ───────────────────────── CHAT → MCP tools (scripted model = TEST DOUBLE, tools are real) ─────────────────────────
interface ChatCase {
  tool: string
  doc: DocKey
  args: Record<string, unknown>
  destructive?: boolean
  verify?: (paths: string[]) => Promise<void>
  /** text expected in the tool card when the tool returns data instead of a document */
  cardText?: RegExp
}
const CHAT: ChatCase[] = [
  { tool: 'merge_pdfs', doc: 'multipage', args: { document_ids: ['$DOC', '$DOC'] }, verify: async ([p]) => expect((await PDFDocument.load(bytesOf(p))).getPageCount()).toBe(24) },
  { tool: 'split_pdf', doc: 'multipage', args: { document_id: '$DOC', mode: 'every_n', every_n: 4 }, verify: async (ps) => expect(ps.length).toBeGreaterThanOrEqual(1) },
  { tool: 'compress_pdf', doc: 'images', args: { document_id: '$DOC', level: 'high' }, verify: async ([p]) => expect(statSync(p).size).toBeLessThan(statSync(fx('images.pdf')).size) },
  { tool: 'rotate_pdf', doc: 'multipage', args: { document_id: '$DOC', angle: 90, pages: '1-2' }, verify: async ([p]) => expect((await PDFDocument.load(bytesOf(p))).getPages().map((x) => x.getRotation().angle).slice(0, 3)).toEqual([90, 90, 0]) },
  { tool: 'delete_pages', doc: 'multipage', args: { document_id: '$DOC', pages: '1' }, destructive: true, verify: async ([p]) => expect((await PDFDocument.load(bytesOf(p))).getPageCount()).toBe(11) },
  { tool: 'extract_pages', doc: 'multipage', args: { document_id: '$DOC', pages: '2-3' }, verify: async ([p]) => expect(squash((await pageTexts(bytesOf(p))).join('|'))).toContain('CH02X') },
  { tool: 'extract_text', doc: 'unicode', args: { document_id: '$DOC', pages: '1' } },
  { tool: 'extract_tables', doc: 'table', args: { document_id: '$DOC', create_xlsx: true }, verify: async ([p]) => expect(xlsxText(p)).toContain('Widget') },
  { tool: 'convert_pdf', doc: 'table', args: { document_id: '$DOC', target: 'docx' }, verify: async ([p]) => expect(new TextDecoder().decode(unzipSync(bytesOf(p))['word/document.xml'])).toContain('<w:tbl>') },
  { tool: 'add_watermark', doc: 'mixed', args: { document_id: '$DOC', text: 'CHATWM' }, verify: async ([p]) => (await pageTexts(bytesOf(p))).forEach((t) => expect(t).toContain('CHATWM')) },
  { tool: 'protect_pdf', doc: 'single', args: { document_id: '$DOC', user_password: 'chat-pass-1' }, destructive: true, verify: async ([p]) => expect(PDFDocument.load(bytesOf(p))).rejects.toThrow(/encrypted/i) },
  { tool: 'get_document_info', doc: 'mixed', args: { document_id: '$DOC' } },
  { tool: 'search_document', doc: 'multipage', args: { document_id: '$DOC', query: 'CH03X' } },
]

test.describe('chat → MCP tools (scripted model = test double)', () => {
  for (const c of CHAT) {
    mt(`chat:${c.tool}`, c.doc, 'via MCP (test double model)', true, async (page) => {
      await page.goto('/ai-chat')
      await upload(page, fx(D(c.doc).file))
      await expect(page.getByTestId('chat-input')).toBeEnabled({ timeout: 60_000 })
      await page.getByTestId('chat-input').fill(`RUN_TOOL ${c.tool} ${JSON.stringify(c.args)}`)
      await page.getByTestId('chat-send').click()
      if (c.destructive) {
        await expect(page.getByTestId('confirmation')).toBeVisible({ timeout: 90_000 })
        await page.getByTestId('confirm-approve').click()
      }
      const card = page.locator(`[data-testid=tool-card][data-tool=${c.tool}]`)
      await expect(card).toHaveAttribute('data-status', 'ok', { timeout: 150_000 })
      await expect(page.getByTestId('assistant-text').last()).toContainText(`TOOL_DONE ${c.tool} ok=true`, { timeout: 60_000 })
      if (c.verify) {
        const links = page.getByTestId('chat-download')
        await expect(links.first()).toBeVisible()
        const paths: string[] = []
        for (let i = 0; i < (await links.count()); i++) {
          const [d] = await Promise.all([page.waitForEvent('download'), links.nth(i).click()])
          paths.push((await d.path())!)
        }
        await c.verify(paths)
      }
    })
  }
})

// ───────────────────────── NEGATIVE cases: protected / owner-only / corrupted / fake / wrong type / too large / bad ranges ─────────────────────────
test.describe('negative cases', () => {
  for (const route of ['/rotate-pdf', '/extract-pages', '/n-up', '/add-page-numbers']) {
    mt(route.slice(1), 'protected', 'password-protected', false, async (page) => {
      await page.goto(route)
      await upload(page, fx('protected.pdf'))
      // the file row says why nothing can be done with it, and what to do instead
      const msg = page.getByTestId('file-read-error')
      await expect(msg).toContainText(/password-protected.*Unlock it first/i, { timeout: 30_000 })
      await expect(page.getByTestId('run-button')).toBeDisabled()
      clearError((await msg.textContent()) ?? '')
    })
  }
  mt('merge-pdf', 'protected + single', 'password-protected', false, async (page) => {
    await open(page, '/merge-pdf', [fx('protected.pdf'), fx('single.pdf')])
    await expect(page.getByTestId('file-read-error')).toContainText(/password-protected.*Unlock it first/i)
    await expect(page.getByTestId('run-button')).toBeDisabled()
    clearError((await page.getByTestId('file-read-error').textContent()) ?? '')
  })
  mt('edit-pdf', 'protected', 'password-protected', false, async (page) => {
    await page.goto('/edit')
    await page.getByTestId('file-input').setInputFiles(fx('protected.pdf'))
    await expect(page.getByText(/password[- ]protected/i).first()).toBeVisible({ timeout: 30_000 })
    clearError((await page.getByText(/password[- ]protected/i).first().textContent()) ?? '')
  })
  const SERVER_LOCKED: [string, string, Record<string, unknown>][] = [
    ['/compress-pdf', '/api/optimize/compress', { level: 'medium' }],
    ['/pdf-to-word', '/api/convert/pdf-to-word', {}],
    ['/watermark-pdf', '/api/security/watermark', { text: 'X' }],
    ['/ocr-pdf', '/api/optimize/ocr', {}],
    ['/pdf-to-text', '/api/convert/pdf-to-text', {}],
    ['/metadata-pdf', '/api/security/metadata', { title: 'x' }],
  ]
  for (const [route, endpoint, extra] of SERVER_LOCKED) {
    mt(route.slice(1), 'protected', 'password-protected (UI + API)', true, async (page) => {
      // UI: the row explains it and the tool cannot be started
      await open(page, route, fx('protected.pdf'))
      await expect(page.getByTestId('file-read-error')).toContainText(/password-protected.*Unlock it first/i, { timeout: 30_000 })
      await expect(page.getByTestId('run-button')).toBeDisabled()
      // API: the server itself refuses with a clear, machine-readable error (no silent junk output)
      const s = await registerUser(BACKEND)
      const h = { Authorization: `Bearer ${s.token}` }
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(bytesOf(fx('protected.pdf')))], { type: 'application/pdf' }), 'protected.pdf')
      const up = (await (await fetch(`${BACKEND}/api/documents`, { method: 'POST', headers: h, body: form })).json()) as { id: string }
      const res = await fetch(`${BACKEND}${endpoint}`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ document_id: up.id, ...extra }) })
      const body = (await res.json()) as { code?: string; detail?: string }
      expect(res.status, JSON.stringify(body)).toBe(422)
      expect(body.code).toBe('PASSWORD_REQUIRED')
      clearError(`UI: Run disabled + "unlock it first"; API ${res.status} ${body.code}: ${body.detail}`)
    })
  }
  mt('unlock-pdf', 'protected', 'correct password', true, async (page) => {
    await open(page, '/unlock-pdf', fx('protected.pdf'))
    await page.getByTestId('unlock-password').fill('secret123')
    const r = await pdf((await run(page)).bytes)
    expect(r.texts[0]).toContain('Topsecretcontentinsideprotectedfile')
  })
  mt('unlock-pdf', 'protected', 'wrong password', true, async (page) => {
    await open(page, '/unlock-pdf', fx('protected.pdf'))
    await page.getByTestId('unlock-password').fill('wrong-one')
    clearError(await runExpectingError(page, /password/i))
  })

  // owner-only: opens without a password but carries restrictions
  mt('rotate-pdf', 'owner-only', 'owner password only', false, async (page) => {
    await open(page, '/rotate-pdf', fx('owner-only.pdf'))
    await page.getByTestId('rotate-all-right').click()
    const out = await runOrClearError(page, /password|restrict|unlock/i)
    if (out) expect((await pdf(out.bytes)).doc.getPage(0).getRotation().angle).toBe(90)
  })
  mt('compress-pdf', 'owner-only', 'owner password only', true, async (page) => {
    await open(page, '/compress-pdf', fx('owner-only.pdf'))
    const out = await runOrClearError(page, /password|restrict|unlock/i)
    if (out) expect((await pageTexts(out.bytes))[0]).toContain('SNGL01')
  })
  mt('unlock-pdf', 'owner-only', 'no password needed', true, async (page) => {
    await open(page, '/unlock-pdf', fx('owner-only.pdf'))
    const out = await run(page)
    const doc = await PDFDocument.load(out.bytes) // no longer encrypted
    expect(doc.getPageCount()).toBe(1)
    expect((await pageTexts(out.bytes))[0]).toContain('SNGL01')
  })

  // corrupted: broken cross-reference table
  mt('rotate-pdf', 'corrupted', 'broken xref', false, async (page) => {
    await open(page, '/rotate-pdf', fx('corrupted.pdf'))
    const rotate = page.getByTestId('rotate-all-right')
    const readError = page.getByTestId('file-read-error')
    await expect(rotate.and(page.locator(':enabled')).or(readError)).toBeVisible({ timeout: 30_000 })
    if (await readError.isVisible()) {
      await expect(readError).toContainText(/could not be read.*Repair/i)
      clearError((await readError.textContent()) ?? '')
      return
    }
    await page.getByTestId('rotate-all-right').click()
    const out = await runOrClearError(page, /could not|damaged|corrupt|repair|invalid/i)
    if (out) {
      const r = await pdf(out.bytes)
      expect(r.pages).toBe(12)
      note('browser tools read this damaged file directly (pdf-lib recovers objects without the xref)')
    }
  })
  for (const route of ['/compress-pdf', '/pdf-to-word']) {
    mt(route.slice(1), 'corrupted', 'broken xref', true, async (page) => {
      await open(page, route, fx('corrupted.pdf'))
      const out = await runOrClearError(page, /damaged|corrupt|repair|could not|invalid|read/i)
      if (out && route === '/compress-pdf') expect((await pdf(out.bytes)).pages).toBe(12)
      if (out && route === '/pdf-to-word') expect(squash(xmlText(zip(out.bytes)['word/document.xml']))).toContain('CH01X')
    })
  }

  // fake.pdf: a text file named .pdf
  for (const [route, server] of [['/rotate-pdf', false], ['/compress-pdf', true], ['/edit', false]] as const) {
    mt(route.slice(1), 'fake.pdf', 'not a PDF', server, async (page) => {
      await page.goto(route)
      await page.getByTestId('file-input').first().setInputFiles(fx('fake.pdf'))
      const msg = page.getByText(/not a valid PDF/i).first()
      await expect(msg).toBeVisible()
      await expect(page.getByTestId('file-row')).toHaveCount(0)
      clearError((await msg.textContent()) ?? '')
    })
  }
  mt('api: POST /api/documents', 'fake.pdf', 'server magic-byte check', false, async () => {
    const s = await registerUser(BACKEND)
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(bytesOf(fx('fake.pdf')))], { type: 'application/pdf' }), 'fake.pdf')
    const res = await fetch(`${BACKEND}/api/documents`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` }, body: form })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    const body = (await res.json()) as { detail: string; code: string }
    expect(body.code).toBeTruthy()
    clearError(`${res.status} ${body.code}: ${body.detail}`)
  })

  // wrong file types for Office → PDF
  mt('word-to-pdf', 'sample.xlsx', 'wrong extension', true, async (page) => {
    await page.goto('/word-to-pdf')
    await page.getByTestId('file-input').first().setInputFiles(fx('sample.xlsx'))
    const msg = page.getByText(/not a supported .docx/i).first()
    await expect(msg).toBeVisible()
    clearError((await msg.textContent()) ?? '')
  })
  mt('word-to-pdf', 'png renamed .docx', 'content does not match', true, async (page) => {
    const fake = join(TMP, 'picture.docx')
    writeFileSync(fake, bytesOf(fx('sample.png')))
    await page.goto('/word-to-pdf')
    await upload(page, fake)
    await expect(page.getByTestId('file-row')).toHaveCount(1)
    clearError(await runExpectingError(page, /docx|Word|not a valid|unsupported|type/i))
  })

  // too large: the no-key stack runs with MAX_UPLOAD_MB=5
  mt('compress-pdf', 'large (6.4 MB) vs 5 MB limit', 'upload limit', false, async (page) => {
    await signIn(page, NOKEY_BACKEND)
    await page.goto('http://localhost:5274/compress-pdf')
    await upload(page, fx('large.pdf'))
    // flagged before anything is sent, with the real limit from the server
    const row = page.getByTestId('file-too-large')
    await expect(row).toContainText(/6\.4 MB.*5 MB upload limit/, { timeout: 30_000 })
    await expect(page.getByTestId('run-button')).toBeDisabled()
    // and if a client sends it anyway (through the dev proxy, as a browser would), the server's 413 arrives intact
    const res = await page.evaluate(async () => {
      const token = (JSON.parse(sessionStorage.getItem('rooman.auth.v1') ?? '{}') as { token?: string }).token
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(6 * 1024 * 1024).fill(37)], { type: 'application/pdf' }), 'big.pdf')
      const r = await fetch('/api/documents', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
      return { status: r.status, body: await r.text() }
    })
    expect(res.status, res.body).toBe(413)
    expect(JSON.parse(res.body).code).toBe('FILE_TOO_LARGE')
    clearError(`${(await row.textContent()) ?? ''} · API through proxy: 413 ${JSON.parse(res.body).detail}`)
  })

  // invalid page selections
  mt('extract-pages', 'multipage', 'invalid ranges', false, async (page) => {
    await open(page, '/extract-pages', fx('multipage.pdf'))
    for (const bad of ['20-30', '0', 'abc', '5-2']) {
      await page.getByTestId('page-range').fill(bad)
      await expect(page.getByRole('alert').first()).toBeVisible()
      await expect(page.getByTestId('run-button')).toBeDisabled()
    }
    await page.getByTestId('page-range').fill('')
    await expect(page.getByTestId('run-button')).toBeDisabled()
    clearError('out-of-range / malformed / empty selections are refused before running')
  })
  mt('delete-pages', 'multipage', 'delete every page', false, async (page) => {
    await open(page, '/delete-pages', fx('multipage.pdf'))
    await page.getByTestId('page-range').fill('1-12')
    clearError(await runExpectingError(page, /every page|at least one page/i))
  })
  mt('split-pdf', 'multipage', 'malformed ranges', false, async (page) => {
    await open(page, '/split-pdf', fx('multipage.pdf'))
    await page.getByTestId('split-ranges').fill('abc')
    await expect(page.getByTestId('run-button')).toBeDisabled()
    await page.getByTestId('split-ranges').fill('1-40')
    await expect(page.getByTestId('run-button')).toBeDisabled()
    clearError('malformed / out-of-range split ranges are refused before running')
  })
  mt('watermark-pdf', 'multipage', 'pages out of range', true, async (page) => {
    await open(page, '/watermark-pdf', fx('multipage.pdf'))
    await page.getByTestId('wm-text').fill('X')
    await page.getByLabel('Pages', { exact: true }).fill('99')
    clearError(await runExpectingError(page, /page/i))
  })
  mt('pdf-to-text', 'multipage', 'pages out of range', true, async (page) => {
    await open(page, '/pdf-to-text', fx('multipage.pdf'))
    await page.getByLabel('Pages', { exact: true }).fill('50')
    clearError(await runExpectingError(page, /page/i))
  })
})

// ───────────────────────── CHAIN: one upload through 6 tools (browser + server mixed) ─────────────────────────
test('chain × multipage: Rotate → Crop → Compress → Split → Edit → Protect on one upload', async ({ page }) => {
  cell('chain (6 tools)', 'multipage', 'rotate→crop→compress→split→edit→protect')
  const session = await signIn(page)
  const errors = watchErrors(page)
  await page.goto('/rotate-pdf')
  await page.getByTestId('file-input').first().setInputFiles(fx('multipage.pdf'))
  await expect(page.getByTestId('file-row')).toContainText('multipage.pdf')
  const carry = async (name: RegExp) => {
    await page.getByTestId('result-panel').getByRole('link', { name }).click()
    await expect(page.getByTestId('file-row')).toHaveCount(1)
  }

  await expect(page.getByTestId('page-grid')).toBeVisible()
  await page.getByTestId('rotate-all-right').click()
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible()

  await carry(/Crop PDF/)
  await expect(page.getByTestId('crop-box')).toBeVisible()
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible()

  await carry(/Compress PDF/) // server
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 120_000 })

  await carry(/Split PDF/)
  await page.getByTestId('split-ranges').fill('1-3')
  await page.getByTestId('run-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible()

  await page.getByTestId('result-panel').getByRole('link', { name: /Edit PDF/ }).click()
  await expect(page.getByTestId('editor-root')).toBeVisible()
  await expect(page.getByTestId('page-overlay').first()).toBeVisible()
  await fitPage(page)
  await pick(page, 'text')
  await clickAt(page, 0, [0.2, 0.5])
  await page.getByTestId('text-editor').fill('CHAIN6')
  await page.keyboard.press('Escape')
  await page.getByTestId('export-button').click()
  await expect(page.getByTestId('result-panel')).toBeVisible({ timeout: 60_000 })

  await carry(/Protect PDF/) // server
  await page.getByTestId('protect-password').fill('chain-pass-1')
  await page.getByTestId('protect-password2').fill('chain-pass-1')
  const locked = await run(page)
  await expect(PDFDocument.load(locked.bytes)).rejects.toThrow(/encrypted/i)
  // open the protected result again through the real API (upload → unlock) and check everything survived the chain
  const h = { Authorization: `Bearer ${session.token}` }
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(locked.bytes)], { type: 'application/pdf' }), 'locked.pdf')
  const up = (await (await fetch(`${BACKEND}/api/documents`, { method: 'POST', headers: h, body: form })).json()) as { id: string }
  const un = (await (await fetch(`${BACKEND}/api/security/unlock`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ document_id: up.id, password: 'chain-pass-1' }) })).json()) as { documents: { id: string }[] }
  const plain = new Uint8Array(await (await fetch(`${BACKEND}/api/documents/${un.documents[0].id}/download`, { headers: h })).arrayBuffer())
  const doc = await PDFDocument.load(plain)
  expect(doc.getPageCount()).toBe(3)
  expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 90, 90])
  const texts = (await pageTexts(plain)).map(squash)
  expect(texts[0]).toContain('CHAIN6')
  expect(texts.join('|')).toContain('CH03X')
  expect(texts.join('|')).not.toContain('CH04X')
  expect(errors.filter((e) => /detach|ArrayBuffer|pageerror/i.test(e))).toEqual([])
  expect(errors.filter((e) => !/status of 4\d\d/.test(e))).toEqual([])
})
