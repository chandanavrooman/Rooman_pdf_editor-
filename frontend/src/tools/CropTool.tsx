import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { PageThumb } from '@/components/PageThumb'
import { TextField } from '@/components/forms'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { cropPages } from '@/lib/pdfOps'
import { usePageSelection } from './shared/pageSelection'
import { PDF_MIME, type ToolPage } from './shared/types'

interface M {
  l: number
  t: number
  r: number
  b: number
}
type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const MIN = 0.05
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const PT_PER_MM = 72 / 25.4

const HANDLES: { h: Handle; cls: string; cursor: string }[] = [
  { h: 'nw', cls: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
  { h: 'n', cls: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'ns-resize' },
  { h: 'ne', cls: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
  { h: 'e', cls: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { h: 'se', cls: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' },
  { h: 's', cls: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2', cursor: 'ns-resize' },
  { h: 'sw', cls: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
  { h: 'w', cls: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
]

function CropEditor({ fileId, m, setM, pageNumber, setPageNumber, onSize }: { fileId: string; m: M; setM: (m: M) => void; pageNumber: number; setPageNumber: (n: number) => void; onSize: (s: { w: number; h: number }) => void }) {
  const { doc, numPages } = usePdfDoc(fileId)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ h: Handle; x: number; y: number; m: M } | null>(null)
  const [width, setWidth] = useState(420)

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    doc.getPage(pageNumber).then((p) => {
      if (cancelled) return
      const vp = p.getViewport({ scale: 1 })
      onSize({ w: vp.width, h: vp.height })
    })
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, onSize])

  useEffect(() => {
    const el = box.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(clamp(el.clientWidth - 8, 200, 560)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])

  const down = (h: Handle) => (e: RPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { h, x: e.clientX, y: e.clientY, m }
  }
  const move = (e: RPointerEvent) => {
    const d = drag.current
    const el = box.current
    if (!d || !el) return
    const rect = el.getBoundingClientRect()
    const dx = (e.clientX - d.x) / rect.width
    const dy = (e.clientY - d.y) / rect.height
    const n = { ...d.m }
    if (d.h === 'move') {
      const w = 1 - d.m.l - d.m.r
      const h = 1 - d.m.t - d.m.b
      n.l = clamp(d.m.l + dx, 0, 1 - w)
      n.r = 1 - w - n.l
      n.t = clamp(d.m.t + dy, 0, 1 - h)
      n.b = 1 - h - n.t
    } else {
      if (d.h.includes('w')) n.l = clamp(d.m.l + dx, 0, 1 - d.m.r - MIN)
      if (d.h.includes('e')) n.r = clamp(d.m.r - dx, 0, 1 - d.m.l - MIN)
      if (d.h.includes('n')) n.t = clamp(d.m.t + dy, 0, 1 - d.m.b - MIN)
      if (d.h.includes('s')) n.b = clamp(d.m.b - dy, 0, 1 - d.m.t - MIN)
    }
    setM(n)
  }
  const up = () => {
    drag.current = null
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm font-medium" htmlFor="crop-page">
          Preview page
        </label>
        <input id="crop-page" type="number" min={1} max={numPages || 1} value={pageNumber} onChange={(e) => setPageNumber(clamp(parseInt(e.target.value || '1', 10) || 1, 1, numPages || 1))} className="input !w-20 !py-1" />
        <span className="text-xs text-ink-500">of {numPages}</span>
      </div>
      <div className="flex justify-center rounded-xl bg-ink-100 p-3 dark:bg-ink-950">
        {doc ? (
          <div ref={box} className="relative inline-block touch-none select-none overflow-visible" data-testid="crop-box">
            <PageThumb doc={doc} pageNumber={pageNumber} width={width} />
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute border-2 border-brand-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" style={{ left: `${m.l * 100}%`, top: `${m.t * 100}%`, right: `${m.r * 100}%`, bottom: `${m.b * 100}%` }} />
            </div>
            <div
              className="absolute cursor-move"
              style={{ left: `${m.l * 100}%`, top: `${m.t * 100}%`, right: `${m.r * 100}%`, bottom: `${m.b * 100}%` }}
              onPointerDown={down('move')}
              onPointerMove={move}
              onPointerUp={up}
              aria-hidden="true"
            >
              {HANDLES.map(({ h, cls, cursor }) => (
                <span key={h} onPointerDown={down(h)} onPointerMove={move} onPointerUp={up} style={{ cursor }} className={`absolute h-3.5 w-3.5 rounded-sm border-2 border-brand-600 bg-white ${cls}`} />
              ))}
            </div>
          </div>
        ) : (
          <p className="p-8 text-sm text-ink-500">Loading preview…</p>
        )}
      </div>
    </div>
  )
}

const CropTool: ToolPage = ({ tool }) => {
  const [fileId, setFileId] = useState<string>()
  const { numPages } = usePdfDoc(fileId)
  const [m, setM] = useState<M>({ l: 0.08, t: 0.08, r: 0.08, b: 0.08 })
  const [pageNumber, setPageNumber] = useState(1)
  const [size, setSize] = useState({ w: 595, h: 842 })
  const [rangeText, setRangeText] = useState('')
  const sel = usePageSelection(rangeText, numPages)

  const mm = (frac: number, dim: number) => +(frac * dim / PT_PER_MM).toFixed(1)
  const setMm = (edge: keyof M, dim: number) => (v: string) => {
    const n = parseFloat(v)
    if (!Number.isFinite(n) || n < 0) return
    setM({ ...m, [edge]: clamp((n * PT_PER_MM) / dim, 0, 0.95) })
  }
  const valid = m.l + m.r < 0.98 && m.t + m.b < 0.98 && !sel.error

  return (
    <ToolShell
      tool={tool}
      runLabel="Crop PDF"
      canRun={valid}
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setPageNumber(1)
        setRangeText('')
      }}
      options={({ files }) => (
        <div className="space-y-5">
          <p className="text-sm text-ink-600 dark:text-ink-300">Drag the frame (or its handles) over the page. The same proportional margins are applied to every selected page.</p>
          <CropEditor fileId={files[0].id} m={m} setM={setM} pageNumber={pageNumber} setPageNumber={setPageNumber} onSize={setSize} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TextField label="Top (mm)" type="number" min={0} step={0.5} value={mm(m.t, size.h)} onChange={setMm('t', size.h)} testId="crop-top" />
            <TextField label="Right (mm)" type="number" min={0} step={0.5} value={mm(m.r, size.w)} onChange={setMm('r', size.w)} testId="crop-right" />
            <TextField label="Bottom (mm)" type="number" min={0} step={0.5} value={mm(m.b, size.h)} onChange={setMm('b', size.h)} testId="crop-bottom" />
            <TextField label="Left (mm)" type="number" min={0} step={0.5} value={mm(m.l, size.w)} onChange={setMm('l', size.w)} testId="crop-left" />
          </div>
          <TextField label="Apply to pages (leave empty for all)" value={rangeText} onChange={setRangeText} error={sel.error} placeholder="e.g. 1-3, 5" />
        </div>
      )}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-cropped.pdf`,
        bytes: await cropPages(getBytes(files[0].id), { top: m.t, right: m.r, bottom: m.b, left: m.l }, { unit: 'fraction', pages: sel.pages.length ? sel.pages : undefined }, progress),
        mime: PDF_MIME,
      })}
    />
  )
}
export default CropTool
