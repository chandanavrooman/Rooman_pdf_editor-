import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { addBookmarks, parseBookmarkLines, readBookmarks, removeAnnotations } from './contentTools'
import { planRenames, safeName } from '../renamePlan'

async function withAnnots(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const p = d.addPage([200, 200])
  const mk = (sub: string, extra: Record<string, unknown> = {}) => d.context.register(d.context.obj({ Type: 'Annot', Subtype: sub, Rect: [10, 10, 50, 30], ...extra }))
  const hl = mk('Highlight')
  const popup = mk('Popup', { Parent: hl })
  const link = mk('Link', { A: { S: 'URI', URI: 'https://example.com' } })
  const widget = mk('Widget')
  p.node.set(PDFName.of('Annots'), d.context.obj([hl, popup, link, widget]))
  d.addPage([200, 200])
  return d.save()
}
const subtypes = async (b: Uint8Array) => {
  const d = await PDFDocument.load(b)
  const a = d.getPage(0).node.Annots()
  return a ? Array.from({ length: a.size() }, (_, i) => (a.lookup(i, PDFDict).get(PDFName.of('Subtype')) as PDFName).decodeText()) : []
}

describe('removeAnnotations', () => {
  it('removes marks and their popups but keeps links and form fields by default', async () => {
    const r = await removeAnnotations(await withAnnots(), { markup: true, links: false })
    expect(r.removed).toEqual({ markup: 1, links: 0 })
    expect(await subtypes(r.bytes)).toEqual(['Link', 'Widget'])
  })
  it('can remove links too, and never touches form fields', async () => {
    const r = await removeAnnotations(await withAnnots(), { markup: true, links: true })
    expect(await subtypes(r.bytes)).toEqual(['Widget'])
  })
  it('respects the page choice', async () => {
    const r = await removeAnnotations(await withAnnots(), { markup: true, links: true }, [2])
    expect(r.removed).toEqual({ markup: 0, links: 0 })
    expect((await subtypes(r.bytes)).length).toBe(4)
  })
})

describe('bookmarks', () => {
  it('parses titles, pages and nesting, and reports bad lines', () => {
    const r = parseBookmarkLines('Intro, 1\n  Background | 2\nMethods 5\nBad line\nToo far, 99', 10)
    expect(r.items).toEqual([{ title: 'Intro', page: 1, level: 0 }, { title: 'Background', page: 2, level: 1 }, { title: 'Methods', page: 5, level: 0 }])
    expect(r.errors).toHaveLength(2)
    expect(r.errors[0]).toMatch(/Line 4/)
    expect(r.errors[1]).toMatch(/page 99/)
  })
  it('writes an outline that reads back with the same titles, pages and levels', async () => {
    const d = await PDFDocument.create()
    for (let i = 0; i < 6; i++) d.addPage([100, 100])
    const items = [{ title: 'One', page: 1, level: 0 }, { title: 'One.A', page: 2, level: 1 }, { title: 'Two é', page: 5, level: 0 }]
    const out = await addBookmarks(await d.save(), items)
    expect(await readBookmarks(out)).toEqual(items)
    const re = await PDFDocument.load(out)
    const outlines = re.catalog.lookup(PDFName.of('Outlines'), PDFDict)
    expect(outlines.get(PDFName.of('Count'))?.toString()).toBe('3')
    expect(re.catalog.lookup(PDFName.of('PageMode'))?.toString()).toBe('/UseOutlines')
    void PDFArray
  })
  it('refuses an empty list or a page that does not exist', async () => {
    const d = await PDFDocument.create()
    d.addPage([100, 100])
    const b = await d.save()
    await expect(addBookmarks(b, [])).rejects.toThrow(/at least one/)
    await expect(addBookmarks(b, [{ title: 'x', page: 2, level: 0 }])).rejects.toThrow(/pages 1 to 1/)
  })
})

describe('rename plans', () => {
  it('uses the title, then the old name, and keeps names unique', () => {
    const n = planRenames([{ name: 'a.pdf', title: 'Report' }, { name: 'b.pdf', title: 'Report' }, { name: 'c.pdf' }], 'title')
    expect(n).toEqual(['Report.pdf', 'Report (2).pdf', 'c.pdf'])
  })
  it('builds names from a pattern with a padded counter', () => {
    expect(planRenames([{ name: 'x.pdf' }, { name: 'y.pdf' }], 'pattern', 'Invoice-{n:3}')).toEqual(['Invoice-001.pdf', 'Invoice-002.pdf'])
  })
  it('removes characters that file names cannot contain', () => {
    expect(safeName('A/B: "C"?*')).toBe('A B C')
    expect(planRenames([{ name: 'x.pdf', firstLine: '  Q3 / 2026: Plan. ' }], 'first-line')).toEqual(['Q3 2026 Plan.pdf'])
  })
})
