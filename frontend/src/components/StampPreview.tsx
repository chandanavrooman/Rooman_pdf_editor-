import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { getBytes } from '@/lib/fileStore'
import { loadPdfFromBytes } from '@/lib/pdfjs'
import { isCancel, renderPage } from '@/lib/render'
import { friendlyMessage } from '@/lib/apiClient'

const WIDTH = 340

/**
 * A live look at ONE page of the real result. `build` gives back a one-page PDF of the page you ask for: the tool's own stamping code run on
 * that page, so the preview is exactly the file you will download. It refreshes shortly after any setting changes (`depsKey` stands for the settings).
 */
export function StampPreview({ fileId, pageCount, enabled, depsKey, build, jumpTo, caption, title = 'Preview' }: {
  fileId: string
  pageCount: number
  /** false: the settings are not valid yet */
  enabled: boolean
  depsKey: string
  build: (bytes: Uint8Array, pageNumber: number) => Promise<Uint8Array>
  /** when this changes, the preview moves to that (1-based) page */
  jumpTo?: number
  caption?: (pageNumber: number) => ReactNode
  title?: string
}) {
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const current = Math.min(page, Math.max(0, pageCount - 1))

  useEffect(() => {
    if (jumpTo && jumpTo >= 1 && jumpTo <= pageCount) setPage(jumpTo - 1)
  }, [jumpTo, pageCount])

  useEffect(() => {
    if (!enabled || !canvas.current) return
    let cancelled = false
    let cancelRender: (() => void) | undefined
    const timer = setTimeout(async () => {
      setBusy(true)
      setError(null)
      let task: ReturnType<typeof loadPdfFromBytes> | null = null
      try {
        const out = await build(getBytes(fileId), current + 1)
        if (cancelled) return
        task = loadPdfFromBytes(out)
        const doc = await task.promise
        const pdfPage = await doc.getPage(1)
        if (cancelled || !canvas.current) return
        const vp = pdfPage.getViewport({ scale: 1 })
        const { task: draw } = renderPage(pdfPage, canvas.current, { scale: WIDTH / vp.width })
        cancelRender = () => draw.cancel()
        await draw.promise
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
    // `depsKey` stands for every setting that changes the picture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, depsKey, current, enabled])

  return (
    <div data-testid="stamp-preview">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="label !mb-0">{title}</p>
        <div className="flex items-center gap-1 text-xs text-ink-600 dark:text-ink-300">
          <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => setPage(Math.max(0, current - 1))} disabled={current <= 0} aria-label="Previous page" data-testid="sp-prev">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-20 text-center tabular-nums" data-testid="sp-page">
            Page {current + 1} of {pageCount}
          </span>
          <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => setPage(Math.min(pageCount - 1, current + 1))} disabled={current >= pageCount - 1} aria-label="Next page" data-testid="sp-next">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-64 items-start justify-center rounded-xl bg-ink-100 p-3 dark:bg-ink-950">
        {enabled ? (
          <div className="overflow-hidden bg-white shadow-md ring-1 ring-ink-300 dark:ring-ink-600" style={{ width: WIDTH, maxWidth: '100%', opacity: busy ? 0.6 : 1, transition: 'opacity .15s' }}>
            <canvas ref={canvas} data-testid="sp-canvas" className="block h-auto w-full" role="img" aria-label={`Preview of page ${current + 1} with your settings`} />
          </div>
        ) : (
          <p className="my-auto max-w-xs self-center text-center text-sm text-ink-500 dark:text-ink-400">Fix the settings to see the preview.</p>
        )}
        {busy && (
          <span className="absolute right-3 top-3 flex items-center gap-1 text-xs text-ink-500" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating…
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400" data-testid="sp-error">
          {error}
        </p>
      )}
      {caption && enabled && (
        <p className="mt-2 text-xs text-ink-600 dark:text-ink-300" data-testid="sp-caption">
          {caption(current + 1)}
        </p>
      )}
    </div>
  )
}
