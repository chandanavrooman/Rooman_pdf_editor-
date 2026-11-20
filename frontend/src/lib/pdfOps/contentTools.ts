import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib'
import { loadDoc, noProgress, pdfSave, PdfOpError, type ProgressFn } from './common'

export interface AnnotationKinds {
  /** highlights, underlines, notes, stamps, drawings, shapes, text boxes */
  markup: boolean
  /** clickable links */
  links: boolean
}

const LINK = 'Link'
/** form fields are never touched here: removing a widget would break the form */
const KEEP = new Set(['Widget', 'Popup'])

export interface RemoveAnnotationsResult {
  bytes: Uint8Array
  removed: { markup: number; links: number }
}

/** Remove annotations from every page (or the chosen pages). Form fields always stay. */
export async function removeAnnotations(bytes: Uint8Array, kinds: AnnotationKinds, pages?: number[], onProgress: ProgressFn = noProgress): Promise<RemoveAnnotationsResult> {
  const doc = await loadDoc(bytes)
  const total = doc.getPageCount()
  const chosen = pages ? new Set(pages) : null
  if (chosen && [...chosen].some((p) => p < 1 || p > total)) throw new PdfOpError(`Choose pages between 1 and ${total}.`)
  const removed = { markup: 0, links: 0 }
  for (let i = 0; i < total; i++) {
    onProgress(i / total)
    if (chosen && !chosen.has(i + 1)) continue
    const page = doc.getPage(i)
    const annots = page.node.Annots()
    if (!annots) continue
    const keep: PDFRef[] = []
    const dropped: PDFRef[] = []
    for (let k = 0; k < annots.size(); k++) {
      const ref = annots.get(k)
      const dict = annots.lookupMaybe(k, PDFDict)
      const sub = dict?.lookup(PDFName.of('Subtype'))
      const name = sub instanceof PDFName ? sub.decodeText() : ''
      const isLink = name === LINK
      const drop = !!dict && !KEEP.has(name) && (isLink ? kinds.links : kinds.markup)
      if (drop) {
        if (isLink) removed.links++
        else removed.markup++
        if (ref instanceof PDFRef) dropped.push(ref)
      } else if (ref instanceof PDFRef) keep.push(ref)
    }
    if (!dropped.length) continue
    // popups that belonged to a removed annotation go too
    const dropSet = new Set(dropped.map((r) => r.toString()))
    const final: PDFRef[] = []
    for (const ref of keep) {
      const d = doc.context.lookupMaybe(ref, PDFDict)
      const parent = d?.get(PDFName.of('Parent'))
      if (d && d.lookup(PDFName.of('Subtype')) === PDFName.of('Popup') && parent instanceof PDFRef && dropSet.has(parent.toString())) continue
      final.push(ref)
    }
    if (final.length) page.node.set(PDFName.of('Annots'), doc.context.obj(final))
    else page.node.delete(PDFName.of('Annots'))
  }
  onProgress(1)
  return { bytes: await pdfSave(doc), removed }
}

export interface BookmarkItem {
  title: string
  /** 1-based */
  page: number
  /** 0 = top level, 1 = inside the previous level-0 bookmark, ... */
  level: number
}

/**
 * Parse one bookmark per line: "Title, 5" or "Title | 5" or "Title 5". Leading spaces, tabs or dashes make a bookmark a child of the one above
 * ("  Section 1.1, 7"). Returns the items and one message per line that could not be read.
 */
export function parseBookmarkLines(text: string, totalPages: number): { items: BookmarkItem[]; errors: string[] } {
  const items: BookmarkItem[] = []
  const errors: string[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return
    const lead = /^[\s\-–>]*/.exec(raw)![0]
    const level = Math.min(5, Math.floor(lead.replace(/\t/g, '  ').length / 2))
    const m = /^(.*?)\s*(?:[,|;:]|\s)\s*(\d+)\s*$/.exec(raw.slice(lead.length).trim())
    if (!m || !m[1].trim()) {
      errors.push(`Line ${i + 1}: write the title, then the page number, like "Introduction, 3".`)
      return
    }
    const page = parseInt(m[2], 10)
    if (page < 1 || page > totalPages) {
      errors.push(`Line ${i + 1}: page ${page} is not in the document (1 to ${totalPages}).`)
      return
    }
    items.push({ title: m[1].trim().replace(/[,|;:]$/, '').trim(), page, level })
  })
  // a child cannot be deeper than one step below the bookmark above it
  let prev = -1
  for (const it of items) {
    it.level = Math.min(it.level, prev + 1)
    prev = it.level
  }
  return { items, errors }
}

interface Node {
  item: BookmarkItem
  children: Node[]
}

function toTree(items: BookmarkItem[]): Node[] {
  const roots: Node[] = []
  const stack: Node[] = []
  for (const item of items) {
    const n: Node = { item, children: [] }
    while (stack.length > item.level) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(n)
    else roots.push(n)
    stack.push(n)
  }
  return roots
}

/** Write a bookmark tree (the PDF's outline) that replaces any existing one. */
export async function addBookmarks(bytes: Uint8Array, items: BookmarkItem[], onProgress: ProgressFn = noProgress): Promise<Uint8Array> {
  if (!items.length) throw new PdfOpError('Add at least one bookmark.')
  const doc = await loadDoc(bytes)
  const total = doc.getPageCount()
  if (items.some((b) => b.page < 1 || b.page > total)) throw new PdfOpError(`Bookmarks must point to pages 1 to ${total}.`)
  const ctx = doc.context
  const pageRefs = doc.getPages().map((p) => p.ref)
  const outlinesRef = ctx.nextRef()

  const build = (nodes: Node[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = nodes.map(() => ctx.nextRef())
    let count = 0
    nodes.forEach((n, i) => {
      const dict = ctx.obj({
        Title: PDFHexString.fromText(n.item.title),
        Parent: parent,
        Dest: [pageRefs[n.item.page - 1], PDFName.of('XYZ'), null, null, null],
      }) as PDFDict
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1])
      if (i < nodes.length - 1) dict.set(PDFName.of('Next'), refs[i + 1])
      count += 1
      if (n.children.length) {
        const c = build(n.children, refs[i])
        dict.set(PDFName.of('First'), c.first)
        dict.set(PDFName.of('Last'), c.last)
        dict.set(PDFName.of('Count'), PDFNumber.of(c.count)) // open: positive count
        count += c.count
      }
      ctx.assign(refs[i], dict)
    })
    return { first: refs[0], last: refs[refs.length - 1], count }
  }

  const tree = toTree(items)
  const r = build(tree, outlinesRef)
  ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: r.first, Last: r.last, Count: PDFNumber.of(r.count) }))
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef)
  // show the bookmark panel when the file opens
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
  onProgress(1)
  return pdfSave(doc)
}

/** Existing bookmarks, flat, with their levels (to start the editor from what the PDF already has). */
export async function readBookmarks(bytes: Uint8Array): Promise<BookmarkItem[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const out: BookmarkItem[] = []
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i + 1]))
  const walk = (ref: unknown, level: number, guard = 0) => {
    let cur = ref
    let n = 0
    while (cur && n++ < 5000 && guard < 12) {
      const d = cur instanceof PDFRef ? doc.context.lookupMaybe(cur, PDFDict) : undefined
      if (!d) break
      const t = d.lookup(PDFName.of('Title'))
      const dest = d.lookup(PDFName.of('Dest'))
      const first = dest instanceof PDFArray ? dest.get(0) : undefined
      const page = first instanceof PDFRef ? pageIndex.get(first.toString()) : undefined
      const title = t instanceof PDFHexString || t instanceof PDFString ? t.decodeText() : ''
      if (title && page) out.push({ title, page, level })
      const child = d.get(PDFName.of('First'))
      if (child) walk(child, level + 1, guard + 1)
      cur = d.get(PDFName.of('Next'))
    }
  }
  const outlines = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  if (outlines) walk(outlines.get(PDFName.of('First')), 0)
  return out
}
