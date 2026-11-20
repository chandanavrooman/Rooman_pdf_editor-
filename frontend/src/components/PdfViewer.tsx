import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Maximize, PanelLeft, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { devicePixelRatioNow, getPageSizes, isCancel, renderPage, watchDevicePixelRatio, type PageSize } from '@/lib/render'
import { PageThumb } from './PageThumb'

export interface OverlayInfo {
  pageNumber: number
  /** rendered CSS size of the page */
  width: number
  height: number
  /** CSS px per PDF point */
  scale: number
  /** total extra view rotation in degrees */
  viewRotation: number
}

export interface PdfViewerHandle {
  scrollToPage: (pageNumber: number) => void
  getPage: () => number
  setZoom: (scale: number) => void
}

export interface PdfViewerProps {
  /** id of a file in the FileStore. The viewer opens its own copy of the bytes. */
  fileId: string
  className?: string
  showThumbnails?: boolean
  /** Render a layer on top of each page (used by the editor). It is positioned absolutely over the canvas. */
  renderOverlay?: (info: OverlayInfo) => ReactNode
  onPageChange?: (pageNumber: number) => void
  onDocument?: (doc: PDFDocumentProxy) => void
  toolbarExtra?: ReactNode
  /** Fixed height of the viewer (CSS). Default: fills 70vh. */
  height?: string
  /** pdf.js AnnotationMode for the canvas (the editor uses ENABLE_FORMS = 2 so form widgets are drawn as inputs instead) */
  annotationMode?: number
  /** hide the view-rotate buttons (the editor works on the page as stored) */
  hideRotate?: boolean
  /** called when the user zooms (scale = CSS px per PDF point) */
  onScaleChange?: (scale: number) => void
  /** never open smaller than this scale in fit-to-width mode (the editor opens large and scrolls sideways when the window is narrow) */
  minFitScale?: number
}

interface PageViewProps {
  doc: PDFDocumentProxy
  pageNumber: number
  size: PageSize
  scale: number
  viewRotation: number
  overlay?: (info: OverlayInfo) => ReactNode
  annotationMode?: number
  dpr: number
  root: HTMLElement | null
  register: (n: number, el: HTMLDivElement | null) => void
}

function dims(size: PageSize, viewRotation: number, scale: number) {
  const swap = viewRotation % 180 !== 0
  return { w: (swap ? size.height : size.width) * scale, h: (swap ? size.width : size.height) * scale }
}

function PageView({ doc, pageNumber, size, scale, viewRotation, overlay, annotationMode, dpr, root, register }: PageViewProps) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const { w, h } = dims(size, viewRotation, scale)

  useEffect(() => {
    register(pageNumber, holder.current)
    return () => register(pageNumber, null)
  }, [pageNumber, register])

  useEffect(() => {
    const el = holder.current
    if (!el || !root) return
    const io = new IntersectionObserver((e) => setNear(e.some((x) => x.isIntersecting)), { root, rootMargin: '1200px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    if (!near) {
      c.width = 0 // free the bitmap of far-away pages
      c.height = 0
      return
    }
    let cancelled = false
    let cancel: (() => void) | undefined
    ;(async () => {
      const page = await doc.getPage(pageNumber)
      if (cancelled) return
      const { task } = renderPage(page, c, { scale, viewRotation, annotationMode, pixelRatio: dpr })
      cancel = () => task.cancel()
      await task.promise
    })().catch((e) => {
      if (!isCancel(e) && !cancelled) console.error('page render failed', e)
    })
    return () => {
      cancelled = true
      cancel?.()
    }
  }, [near, doc, pageNumber, scale, viewRotation, annotationMode, dpr])

  return (
    <div ref={holder} data-page={pageNumber} className="relative mx-auto mb-4 bg-white shadow-md ring-1 ring-ink-200 dark:ring-ink-700" style={{ width: w, height: h }}>
      <canvas ref={canvas} aria-label={`Page ${pageNumber}`} role="img" className="block" />
      {overlay && (
        <div className="absolute inset-0" data-overlay-page={pageNumber}>
          {overlay({ pageNumber, width: w, height: h, scale, viewRotation })}
        </div>
      )}
    </div>
  )
}

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer(
  { fileId, className = '', showThumbnails = true, renderOverlay, onPageChange, onDocument, toolbarExtra, height = '70vh', annotationMode, hideRotate, onScaleChange, minFitScale = 0 },
  ref,
) {
  const { doc, numPages, error, loading } = usePdfDoc(fileId)
  const scroller = useRef<HTMLDivElement>(null)
  const pageEls = useRef(new Map<number, HTMLDivElement>())
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [zoomMode, setZoomMode] = useState<'fit' | 'custom'>('fit')
  const [customScale, setCustomScale] = useState(1)
  const [containerW, setContainerW] = useState(800)
  const [viewRotation, setViewRotation] = useState(0)
  const [current, setCurrent] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [thumbsOpen, setThumbsOpen] = useState(false)
  // device pixels per CSS px; changes with browser zoom or when the window moves to another monitor
  const [dpr, setDpr] = useState(devicePixelRatioNow)
  useEffect(() => watchDevicePixelRatio(setDpr), [])

  useEffect(() => {
    if (doc) onDocument?.(doc)
  }, [doc, onDocument])

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    getPageSizes(doc).then((s) => !cancelled && setSizes(s), () => {})
    return () => {
      cancelled = true
    }
  }, [doc])

  const setScroller = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el
    setRoot(el)
  }, [])

  useEffect(() => {
    if (!root) return
    const ro = new ResizeObserver(() => setContainerW(root.clientWidth))
    ro.observe(root)
    setContainerW(root.clientWidth)
    return () => ro.disconnect()
  }, [root])

  const maxW = useMemo(() => sizes.reduce((m, s) => Math.max(m, viewRotation % 180 ? s.height : s.width), 1), [sizes, viewRotation])
  const fitScale = Math.max(minFitScale, 0.1, Math.min(3, (containerW - 32) / maxW))
  const scale = zoomMode === 'fit' ? fitScale : customScale
  useEffect(() => onScaleChange?.(scale), [scale, onScaleChange])

  const register = useCallback((n: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(n, el)
    else pageEls.current.delete(n)
  }, [])

  const scrollToPage = useCallback((n: number) => {
    const el = pageEls.current.get(n)
    const sc = scroller.current
    if (el && sc) sc.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' })
    setCurrent(n)
    setPageInput(String(n))
  }, [])

  useImperativeHandle(ref, () => ({ scrollToPage, getPage: () => current, setZoom: (s) => { setZoomMode('custom'); setCustomScale(s) } }), [scrollToPage, current])

  // current page = the page crossing the upper third of the viewport
  const raf = useRef(0)
  const onScroll = () => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const sc = scroller.current
      if (!sc) return
      const probe = sc.scrollTop + sc.clientHeight / 3
      let best = 1
      for (const [n, el] of pageEls.current) if (el.offsetTop <= probe && n >= best) best = n
      setCurrent((prev) => {
        if (prev !== best) {
          setPageInput(String(best))
          onPageChange?.(best)
        }
        return best
      })
    })
  }

  const zoomBy = (f: number) => {
    setZoomMode('custom')
    setCustomScale(Math.max(0.2, Math.min(5, +(scale * f).toFixed(3))))
  }

  const go = (n: number) => scrollToPage(Math.max(1, Math.min(numPages, n)))

  if (error) {
    return (
      <div role="alert" className="card p-6 text-sm text-red-700 dark:text-red-300">
        Could not display this PDF: {error}
      </div>
    )
  }

  return (
    <div className={`card flex flex-col overflow-hidden ${className}`} style={{ height }}>
      <div className="flex flex-wrap items-center gap-1 border-b border-ink-200 px-2 py-1.5 dark:border-ink-800" role="toolbar" aria-label="Viewer controls">
        {showThumbnails && (
          <button type="button" className="btn-ghost btn-sm md:hidden" onClick={() => setThumbsOpen((o) => !o)} aria-label="Toggle thumbnails" aria-pressed={thumbsOpen}>
            <PanelLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <button type="button" className="btn-ghost btn-sm" onClick={() => go(current - 1)} disabled={current <= 1} aria-label="Previous page">
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        </button>
        <label className="flex items-center gap-1 text-xs text-ink-600 dark:text-ink-300">
          <span className="sr-only">Page number</span>
          <input
            className="input !w-14 !px-2 !py-1 text-center"
            inputMode="numeric"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && go(parseInt(pageInput || '1', 10))}
          />
          / {numPages || '–'}
        </label>
        <button type="button" className="btn-ghost btn-sm" onClick={() => go(current + 1)} disabled={current >= numPages} aria-label="Next page">
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="mx-1 h-5 w-px bg-ink-200 dark:bg-ink-700" aria-hidden="true" />
        <button type="button" className="btn-ghost btn-sm" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
          <ZoomOut className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="w-12 text-center text-xs tabular-nums" aria-live="polite" data-testid="zoom-level">
          {Math.round(scale * 100)}%
        </span>
        <button type="button" className="btn-ghost btn-sm" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
          <ZoomIn className="h-4 w-4" aria-hidden="true" />
        </button>
        <select
          aria-label="Zoom presets"
          data-testid="zoom-preset"
          className="input !w-auto !px-1 !py-0.5 text-xs"
          value=""
          onChange={(e) => {
            const v = Number(e.target.value)
            if (v > 0) {
              setZoomMode('custom')
              setCustomScale(v)
            }
          }}
        >
          <option value="">Zoom…</option>
          {[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((z) => (
            <option key={z} value={z}>
              {z * 100}%
            </option>
          ))}
        </select>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setZoomMode('fit')} aria-label="Fit to width" aria-pressed={zoomMode === 'fit'}>
          <Maximize className="h-4 w-4" aria-hidden="true" />
        </button>
        {!hideRotate && (
          <>
            <span className="mx-1 h-5 w-px bg-ink-200 dark:bg-ink-700" aria-hidden="true" />
            <button type="button" className="btn-ghost btn-sm" onClick={() => setViewRotation((r) => (r + 270) % 360)} aria-label="Rotate view left">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setViewRotation((r) => (r + 90) % 360)} aria-label="Rotate view right">
              <RotateCw className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
        {toolbarExtra && <div className="ml-auto flex items-center gap-1">{toolbarExtra}</div>}
      </div>
      <div className="flex min-h-0 flex-1">
        {showThumbnails && doc && (
          <nav aria-label="Page thumbnails" className={`${thumbsOpen ? 'block' : 'hidden'} w-32 shrink-0 overflow-y-auto border-r border-ink-200 bg-ink-50 p-2 md:block dark:border-ink-800 dark:bg-ink-950`}>
            <ul className="flex flex-col items-center gap-3">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
                <li key={n}>
                  <button type="button" onClick={() => scrollToPage(n)} aria-label={`Go to page ${n}`} aria-current={current === n ? 'page' : undefined} className={`block rounded p-0.5 ${current === n ? 'ring-2 ring-brand-500' : ''}`}>
                    <PageThumb doc={doc} pageNumber={n} width={88} rotation={viewRotation} />
                    <span className="mt-1 block text-center text-[11px] text-ink-500">{n}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div ref={setScroller} onScroll={onScroll} className="relative min-w-0 flex-1 overflow-auto bg-ink-100 px-4 pt-4 dark:bg-ink-950" data-testid="viewer-scroll">
          {loading && <p className="p-6 text-center text-sm text-ink-500">Loading…</p>}
          {doc && sizes.length === numPages && root &&
            sizes.map((s, i) => (
              <PageView key={i} doc={doc} pageNumber={i + 1} size={s} scale={scale} viewRotation={viewRotation} overlay={renderOverlay} annotationMode={annotationMode} dpr={dpr} root={root} register={register} />
            ))}
        </div>
      </div>
    </div>
  )
})
