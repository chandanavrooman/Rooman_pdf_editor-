import { PDFDocument } from 'pdf-lib'
import type { PageRange } from '../ranges'
import { loadDoc, noProgress, pad, pdfSave, PdfOpError, safeFileName, type OpFile, type ProgressFn } from './common'

async function extractRange(src: PDFDocument, start: number, end: number): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const idx: number[] = []
  for (let p = start; p <= end; p++) idx.push(p - 1)
  const copied = await out.copyPages(src, idx)
  copied.forEach((p) => out.addPage(p))
  return pdfSave(out)
}

function rangeLabel(r: PageRange): string {
  return r.start === r.end ? `page-${r.start}` : `pages-${r.start}-${r.end}`
}

/** One output file per range. */
export async function splitByRanges(bytes: Uint8Array, baseName: string, ranges: PageRange[], onProgress: ProgressFn = noProgress): Promise<OpFile[]> {
  const src = await loadDoc(bytes)
  const total = src.getPageCount()
  if (!ranges.length) throw new PdfOpError('Enter at least one range.')
  const out: OpFile[] = []
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    if (r.start < 1 || r.end > total) throw new PdfOpError(`Range ${r.start}-${r.end} is outside the document (${total} pages).`)
    onProgress(i / ranges.length, `Creating part ${i + 1} of ${ranges.length}`)
    out.push({ name: `${safeFileName(baseName)}-${rangeLabel(r)}.pdf`, bytes: await extractRange(src, r.start, r.end) })
  }
  onProgress(1)
  return out
}

/** Every N pages. */
export async function splitEveryN(bytes: Uint8Array, baseName: string, n: number, onProgress: ProgressFn = noProgress): Promise<OpFile[]> {
  if (!Number.isInteger(n) || n < 1) throw new PdfOpError('Pages per file must be a whole number of at least 1.')
  const src = await loadDoc(bytes)
  const total = src.getPageCount()
  const ranges: PageRange[] = []
  for (let s = 1; s <= total; s += n) ranges.push({ start: s, end: Math.min(total, s + n - 1) })
  return splitByRanges(bytes, baseName, ranges, onProgress)
}

export interface Bookmark {
  title: string
  /** 0-based page index */
  pageIndex: number
}

export interface BookmarkPart {
  title: string
  /** 1-based, inclusive */
  start: number
  end: number
  /** true for the pages before the first chosen bookmark */
  frontMatter?: boolean
}

/**
 * The parts a set of (top-level) bookmarks cuts a document of `total` pages into: each bookmark starts a part that runs up to the next chosen
 * bookmark, so its sub-bookmarks and their pages stay inside it. Bookmarks on the same page collapse into one; pages before the first become "front matter".
 */
export function bookmarkParts(marks: Bookmark[], total: number): BookmarkPart[] {
  const sorted = [...marks].filter((m) => m.pageIndex >= 0 && m.pageIndex < total).sort((a, b) => a.pageIndex - b.pageIndex)
  const starts: { title: string; start: number }[] = []
  for (const m of sorted) {
    if (!starts.length || starts[starts.length - 1].start !== m.pageIndex + 1) starts.push({ title: m.title, start: m.pageIndex + 1 })
  }
  const parts: BookmarkPart[] = []
  if (!starts.length) return parts
  if (starts[0].start > 1) parts.push({ title: 'front-matter', start: 1, end: starts[0].start - 1, frontMatter: true })
  starts.forEach((s, i) => parts.push({ title: s.title, start: s.start, end: i + 1 < starts.length ? starts[i + 1].start - 1 : total }))
  return parts
}

/** Split at each chosen top-level bookmark; pages before the first one become a "front matter" part. */
export async function splitByBookmarks(bytes: Uint8Array, baseName: string, marks: Bookmark[], onProgress: ProgressFn = noProgress): Promise<OpFile[]> {
  const src = await loadDoc(bytes)
  const total = src.getPageCount()
  const parts = bookmarkParts(marks, total)
  if (!parts.length) throw new PdfOpError('This PDF has no usable bookmarks.')
  const out: OpFile[] = []
  for (let i = 0; i < parts.length; i++) {
    onProgress(i / parts.length, `Creating part ${i + 1} of ${parts.length}`)
    const p = parts[i]
    out.push({ name: `${safeFileName(baseName)}-${pad(i + 1, 2)}-${safeFileName(p.title).slice(0, 60)}.pdf`, bytes: await extractRange(src, p.start, p.end) })
  }
  onProgress(1)
  return out
}

export interface SizeSplitResult {
  files: OpFile[]
  /** Parts that exceed the limit because a single page is already larger than it. */
  oversize: string[]
}

export interface SizePlan {
  ranges: PageRange[]
  /** 1-based pages that are bigger than the limit all by themselves (each is kept as its own file) */
  oversizePages: number[]
}

/**
 * Decide which pages go in which file so each file is at most `maxBytes`. Greedy packing with REAL size checks:
 * grow a part, serialise it, and when the real output exceeds the limit (and the part has more than one page) the last page starts the next part.
 * `isCancelled` lets a caller abandon a long run.
 */
export async function planBySize(bytes: Uint8Array, maxBytes: number, onProgress: ProgressFn = noProgress, isCancelled: () => boolean = () => false): Promise<SizePlan> {
  if (!(maxBytes > 1024)) throw new PdfOpError('Maximum size must be larger than 1 KB.')
  const src = await loadDoc(bytes)
  const total = src.getPageCount()
  const ranges: PageRange[] = []
  const oversizePages: number[] = []
  let start = 1
  while (start <= total) {
    if (isCancelled()) throw new PdfOpError('Cancelled.')
    // Grow by doubling to find an upper bound, then binary search for the exact fit (real sizes).
    const sizeOf = async (end: number) => (await extractRange(src, start, end)).byteLength
    onProgress((start - 1) / total, `Packing from page ${start}`)
    let best = start
    if ((await sizeOf(start)) > maxBytes) {
      oversizePages.push(start)
    } else {
      let lo = start
      let hi = start
      let step = 1
      while (hi < total) {
        const next = Math.min(total, hi + step)
        if ((await sizeOf(next)) <= maxBytes) {
          lo = next
          hi = next
          step *= 2
        } else {
          hi = next
          break
        }
      }
      if (hi === lo) best = lo
      else {
        // lo fits, hi doesn't.
        let a = lo
        let b = hi
        while (b - a > 1) {
          const mid = Math.floor((a + b) / 2)
          if ((await sizeOf(mid)) <= maxBytes) a = mid
          else b = mid
        }
        best = a
      }
    }
    ranges.push({ start, end: best })
    start = best + 1
  }
  return { ranges, oversizePages }
}

/** Split so each file is at most `maxBytes` (see planBySize). A single page that is larger than the limit becomes its own file and is reported. */
export async function splitBySize(bytes: Uint8Array, baseName: string, maxBytes: number, onProgress: ProgressFn = noProgress): Promise<SizeSplitResult> {
  const plan = await planBySize(bytes, maxBytes, (f, l) => onProgress(f / 2, l))
  const files = await splitByRanges(bytes, baseName, plan.ranges, (f) => onProgress(0.5 + f / 2, 'Writing parts'))
  onProgress(1)
  return { files, oversize: plan.oversizePages.map((p) => `page ${p}`) }
}
