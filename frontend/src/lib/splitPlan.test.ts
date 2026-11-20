import { describe, expect, it } from 'vitest'
import { estimateSizeParts, parseSizeLimit, planBookmarks, planEvery, planRanges, sizePlanToParts } from './splitPlan'
import { bookmarkParts } from './pdfOps/split'

const ok = (p: ReturnType<typeof planRanges>) => {
  if (!p.ok) throw new Error(p.error)
  return p
}
const spans = (p: ReturnType<typeof planRanges>) => ok(p).parts.map((x) => [x.start, x.end])

describe('planRanges', () => {
  it('each range is one PDF, in the order typed', () => {
    expect(spans(planRanges('1-3, 4-6, 7-10', 10))).toEqual([[1, 3], [4, 6], [7, 10]])
    expect(spans(planRanges('5, 1-2', 6))).toEqual([[5, 5], [1, 2]])
  })
  it('lists the pages that end up in no PDF', () => {
    expect(ok(planRanges('1-3, 7-9', 10)).notes).toEqual(['Not in any PDF: 4-6, 10.'])
    expect(ok(planRanges('1-5, 6-10', 10)).notes).toEqual([])
  })
  it('refuses overlapping ranges and names the shared pages', () => {
    const p = planRanges('1-5, 3-7', 10)
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.error).toMatch(/1-5 and 3-7 both contain pages 3–5/)
    const q = planRanges('4, 4', 10)
    expect(q.ok).toBe(false)
    if (!q.ok) expect(q.error).toMatch(/both contain page 4/)
  })
  it('refuses a range typed in a different order that still overlaps', () => {
    expect(planRanges('7-9, 1-8', 10).ok).toBe(false)
  })
  it('refuses out-of-range, backwards, empty and garbage input with a message', () => {
    for (const [spec, msg] of [['1-12', /out of range/], ['5-3', /backwards/], ['', /Type the pages/], ['abc', /not a valid page number/], ['0', /start at 1/]] as const) {
      const p = planRanges(spec, 10)
      expect(p.ok, spec).toBe(false)
      if (!p.ok) expect(p.error).toMatch(msg)
    }
  })
})

describe('planEvery', () => {
  it('12 pages by 3 is 4 PDFs', () => {
    const p = ok(planEvery('3', 12))
    expect(p.parts.map((x) => [x.start, x.end])).toEqual([[1, 3], [4, 6], [7, 9], [10, 12]])
    expect(p.notes).toEqual([])
  })
  it('keeps the incomplete last group and says so', () => {
    const p = ok(planEvery('5', 12))
    expect(p.parts.map((x) => [x.start, x.end])).toEqual([[1, 5], [6, 10], [11, 12]])
    expect(p.notes[0]).toMatch(/last PDF has only 2 pages/)
    expect(ok(planEvery('5', 11)).notes[0]).toMatch(/only 1 page,/)
  })
  it('more pages per PDF than the document has gives one PDF', () => {
    const p = ok(planEvery('20', 12))
    expect(p.parts).toHaveLength(1)
    expect(p.notes[0]).toMatch(/one PDF with every page/)
  })
  it.each([['', /Enter how many/], ['0', /at least 1/], ['-2', /whole number/], ['2.5', /whole number/], ['x', /whole number/]])('rejects %j', (v, msg) => {
    const p = planEvery(v, 12)
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.error).toMatch(msg as RegExp)
  })
})

describe('planBookmarks', () => {
  const marks = [{ title: 'Intro', pageIndex: 0 }, { title: 'Body', pageIndex: 3 }, { title: 'End', pageIndex: 7 }]
  it('every bookmark starts a part that runs to the next one', () => {
    const p = ok(planBookmarks(marks, new Set([0, 1, 2]), 10))
    expect(p.parts.map((x) => [x.label, x.start, x.end])).toEqual([['Intro', 1, 3], ['Body', 4, 7], ['End', 8, 10]])
  })
  it('pages before the first bookmark become a front-matter part', () => {
    const p = ok(planBookmarks([{ title: 'One', pageIndex: 2 }], new Set([0]), 6))
    expect(p.parts.map((x) => [x.start, x.end])).toEqual([[1, 2], [3, 6]])
    expect(p.parts[0].label).toMatch(/before the first bookmark/)
  })
  it('unticked bookmarks do not cut: their pages stay in the part before them', () => {
    const p = ok(planBookmarks(marks, new Set([0, 2]), 10))
    expect(p.parts.map((x) => [x.label, x.start, x.end])).toEqual([['Intro', 1, 7], ['End', 8, 10]])
    expect(p.notes[0]).toMatch(/did not tick/)
  })
  it('needs at least one bookmark ticked', () => {
    const p = planBookmarks(marks, new Set(), 10)
    expect(p.ok).toBe(false)
  })
  it('bookmarks on the same page collapse and out-of-range ones are ignored', () => {
    expect(bookmarkParts([{ title: 'A', pageIndex: 1 }, { title: 'B', pageIndex: 1 }, { title: 'Z', pageIndex: 99 }], 5).map((x) => [x.title, x.start, x.end])).toEqual([['front-matter', 1, 1], ['A', 2, 5]])
  })
})

describe('parseSizeLimit', () => {
  it('converts KB and MB', () => {
    expect(parseSizeLimit('2', 'MB')).toEqual({ ok: true, bytes: 2 * 1024 * 1024 })
    expect(parseSizeLimit('500', 'KB')).toEqual({ ok: true, bytes: 500 * 1024 })
    expect(parseSizeLimit('0.5', 'MB')).toEqual({ ok: true, bytes: 512 * 1024 })
  })
  it.each([['', /Enter the biggest/], ['-1', /cannot be negative/], ['abc', /must be a number/], ['5', 'KB']])('rejects %j', (v, msg) => {
    const r = parseSizeLimit(v as string, 'KB')
    expect(r.ok).toBe(false)
    if (!r.ok && msg !== 'KB') expect(r.error).toMatch(msg as RegExp)
  })
  it('estimates from sizes and never claims more files than pages', () => {
    expect(estimateSizeParts(10_000_000, 2_000_000, 50)).toBe(5)
    expect(estimateSizeParts(10_000_000, 1, 3)).toBe(3)
    expect(estimateSizeParts(100, 10_000_000, 3)).toBe(1)
  })
  it('flags an over-limit single page', () => {
    const p = sizePlanToParts([{ start: 1, end: 2 }, { start: 3, end: 3 }], [3])
    expect(p.ok && p.parts[1].note).toMatch(/larger than the limit/)
    expect(p.ok && p.notes[0]).toMatch(/Page 3 is bigger than the limit/)
  })
})
