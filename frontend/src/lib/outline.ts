import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Bookmark } from './pdfOps/split'

/** Top-level bookmarks (outline) resolved to 0-based page indices. */
export async function getTopLevelBookmarks(doc: PDFDocumentProxy): Promise<Bookmark[]> {
  const outline = await doc.getOutline()
  if (!outline) return []
  const marks: Bookmark[] = []
  for (const item of outline) {
    try {
      let dest = item.dest
      if (typeof dest === 'string') dest = await doc.getDestination(dest)
      if (!Array.isArray(dest) || !dest.length) continue
      const target = dest[0]
      const pageIndex = typeof target === 'object' && target !== null ? await doc.getPageIndex(target) : Number(target)
      if (Number.isInteger(pageIndex) && pageIndex >= 0) marks.push({ title: (item.title || 'Untitled').trim() || 'Untitled', pageIndex })
    } catch {
      // unresolved destination: skip this bookmark
    }
  }
  return marks
}
