import { loadPdfFromBytes } from '@/lib/pdfjs'
import type { PageRenderer } from '@/lib/pdfOps'

/** Browser page renderer for measuring content (white background, 1.5 px per point). */
export const renderPageRaster: PageRenderer = async (pdf, pageIndex) => {
  const task = loadPdfFromBytes(pdf)
  try {
    const doc = await task.promise
    const page = await doc.getPage(pageIndex + 1)
    const scale = 1.5
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, canvas, viewport }).promise
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return { width: canvas.width, height: canvas.height, data: img.data, scale }
  } finally {
    await task.destroy()
  }
}
