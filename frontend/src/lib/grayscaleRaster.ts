import { loadPdfFromBytes } from '@/lib/pdfjs'
import type { RasterPage } from '@/lib/pdfOps'

/** Render every page and turn it grayscale (luminance), as a JPEG. 2.5 px per point is about 180 dpi. */
export async function renderGrayscalePages(bytes: Uint8Array, onProgress: (f: number) => void, quality = 0.85): Promise<RasterPage[]> {
  const task = loadPdfFromBytes(bytes)
  try {
    const doc = await task.promise
    const out: RasterPage[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const vp1 = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: 2.5 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, canvas, viewport }).promise
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
        d[i] = d[i + 1] = d[i + 2] = y
      }
      ctx.putImageData(img, 0, 0)
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))
      if (!blob) throw new Error('Could not turn a page into a picture.')
      out.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: vp1.width, height: vp1.height })
      onProgress(n / doc.numPages)
    }
    return out
  } finally {
    await task.destroy()
  }
}
