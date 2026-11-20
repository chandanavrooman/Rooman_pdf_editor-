/**
 * Page-range parsing. 1-based, inclusive.
 * Syntax: "1-3,5,8-" (open end = last page), "-4" (first..4), "last", "2-last", "all".
 */
export class RangeError_ extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RangeError'
  }
}

export interface PageRange {
  start: number
  end: number
}

function token(t: string, total: number, isEnd: boolean): number {
  const s = t.trim().toLowerCase()
  if (s === 'last' || s === 'end') return total
  if (!/^\d+$/.test(s)) throw new RangeError_(`"${t}" is not a valid page number.`)
  const n = parseInt(s, 10)
  if (n < 1) throw new RangeError_(`Page numbers start at 1 (got ${n}).`)
  if (n > total) throw new RangeError_(`Page ${n} is out of range — the document has ${total} page${total === 1 ? '' : 's'}.`)
  void isEnd
  return n
}

/** Parse into ordered ranges (keeps user order; a descending range like 5-3 is an error). */
export function parseRanges(spec: string, total: number): PageRange[] {
  const s = spec.trim()
  if (!s) throw new RangeError_('Enter at least one page or range, e.g. 1-3,5.')
  if (total < 1) throw new RangeError_('The document has no pages.')
  if (s.toLowerCase() === 'all') return [{ start: 1, end: total }]
  const out: PageRange[] = []
  for (const partRaw of s.split(/[,;]/)) {
    const part = partRaw.trim()
    if (!part) continue
    const m = part.match(/^([^-]*)-([^-]*)$/)
    if (m && part.includes('-')) {
      const a = m[1].trim()
      const b = m[2].trim()
      const start = a === '' ? 1 : token(a, total, false)
      const end = b === '' ? total : token(b, total, true)
      if (start > end) throw new RangeError_(`Range "${part}" is backwards — use ${end}-${start}.`)
      out.push({ start, end })
    } else if (part.includes('-')) {
      throw new RangeError_(`"${part}" is not a valid range.`)
    } else {
      const n = token(part, total, false)
      out.push({ start: n, end: n })
    }
  }
  if (!out.length) throw new RangeError_('Enter at least one page or range, e.g. 1-3,5.')
  return out
}

/** Flatten to a list of 1-based page numbers. Duplicates kept only if `keepDuplicates`. */
export function parsePageList(spec: string, total: number, keepDuplicates = false): number[] {
  const pages: number[] = []
  const seen = new Set<number>()
  for (const r of parseRanges(spec, total)) {
    for (let p = r.start; p <= r.end; p++) {
      if (!keepDuplicates && seen.has(p)) continue
      seen.add(p)
      pages.push(p)
    }
  }
  return pages
}

/** Format a sorted list of page numbers back into a compact range string. */
export function formatPageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`)
    i = j + 1
  }
  return parts.join(',')
}
