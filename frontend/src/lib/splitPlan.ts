import { formatPageList, parseRanges, type PageRange } from './ranges'
import { bookmarkParts, type Bookmark } from './pdfOps/split'

/** One output PDF as the screen describes it before anything is processed. */
export interface PlanPart {
  label: string
  start: number
  end: number
  /** a short extra remark, e.g. "pages before the first bookmark" */
  note?: string
}
export type Plan = { ok: true; parts: PlanPart[]; notes: string[] } | { ok: false; error: string }

export const pagesLabel = (start: number, end: number) => (start === end ? `page ${start}` : `pages ${start}\u2013${end}`)
const count = (start: number, end: number) => end - start + 1
const rangeText = (r: PageRange) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`)

/** Which pages are in no part at all, as "4, 8-9" (empty when every page is used). */
function unused(parts: { start: number; end: number }[], total: number): string {
  const used = new Set<number>()
  for (const p of parts) for (let n = p.start; n <= p.end; n++) used.add(n)
  const missing: number[] = []
  for (let n = 1; n <= total; n++) if (!used.has(n)) missing.push(n)
  return formatPageList(missing).replace(/,/g, ', ')
}

/** "1-3, 4-6, 7-10": one PDF per range. Ranges must stay inside the document and must not share a page. */
export function planRanges(spec: string, total: number): Plan {
  if (!spec.trim()) return { ok: false, error: 'Type the pages for each PDF, like 1-3, 4-6, 7-10.' }
  let ranges: PageRange[]
  try {
    ranges = parseRanges(spec, total)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const sorted = ranges.map((r, i) => ({ ...r, i })).sort((a, b) => a.start - b.start || a.end - b.end)
  for (let k = 1; k < sorted.length; k++) {
    const a = sorted[k - 1]
    const b = sorted[k]
    if (b.start <= a.end) {
      const from = Math.max(a.start, b.start)
      const to = Math.min(a.end, b.end)
      return { ok: false, error: `${rangeText(a)} and ${rangeText(b)} both contain ${pagesLabel(from, to)}. A page can go in only one PDF here, so change one of the ranges.` }
    }
  }
  const parts = ranges.map((r, i) => ({ label: `PDF ${i + 1}`, start: r.start, end: r.end }))
  const notes: string[] = []
  const left = unused(parts, total)
  if (left) notes.push(`Not in any PDF: ${left}.`)
  return { ok: true, parts, notes }
}

/** Groups of `n` pages; the last group keeps whatever is left. */
export function planEvery(nText: string, total: number): Plan {
  const raw = nText.trim()
  if (!raw) return { ok: false, error: 'Enter how many pages each PDF should have.' }
  if (!/^\d+$/.test(raw)) return { ok: false, error: 'Pages per PDF must be a whole number, like 3.' }
  const n = parseInt(raw, 10)
  if (n < 1) return { ok: false, error: 'Each PDF needs at least 1 page.' }
  const parts: PlanPart[] = []
  for (let s = 1; s <= total; s += n) parts.push({ label: `PDF ${parts.length + 1}`, start: s, end: Math.min(total, s + n - 1) })
  const notes: string[] = []
  if (n >= total) notes.push(`${n} is at least the number of pages (${total}), so you get one PDF with every page.`)
  else if (total % n) notes.push(`The last PDF has only ${total % n} page${total % n === 1 ? '' : 's'}, because ${total} does not divide evenly by ${n}.`)
  return { ok: true, parts, notes }
}

/** The chosen top-level bookmarks cut the document; each part runs to the next chosen bookmark. */
export function planBookmarks(marks: Bookmark[], picked: ReadonlySet<number>, total: number): Plan {
  const chosen = marks.filter((_, i) => picked.has(i))
  if (!chosen.length) return { ok: false, error: 'Tick at least one bookmark to split at.' }
  const parts = bookmarkParts(chosen, total).map((p) => ({ label: p.frontMatter ? 'Pages before the first bookmark' : p.title, start: p.start, end: p.end, note: p.frontMatter ? 'front matter' : undefined }))
  const notes: string[] = []
  if (chosen.length < marks.length) notes.push('Bookmarks you did not tick do not start a new PDF: their pages stay in the PDF before them.')
  return { ok: true, parts, notes }
}

export type SizeUnit = 'KB' | 'MB'
/** What a size limit typed by the user means in bytes, or why it is not usable. */
export function parseSizeLimit(text: string, unit: SizeUnit): { ok: true; bytes: number } | { ok: false; error: string } {
  const raw = text.trim()
  if (!raw) return { ok: false, error: 'Enter the biggest size a file may have.' }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(raw)) return { ok: false, error: /^-/.test(raw) ? 'The size cannot be negative.' : 'The size must be a number, like 2 or 0.5.' }
  const bytes = parseFloat(raw) * (unit === 'MB' ? 1024 * 1024 : 1024)
  if (bytes < 10 * 1024) return { ok: false, error: 'Use at least 10 KB: smaller than that is below the size of a single empty page.' }
  return { ok: true, bytes }
}

/** A rough guess from the sizes alone (a real plan is better and is used when the file is small enough). */
export function estimateSizeParts(fileBytes: number, limitBytes: number, total: number): number {
  return Math.min(total, Math.max(1, Math.ceil(fileBytes / limitBytes)))
}

export function sizePlanToParts(ranges: PageRange[], oversizePages: number[]): Plan {
  const over = new Set(oversizePages)
  const parts = ranges.map((r, i) => ({ label: `PDF ${i + 1}`, start: r.start, end: r.end, note: over.has(r.start) && r.start === r.end ? 'larger than the limit on its own' : undefined }))
  const notes: string[] = []
  if (oversizePages.length) notes.push(`${oversizePages.length === 1 ? `Page ${oversizePages[0]} is` : `Pages ${oversizePages.join(', ')} are`} bigger than the limit by itself, so ${oversizePages.length === 1 ? 'it' : 'each'} gets its own file and cannot be made smaller by splitting.`)
  return { ok: true, parts, notes }
}

export const partPages = (p: { start: number; end: number }) => count(p.start, p.end)

/** Split before every page whose text contains `needle`. Pages before the first match stay together as their own part. */
export function planText(needle: string, matchCase: boolean, pageTexts: string[] | null, total: number): Plan {
  const q = needle.trim()
  if (!q) return { ok: false, error: 'Type the text that marks the start of each new PDF.' }
  if (!pageTexts) return { ok: false, error: 'Reading the text of the pages…' }
  const norm = (t: string) => (matchCase ? t : t.toLowerCase())
  const key = norm(q)
  const starts: number[] = []
  for (let i = 0; i < total; i++) if (norm(pageTexts[i] ?? '').includes(key)) starts.push(i + 1)
  if (!starts.length) return { ok: false, error: `No page contains "${q}". Scanned pages have no text to search: run OCR PDF first.` }
  const parts: PlanPart[] = []
  if (starts[0] > 1) parts.push({ label: 'Pages before the first match', start: 1, end: starts[0] - 1, note: 'front matter' })
  starts.forEach((s, i) => parts.push({ label: `From "${q}" on page ${s}`, start: s, end: (starts[i + 1] ?? total + 1) - 1 }))
  return { ok: true, parts, notes: [`${starts.length} page${starts.length === 1 ? '' : 's'} contain "${q}".`] }
}
