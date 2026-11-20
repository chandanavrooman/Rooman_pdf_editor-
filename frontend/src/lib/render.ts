import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

export function isCancel(e: unknown): boolean {
  return (e as { name?: string })?.name === 'RenderingCancelledException'
}

/** Largest canvas bitmap we ever allocate: 16.7 M pixels (iOS Safari's hard limit, safe everywhere) and 16384 px per side. */
export const MAX_CANVAS_PIXELS = 4096 * 4096
export const MAX_CANVAS_SIDE = 16384

export function devicePixelRatioNow(): number {
  return typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
}

/**
 * Backing-store size for a canvas shown at cssW × cssH CSS px on a screen with `dpr` device px per CSS px.
 * When the full resolution would exceed the safe limits, the ratio is lowered just enough to fit (the page is then
 * slightly softer, but it still renders instead of failing or crashing the tab). `capped` says that happened.
 */
export function canvasBitmapSize(cssW: number, cssH: number, dpr: number): { width: number; height: number; ratio: number; capped: boolean } {
  let ratio = dpr
  const limit = Math.min(Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, cssW * cssH)), MAX_CANVAS_SIDE / Math.max(1, cssW), MAX_CANVAS_SIDE / Math.max(1, cssH))
  const capped = ratio > limit
  if (capped) ratio = limit
  return { width: Math.max(1, Math.floor(cssW * ratio)), height: Math.max(1, Math.floor(cssH * ratio)), ratio, capped }
}

/**
 * Render one page of an ORIGINAL document into a canvas (never rebuilt from text).
 * The canvas is shown at its logical (CSS) size `scale` px per point; its bitmap has device resolution
 * (scale × devicePixelRatio, capped for huge pages) and pdf.js draws into it through a `transform`,
 * so the browser never has to upscale the bitmap.
 * `viewRotation` is added to the page's own /Rotate. `cssWidth` is the displayed width in CSS px.
 */
export function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  opts: { scale: number; viewRotation?: number; pixelRatio?: number; annotationMode?: number },
): { task: RenderTask; cssWidth: number; cssHeight: number; ratio: number; capped: boolean } {
  const rotation = (((page.rotate + (opts.viewRotation ?? 0)) % 360) + 360) % 360
  const viewport = page.getViewport({ scale: opts.scale, rotation })
  const cssWidth = viewport.width
  const cssHeight = viewport.height
  const bmp = canvasBitmapSize(cssWidth, cssHeight, opts.pixelRatio ?? devicePixelRatioNow())
  canvas.width = bmp.width
  canvas.height = bmp.height
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  canvas.dataset.pixelRatio = bmp.ratio.toFixed(3)
  if (bmp.capped) canvas.dataset.capped = 'true'
  else delete canvas.dataset.capped
  // exact device-pixel mapping: the bitmap's integer size over the logical size, per axis
  const transform = [bmp.width / cssWidth, 0, 0, bmp.height / cssHeight, 0, 0]
  const task = page.render({ canvas, viewport, transform, ...(opts.annotationMode !== undefined ? { annotationMode: opts.annotationMode } : {}) })
  return { task, cssWidth, cssHeight, ratio: bmp.ratio, capped: bmp.capped }
}

/** Calls `onChange` whenever window.devicePixelRatio changes (browser zoom, or the window moved to another monitor). */
export function watchDevicePixelRatio(onChange: (dpr: number) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  let last = devicePixelRatioNow()
  let mq: MediaQueryList | null = null
  const check = () => {
    const now = devicePixelRatioNow()
    if (now === last) return
    last = now
    onChange(now)
    listen() // the media query is for one exact ratio; watch the new one
  }
  const listen = () => {
    mq?.removeEventListener('change', check)
    mq = window.matchMedia?.(`(resolution: ${last}dppx)`) ?? null
    mq?.addEventListener('change', check)
  }
  listen()
  // not every browser fires the media query when the window moves between monitors; a resize always comes with it
  window.addEventListener('resize', check)
  return () => {
    mq?.removeEventListener('change', check)
    window.removeEventListener('resize', check)
  }
}

export interface PageSize {
  /** width/height at scale 1 with the page's own rotation applied (what the user sees) */
  width: number
  height: number
  /** the page's own /Rotate */
  rotate: number
}

export async function getPageSizes(doc: PDFDocumentProxy): Promise<PageSize[]> {
  const sizes: PageSize[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    sizes.push({ width: vp.width, height: vp.height, rotate: page.rotate })
  }
  return sizes
}
