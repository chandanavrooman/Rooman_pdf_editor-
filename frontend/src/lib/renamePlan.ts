export type RenameSource = 'title' | 'first-line' | 'pattern'

export interface RenameInfo {
  /** the file's current name, with extension */
  name: string
  /** document title from the PDF's own properties */
  title?: string
  /** first line of text on page 1 */
  firstLine?: string
}

const BAD = /[\\/:*?"<>|]/g

/** A name every operating system accepts: no slashes or other reserved characters, no trailing dots, at most `max` characters. */
export function safeName(s: string, max = 80): string {
  const t = [...s].map((c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').replace(BAD, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return t.length > max ? t.slice(0, max).trim() : t
}

const stripExt = (n: string) => n.replace(/\.pdf$/i, '')

/**
 * New names for a batch of files. 'title' and 'first-line' use what the document says (falling back to the old name when it says nothing);
 * 'pattern' builds names from a template with {n} (counter), {name} (old name) and {title}.
 * Names that come out the same get " (2)", " (3)" ... so nothing overwrites anything.
 */
export function planRenames(files: RenameInfo[], source: RenameSource, pattern = '{name}-{n}', start = 1): string[] {
  const raw = files.map((f, i) => {
    const old = stripExt(f.name)
    let base: string
    if (source === 'title') base = f.title || old
    else if (source === 'first-line') base = f.firstLine || f.title || old
    else
      base = pattern
        .replace(/\{n(?::(\d+))?\}/g, (_, w: string | undefined) => String(start + i).padStart(w ? parseInt(w, 10) : 1, '0'))
        .replace(/\{name\}/g, old)
        .replace(/\{title\}/g, f.title || old)
    return safeName(base) || safeName(old) || 'document'
  })
  const used = new Map<string, number>()
  return raw.map((b) => {
    const k = b.toLowerCase()
    const n = (used.get(k) ?? 0) + 1
    used.set(k, n)
    return `${n === 1 ? b : `${b} (${n})`}.pdf`
  })
}
