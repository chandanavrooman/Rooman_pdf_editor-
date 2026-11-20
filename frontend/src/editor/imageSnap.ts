import type { PDFDocumentProxy } from 'pdfjs-dist'
import { analyzeOps } from './pdfOps'
import type { RawImage } from '@/lib/extractImages'

export interface ImageRect {
  x: number
  y: number
  w: number
  h: number
  /** pdf.js object id, or the inline image itself: the picture's own pixels */
  id?: string
  inline?: Record<string, unknown>
  /** drawn upright on the page, so its own pixels can be used as they are */
  upright?: boolean
}

/** Pictures painted on one page (page space, points). Tiny marks and full-page backgrounds are left out: they are not "an image to edit". */
export async function pageImageRects(doc: PDFDocumentProxy, pageIndex: number): Promise<ImageRect[]> {
  const page = await doc.getPage(pageIndex + 1)
  const vp = page.getViewport({ scale: 1 })
  const ops = await analyzeOps(page, vp)
  const area = vp.width * vp.height
  const out: ImageRect[] = []
  for (const r of ops.images) {
    if (r.w < 20 || r.h < 20 || r.w * r.h > area * 0.85) continue
    if (out.some((o) => Math.abs(o.x - r.x) < 1 && Math.abs(o.y - r.y) < 1 && Math.abs(o.w - r.w) < 1 && Math.abs(o.h - r.h) < 1)) continue
    out.push({ x: r.x, y: r.y, w: r.w, h: r.h, id: r.id, inline: r.inline, upright: r.upright })
  }
  return out
}

/** The picture's pixels as PNG (cut out of the rendered page, 3x) and the page colour around it, for the patch left behind when it moves. */
export async function liftImage(doc: PDFDocumentProxy, pageIndex: number, r: ImageRect, opts: { backgroundOnly?: boolean } = {}): Promise<{ bytes: Uint8Array; bg: string } | null> {
  if (typeof document === 'undefined') return null
  const page = await doc.getPage(pageIndex + 1)
  // the picture's own pixels, at the quality stored in the PDF, when it is drawn upright; otherwise a 3x crop of the rendered page
  let native: Uint8Array | null = null
  if (r.upright && !opts.backgroundOnly) {
    try {
      const { getObj, toPng } = await import('@/lib/extractImages') // browser-only helpers, loaded when a picture is lifted
      let raw: RawImage | null = (r.inline as unknown as RawImage) ?? null
      if (!raw && r.id) {
        await page.getOperatorList() // makes pdf.js decode the page's images
        raw = await getObj(page as never, r.id)
      }
      if (raw && raw.width > 0 && raw.height > 0) native = await toPng(raw)
    } catch {
      native = null
    }
  }
  const k = 3
  const viewport = page.getViewport({ scale: k })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, canvas, viewport }).promise
  const x0 = Math.max(0, Math.round(r.x * k))
  const y0 = Math.max(0, Math.round(r.y * k))
  const w = Math.min(canvas.width - x0, Math.round(r.w * k))
  const h = Math.min(canvas.height - y0, Math.round(r.h * k))
  if (w < 2 || h < 2) return null
  // page colour: most common pixel in a thin ring just outside the picture
  const counts = new Map<string, number>()
  const add = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
    const d = ctx.getImageData(x, y, 1, 1).data
    const key = `${d[0]},${d[1]},${d[2]}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (let x = x0; x < x0 + w; x += 3) {
    add(x, y0 - 3)
    add(x, y0 + h + 3)
  }
  for (let y = y0; y < y0 + h; y += 3) {
    add(x0 - 3, y)
    add(x0 + w + 3, y)
  }
  let best = '255,255,255'
  let n = 0
  for (const [key, c] of counts) if (c > n) [best, n] = [key, c]
  const bg = '#' + best.split(',').map((v) => Number(v).toString(16).padStart(2, '0')).join('')
  if (opts.backgroundOnly) return { bytes: new Uint8Array(0), bg } // deleting a picture needs only the page colour around it
  if (native) return { bytes: native, bg }
  const crop = document.createElement('canvas')
  crop.width = w
  crop.height = h
  crop.getContext('2d')!.drawImage(canvas, x0, y0, w, h, 0, 0, w, h)
  const blob: Blob | null = await new Promise((res) => crop.toBlob(res, 'image/png'))
  if (!blob) return null
  return { bytes: new Uint8Array(await blob.arrayBuffer()), bg }
}
