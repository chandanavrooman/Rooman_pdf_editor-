import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { getBytes } from '@/lib/fileStore'
import { applyMargins, type Margins } from '@/lib/pdfOps'
import { renderPageRaster } from '@/lib/contentRaster'
import { loadPdfFromBytes } from '@/lib/pdfjs'
import { isCancel, renderPage } from '@/lib/render'
import { friendlyMessage } from '@/lib/apiClient'

const MM = 72 / 25.4
const PREVIEW_W = 320

/**
 * The real result for ONE page. The page is run through the same `applyMargins` the Apply button uses (just for that page),
 * then drawn, so what you see here is exactly what you download. The added white space is tinted and outlined.
 * It refreshes (after a short pause) whenever the margins, the "visible content" option or the page changes.
 */
export function MarginPreview({ fileId, margins, fit, pageCount }: { fileId: string; margins: Margins | null; fit: boolean; pageCount: number }) {
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const current = Math.min(page, Math.max(0, pageCount - 1))
  const key = margins ? `${margins.top}|${margins.right}|${margins.bottom}|${margins.left}` : ''

  useEffect(() => {
    if (!margins || !canvas.current) return
    let cancelled = false
    let cancelRender: (() => void) | undefined
    const timer = setTimeout(async () => {
      setBusy(true)
      setError(null)
      let task: ReturnType<typeof loadPdfFromBytes> | null = null
      try {
        const out = await applyMargins(getBytes(fileId), { margins, fitToContent: fit, render: renderPageRaster, pages: [current] })
        if (cancelled) return
        task = loadPdfFromBytes(out)
        const doc = await task.promise
        const pdfPage = await doc.getPage(1)
        if (cancelled || !canvas.current) return
        const vp = pdfPage.getViewport({ scale: 1 })
        const { task: draw } = renderPage(pdfPage, canvas.current, { scale: PREVIEW_W / vp.width })
        cancelRender = () => draw.cancel()
        await draw.promise
        if (!cancelled) setSize({ w: vp.width, h: vp.height })
      } catch (e) {
        if (!cancelled && !isCancel(e)) setError(friendlyMessage(e))
      } finally {
        await task?.destroy()
        if (!cancelled) setBusy(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
      cancelRender?.()
    }
    // `key` stands for the margin numbers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, key, fit, current])

  const pct = (pt: number, of: number) => `${(pt / of) * 100}%`
  return (
    <div data-testid="margin-preview">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="label !mb-0">Preview of the result</p>
        <div className="flex items-center gap-1 text-xs text-ink-600 dark:text-ink-300">
          <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => setPage(Math.max(0, current - 1))} disabled={current <= 0} aria-label="Previous page" data-testid="preview-prev">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span data-testid="preview-page" className="min-w-20 text-center tabular-nums">
            Page {current + 1} of {pageCount}
          </span>
          <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => setPage(Math.min(pageCount - 1, current + 1))} disabled={current >= pageCount - 1} aria-label="Next page" data-testid="preview-next">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-64 items-center justify-center rounded-xl bg-ink-100 p-4 dark:bg-ink-950">
        {margins ? (
          <div className="relative overflow-hidden bg-white shadow-md ring-1 ring-ink-300 dark:ring-ink-600" style={{ width: PREVIEW_W, maxWidth: '100%', opacity: busy ? 0.6 : 1, transition: 'opacity .15s' }}>
            <canvas ref={canvas} data-testid="margin-preview-canvas" className="block h-auto w-full" aria-label={`Preview of page ${current + 1} with the margins applied`} role="img" />
            {size && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                <div
                  data-testid="margin-guide"
                  className="absolute border border-dashed border-brand-500"
                  style={{ left: pct(margins.left, size.w), right: pct(margins.right, size.w), top: pct(margins.top, size.h), bottom: pct(margins.bottom, size.h), boxShadow: '0 0 0 999px rgba(20,184,166,0.10)' }}
                />
              </div>
            )}
          </div>
        ) : (
          <p className="max-w-xs text-center text-sm text-ink-500 dark:text-ink-400">Fix the margin values to see the preview.</p>
        )}
        {busy && (
          <span className="absolute right-3 top-3 flex items-center gap-1 text-xs text-ink-500" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating…
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400" data-testid="preview-error">
          {error}
        </p>
      )}
      <p className="hint">
        The tinted area is the added white space; the dashed line is the margin.
        {margins && size && ` Page ${Math.round(size.w / MM)} × ${Math.round(size.h / MM)} mm.`}
      </p>
    </div>
  )
}
