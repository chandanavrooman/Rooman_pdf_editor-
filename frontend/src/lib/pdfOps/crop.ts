import { loadDoc, noProgress, pageRotation, pdfSave, PdfOpError, visibleBox, type ProgressFn } from './common'

export interface CropMargins {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Crop by VISUAL margins (as the user sees the page, rotation applied).
 * unit 'fraction' = fraction of the visual page width/height (0–1); 'pt' = PDF points.
 * Sets MediaBox-contained CropBox; content is preserved (non-destructive, like viewers expect).
 */
export async function cropPages(
  bytes: Uint8Array,
  margins: CropMargins,
  opts: { unit: 'fraction' | 'pt'; pages?: number[] } = { unit: 'fraction' },
  onProgress: ProgressFn = noProgress,
): Promise<Uint8Array> {
  const doc = await loadDoc(bytes)
  const total = doc.getPageCount()
  const targets = opts.pages ?? doc.getPageIndices().map((i) => i + 1)
  if (!targets.length) throw new PdfOpError('Select at least one page to crop.')
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i]
    if (p < 1 || p > total) throw new PdfOpError(`Page ${p} does not exist (the document has ${total}).`)
    const page = doc.getPage(p - 1)
    const box = visibleBox(page)
    const rot = pageRotation(page)
    const swap = rot === 90 || rot === 270
    const vw = swap ? box.height : box.width
    const vh = swap ? box.width : box.height
    const conv = (m: number, dim: number) => (opts.unit === 'fraction' ? m * dim : m)
    const v = {
      top: conv(margins.top, vh),
      bottom: conv(margins.bottom, vh),
      left: conv(margins.left, vw),
      right: conv(margins.right, vw),
    }
    if (Object.values(v).some((n) => n < 0 || !Number.isFinite(n))) throw new PdfOpError('Margins must be zero or positive numbers.')
    if (v.left + v.right >= vw - 1 || v.top + v.bottom >= vh - 1) throw new PdfOpError(`The crop would remove all of page ${p}. Use smaller margins.`)
    // Map visual edges to unrotated box edges.
    let l = 0, r = 0, t = 0, b = 0 // margins on unrotated box: left,right,top,bottom
    switch (rot) {
      case 0: l = v.left; r = v.right; t = v.top; b = v.bottom; break
      case 90: l = v.top; t = v.right; r = v.bottom; b = v.left; break // visual top=box left, right=box top, bottom=box right, left=box bottom
      case 180: l = v.right; r = v.left; t = v.bottom; b = v.top; break
      case 270: r = v.top; l = v.bottom; t = v.left; b = v.right; break
    }
    page.setCropBox(box.x + l, box.y + b, box.width - l - r, box.height - t - b)
    onProgress((i + 1) / targets.length / 1.1)
  }
  const result = await pdfSave(doc)
  onProgress(1)
  return result
}
