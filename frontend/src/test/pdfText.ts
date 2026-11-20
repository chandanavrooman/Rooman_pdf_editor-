import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface TextItem {
  str: string
  /** position in VIEWPORT (visual) coordinates, origin top-left, px at scale 1 */
  x: number
  y: number
}

export async function openWithPdfjs(bytes: Uint8Array) {
  // Always hand pdf.js a copy (it detaches the buffer it is given).
  return pdfjs.getDocument({ data: bytes.slice(0), useSystemFonts: false, verbosity: 0 }).promise
}

export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await openWithPdfjs(bytes)
  const out: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    out.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim())
  }
  await doc.loadingTask.destroy()
  return out
}

/** Text items with their positions in visual (rotation-aware) viewport coordinates. */
export async function pageItems(bytes: Uint8Array, pageNumber: number): Promise<{ width: number; height: number; items: TextItem[] }> {
  const doc = await openWithPdfjs(bytes)
  const page = await doc.getPage(pageNumber)
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  const items: TextItem[] = []
  for (const it of tc.items) {
    if (!('str' in it) || !it.str.trim()) continue
    const [vx, vy] = vp.convertToViewportPoint(it.transform[4], it.transform[5])
    items.push({ str: it.str, x: vx, y: vy })
  }
  await doc.loadingTask.destroy()
  return { width: vp.width, height: vp.height, items }
}
