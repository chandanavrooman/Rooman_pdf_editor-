import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, PDFName, PDFDict, PDFArray } from 'pdf-lib'
import { normalizeUrl } from './urlNormalize'
import { exportEdited, ExportError } from './export'
import { makeLink } from './objects'
import { loadNotoFromDisk } from '@/test/nodeRender'
import type { EditorDoc, EditorObject } from './types'

const FIX = (n: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../tests/fixtures/${n}`, import.meta.url))))
const STD = fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).split(String.fromCharCode(92)).join('/')
const doc = (objects: EditorObject[]): EditorDoc => ({ objects, formValues: {}, assets: {} })
const deps = { loadFontBytes: loadNotoFromDisk }

describe('5 link address: validate and normalise', () => {
  const ok: [string, string][] = [
    ['futureacad.ae', 'https://futureacad.ae'],
    ['  futureacad.ae  ', 'https://futureacad.ae'],
    ['https://fututreacad.ae', 'https://fututreacad.ae'], // spelled like a domain, so it passes the syntax check (see the DNS note in the report)
    ['www.example.com/path/page.html?q=1&r=2#top', 'https://www.example.com/path/page.html?q=1&r=2#top'],
    ['HTTP://Example.COM/A', 'http://example.com/A'],
    ['example.com:8080/x', 'https://example.com:8080/x'],
    ['example.com/', 'https://example.com/'],
    ['localhost:3000/app', 'https://localhost:3000/app'],
    ['//cdn.example.org/lib.js', 'https://cdn.example.org/lib.js'],
    ['someone@rooman.com', 'mailto:someone@rooman.com'],
    ['mailto:someone@rooman.com?subject=Hi', 'mailto:someone@rooman.com?subject=Hi'],
    ['tel:+971-4-123-4567', 'tel:+971-4-123-4567'],
    ['https://münchen.de/straße', 'https://xn--mnchen-3ya.de/stra%C3%9Fe'],
  ]
  it.each(ok)('accepts "%s" -> %s', (input, expected) => {
    const r = normalizeUrl(input)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.url).toBe(expected)
  })

  const bad: [string, RegExp][] = [
    ['', /Enter the address/],
    ['https://', /Enter the address/],
    ['exa mple.com', /a space/],
    ['example.com/<script>', /“<”/],
    ['example.com/"x"', /“"”/],
    ['example.com/a|b', /“\|”/],
    ['exam\tple.com', /not allowed/],
    ['javascript:alert(1)', /“javascript:” links are not allowed/],
    ['data:text/html,hi', /“data:” links are not allowed/],
    ['ftp://example.com', /“ftp:” links are not allowed/],
    ['file:///etc/passwd', /“file:” links are not allowed/],
    ['example', /not a complete web address/],
    ['example..com', /empty part|not a valid/],
    ['exa_mple.com', /not a valid part/],
    ['-example.com', /not a valid part/],
    ['example.c', /not a valid ending/],
    ['https://user:secret@example.com', /user name or password/],
    ['mailto:not-an-email', /valid e-mail/],
    ['tel:abc', /valid phone/],
  ]
  it.each(bad)('rejects "%s"', (input, why) => {
    const r = normalizeUrl(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(why)
  })
})

describe('5 link export: /A URI action and a visible clickable area', () => {
  const src = FIX('three-pages.pdf')

  it('a link typed as "futureacad.ae" is exported as https://futureacad.ae with /A /URI and a visible outline', async () => {
    const out = await exportEdited(src, doc([makeLink(0, { x: 60, y: 150, w: 120, h: 20 }, { kind: 'url', url: 'futureacad.ae' })]), {}, deps)
    // 1. exactly what the PDF contains
    const pdf = await PDFDocument.load(out)
    const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots')) as PDFArray
    const a = annots.lookup(0) as PDFDict
    const action = a.lookup(PDFName.of('A')) as PDFDict
    const raw = {
      Subtype: (a.lookup(PDFName.of('Subtype')) as PDFName).decodeText(),
      S: (action.lookup(PDFName.of('S')) as PDFName).decodeText(),
      URI: String(action.lookup(PDFName.of('URI'))),
      Rect: (a.lookup(PDFName.of('Rect')) as PDFArray).asArray().map((n) => Number(String(n))),
      Border: (a.lookup(PDFName.of('Border')) as PDFArray).asArray().map((n) => Number(String(n))),
      C: (a.lookup(PDFName.of('C')) as PDFArray).asArray().map((n) => Number(String(n))),
    }
    console.info('annotation as stored:', JSON.stringify(raw))
    expect(raw.Subtype).toBe('Link')
    expect(raw.S).toBe('URI')
    expect(raw.URI).toBe('(https://futureacad.ae)')
    expect(raw.Border).toEqual([0, 0, 0.75]) // a visible 0.75 pt outline
    expect(raw.C).toEqual([0.05, 0.4, 0.8])
    // 2. what a PDF reader (pdf.js) sees: the clickable area and the address it would open
    const d = await pdfjs.getDocument({ data: out.slice(0), standardFontDataUrl: STD, verbosity: 0, useSystemFonts: false }).promise
    const page = await d.getPage(1)
    const ann = (await page.getAnnotations()).filter((x) => x.subtype === 'Link')
    console.info('pdf.js link annotations:', JSON.stringify(ann.map((x) => ({ url: x.url, rect: x.rect.map((v: number) => +v.toFixed(2)) }))))
    expect(ann).toHaveLength(1)
    expect(new URL(ann[0].url).href).toBe(new URL('https://futureacad.ae').href) // the reader opens the same address (pdf.js writes the trailing slash itself)
    const [x0, y0, x1, y1] = ann[0].rect
    expect(x1 - x0).toBeGreaterThanOrEqual(6)
    expect(y1 - y0).toBeGreaterThanOrEqual(6)
    expect(x0).toBeGreaterThanOrEqual(0)
    expect(x1).toBeLessThanOrEqual(595.28)
    // the area sits where it was drawn: page space y=150..170 from the top -> PDF y = 841.89-170 .. 841.89-150
    expect(y0).toBeCloseTo(841.89 - 170, 0)
    expect(y1).toBeCloseTo(841.89 - 150, 0)
    await d.loadingTask.destroy()
  })

  it('turning the outline off gives an invisible (but still clickable) area', async () => {
    const l = makeLink(0, { x: 60, y: 150, w: 120, h: 20 }, { kind: 'url', url: 'https://rooman.com/x' })
    l.showBorder = false
    const out = await exportEdited(src, doc([l]), {}, deps)
    const pdf = await PDFDocument.load(out)
    const a = (pdf.getPage(0).node.lookup(PDFName.of('Annots')) as PDFArray).lookup(0) as PDFDict
    expect((a.lookup(PDFName.of('Border')) as PDFArray).asArray().map((n) => Number(String(n)))).toEqual([0, 0, 0])
    expect(a.lookup(PDFName.of('C'))).toBeUndefined()
  })

  it('a tiny link area is enlarged to at least 6 × 6 pt so it can be clicked', async () => {
    const out = await exportEdited(src, doc([makeLink(0, { x: 60, y: 150, w: 2, h: 2 }, { kind: 'url', url: 'rooman.com' })]), {}, deps)
    const d = await pdfjs.getDocument({ data: out.slice(0), standardFontDataUrl: STD, verbosity: 0 }).promise
    const [x0, y0, x1, y1] = (await (await d.getPage(1)).getAnnotations()).find((x) => x.subtype === 'Link')!.rect
    expect(x1 - x0).toBeCloseTo(6, 1)
    expect(y1 - y0).toBeCloseTo(6, 1)
    await d.loadingTask.destroy()
  })

  it('an invalid address stops the export with the reason', async () => {
    await expect(exportEdited(src, doc([makeLink(0, { x: 60, y: 150, w: 120, h: 20 }, { kind: 'url', url: 'javascript:alert(1)' })]), {}, deps)).rejects.toThrow(ExportError)
    await expect(exportEdited(src, doc([makeLink(0, { x: 60, y: 150, w: 120, h: 20 }, { kind: 'url', url: 'exa mple.com' })]), {}, deps)).rejects.toThrow(/a space/)
  })

  it('the address in the user’s own file: https://fututreacad.ae passes the syntax check', async () => {
    const pdf = await PDFDocument.load(FIX('chandana-report-edited-annotated.pdf'))
    const an = pdf.getPage(0).node.lookup(PDFName.of('Annots')) as PDFArray
    let uri = ''
    for (let i = 0; i < an.size(); i++) {
      const d = an.lookup(i) as PDFDict
      if ((d.lookup(PDFName.of('Subtype')) as PDFName).decodeText() === 'Link') uri = String((d.lookup(PDFName.of('A')) as PDFDict).lookup(PDFName.of('URI'))).slice(1, -1)
    }
    console.info(`link in the file: ${uri} -> ${JSON.stringify(normalizeUrl(uri))}`)
    expect(uri).toBe('https://fututreacad.ae')
    expect(normalizeUrl(uri).ok).toBe(true)
  })
})
