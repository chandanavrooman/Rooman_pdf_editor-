import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getBytes } from '@/lib/fileStore'
import { extractPages, fitPlan, resizePages, targetSize, type ResizeOptions } from '@/lib/pdfOps'
import { loadPdfFromBytes } from '@/lib/pdfjs'
import { isCancel, renderPage, type PageSize } from '@/lib/render'
import { friendlyMessage } from '@/lib/apiClient'
import { PageThumb } from './PageThumb'

const MM = 72 / 25.4
const BOX = 210 // longest side of the bigger sheet, in CSS px
const mm = (pt: number) => Math.round(pt / MM)

type Opts = Pick<ResizeOptions, 'width' | 'height' | 'mode' | 'autoOrient' | 'orientation'>

/**
 * Before and after for ONE page. The "after" is made by the same `resizePages` the button uses (on a one-page copy), then drawn,
 * so it is exactly what you will download. Both sheets are drawn at the same scale, so a bigger paper size really looks bigger.
 */
export function ResizePreview({ fileId, doc, sizes, opts, paperLabel, selected }: { fileId: string; doc: PDFDocumentProxy; sizes: PageSize[]; opts: Opts; paperLabel: string; selected: ReadonlySet<number> | null }) {
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const current = Math.min(page, sizes.length - 1)
  const orig = sizes[current]
  const isSelected = !selected || selected.has(current + 1)
  const [w, h] = targetSize(opts, orig.width, orig.height)
  const plan = fitPlan(orig.width, orig.height, w, h, opts.mode)
  const scale = Math.min(BOX / Math.max(h, orig.height), BOX / Math.max(w, orig.width))
  const key = `${opts.width}|${opts.height}|${opts.mode}|${opts.autoOrient}|${opts.orientation ?? ''}|${current}|${isSelected}`

  useEffect(() => {
    if (!isSelected || !canvas.current) {
      setBusy(false) // a page that is not resized has nothing to wait for
      return
    }
    let cancelled = false
    let cancelRender: (() => void) | undefined
    const timer = setTimeout(async () => {
      setBusy(true)
      setError(null)
      let task: ReturnType<typeof loadPdfFromBytes> | null = null
      try {
        const one = await extractPages(getBytes(fileId), [current + 1])
        const out = await resizePages(one, opts)
        if (cancelled) return
        task = loadPdfFromBytes(out)
        const d = await task.promise
        const p = await d.getPage(1)
        if (cancelled || !canvas.current) return
        const vp = p.getViewport({ scale: 1 })
        const { task: draw } = renderPage(p, canvas.current, { scale: (vp.width * scale) / vp.width })
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
    // `key` stands for every setting that changes the picture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, key, scale])

  const pct = (n: number) => `${Math.round(n * 100)}%`
  return (
    <div data-testid="resize-preview">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="label !mb-0">Before and after</p>
        <div className="flex items-center gap-1 text-xs text-ink-600 dark:text-ink-300">
          <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => setPage(Math.max(0, current - 1))} disabled={current <= 0} aria-label="Previous page" data-testid="rp-prev">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-20 text-center tabular-nums" data-testid="rp-page">
            Page {current + 1} of {sizes.length}
          </span>
          <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => setPage(Math.min(sizes.length - 1, current + 1))} disabled={current >= sizes.length - 1} aria-label="Next page" data-testid="rp-next">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 rounded-xl bg-ink-100 p-4 dark:bg-ink-950" style={{ minHeight: BOX + 70 }}>
        <figure className="flex flex-col items-center gap-2" data-testid="rp-original">
          <div className="flex items-center justify-center" style={{ width: orig.width * scale, height: BOX }}>
            <div className="overflow-hidden bg-white shadow-md ring-1 ring-ink-300 dark:ring-ink-600" style={{ width: orig.width * scale, height: orig.height * scale }}>
              <PageThumb doc={doc} pageNumber={current + 1} width={Math.max(20, orig.width * scale)} />
            </div>
          </div>
          <figcaption className="text-center text-xs text-ink-600 dark:text-ink-300">
            <span className="block font-semibold">Original</span>
            <span data-testid="rp-original-size">
              {mm(orig.width)} × {mm(orig.height)} mm
            </span>
          </figcaption>
        </figure>

        <ArrowRight className="h-5 w-5 shrink-0 text-ink-400" aria-hidden="true" />

        <figure className="flex flex-col items-center gap-2" data-testid="rp-result">
          <div className="relative flex items-center justify-center" style={{ width: w * scale, height: BOX }}>
            {isSelected ? (
              <div className="relative overflow-hidden bg-white shadow-md ring-1 ring-brand-500" style={{ width: w * scale, height: h * scale, opacity: busy ? 0.6 : 1, transition: 'opacity .15s' }}>
                <canvas ref={canvas} data-testid="rp-canvas" className="block h-full w-full" role="img" aria-label={`Page ${current + 1} resized to ${paperLabel}`} />
                {opts.mode === 'fit' && (plan.padX > 0.5 || plan.padY > 0.5) && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                    <div className="absolute border border-dashed border-brand-500" style={{ left: `${(plan.padX / w) * 100}%`, right: `${(plan.padX / w) * 100}%`, top: `${(plan.padY / h) * 100}%`, bottom: `${(plan.padY / h) * 100}%`, boxShadow: '0 0 0 999px rgba(20,184,166,0.10)' }} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center bg-white p-2 text-center text-[11px] text-ink-500 shadow-md ring-1 ring-ink-300 dark:ring-ink-600" style={{ width: orig.width * scale, height: orig.height * scale }}>
                Not selected: stays as it is
              </div>
            )}
            {busy && <Loader2 className="absolute right-1 top-1 h-4 w-4 animate-spin text-ink-500" aria-hidden="true" />}
          </div>
          <figcaption className="text-center text-xs text-ink-600 dark:text-ink-300">
            <span className="block font-semibold">{isSelected ? `Resized · ${paperLabel}` : 'Unchanged'}</span>
            <span data-testid="rp-result-size">
              {isSelected ? `${mm(w)} × ${mm(h)} mm` : `${mm(orig.width)} × ${mm(orig.height)} mm`}
            </span>
          </figcaption>
        </figure>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400" data-testid="rp-error">
          {error}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-600 dark:text-ink-300" data-testid="rp-note">
        {!isSelected
          ? 'This page is not in your selection, so it is copied into the new file unchanged.'
          : opts.mode === 'fit'
            ? plan.padX > 0.5 || plan.padY > 0.5
              ? `Fit: the page is scaled to ${pct(plan.scale)} and the whole page stays visible. White space is added ${plan.padX > 0.5 ? `left and right (${mm(plan.padX)} mm each)` : `top and bottom (${mm(plan.padY)} mm each)`}.`
              : `Fit: the page is scaled to ${pct(plan.scale)} and fills the sheet exactly, because the shapes match.`
            : plan.cropX > 0.005 || plan.cropY > 0.005
              ? `Fill: the page is scaled to ${pct(plan.scale)} to cover the sheet. About ${pct(plan.cropX || plan.cropY)} of the ${plan.cropX ? 'width' : 'height'} is cropped (${plan.cropX ? `${mm((plan.cropX * plan.drawWidth) / 2)} mm off the left and the right` : `${mm((plan.cropY * plan.drawHeight) / 2)} mm off the top and the bottom`}).`
              : `Fill: the page is scaled to ${pct(plan.scale)} and covers the sheet exactly, so nothing is cropped.`}
      </p>
    </div>
  )
}
