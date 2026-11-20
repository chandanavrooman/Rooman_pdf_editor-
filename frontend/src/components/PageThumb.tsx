import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { isCancel, renderPage } from '@/lib/render'

interface Props {
  doc: PDFDocumentProxy
  pageNumber: number
  /** displayed width in CSS px */
  width: number
  /** extra visual rotation in degrees (multiples of 90) */
  rotation?: number
  className?: string
}

/** Lazily renders a small thumbnail of an original PDF page. */
export function PageThumb({ doc, pageNumber, width, rotation = 0, className = '' }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [aspect, setAspect] = useState(1.414)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !canvas.current) return
    let cancelled = false
    let cancel: (() => void) | undefined
    ;(async () => {
      const page = await doc.getPage(pageNumber)
      if (cancelled || !canvas.current) return
      const vp1 = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 })
      setAspect(vp1.height / vp1.width)
      const { task } = renderPage(page, canvas.current, { scale: width / vp1.width, viewRotation: rotation })
      cancel = () => task.cancel()
      await task.promise
    })().catch((e) => {
      if (!isCancel(e) && !cancelled) console.error('thumbnail render failed', e)
    })
    return () => {
      cancelled = true
      cancel?.()
    }
  }, [doc, pageNumber, width, rotation, visible])

  return (
    <div ref={wrap} className={`overflow-hidden rounded bg-white shadow-sm ring-1 ring-ink-200 dark:ring-ink-700 ${className}`} style={{ width, height: width * aspect }}>
      <canvas ref={canvas} aria-hidden="true" className="block" />
    </div>
  )
}
