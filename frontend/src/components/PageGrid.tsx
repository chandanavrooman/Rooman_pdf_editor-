import { useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PageThumb } from './PageThumb'

export interface PageGridProps {
  doc: PDFDocumentProxy
  numPages: number
  /** Display order of ORIGINAL page numbers. Default 1..n */
  order?: number[]
  selected?: Set<number>
  onToggle?: (page: number) => void
  /** extra visual rotation per original page (degrees) */
  rotations?: Record<number, number>
  /** When provided the grid is reorderable (drag & drop plus move buttons). */
  onReorder?: (order: number[]) => void
  renderActions?: (page: number) => ReactNode
  thumbWidth?: number
  /** colour treatment of selected pages */
  selectedTone?: 'brand' | 'danger'
}

export function PageGrid({ doc, numPages, order, selected, onToggle, rotations = {}, onReorder, renderActions, thumbWidth = 120, selectedTone = 'brand' }: PageGridProps) {
  const seq = order ?? Array.from({ length: numPages }, (_, i) => i + 1)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const move = (from: number, to: number) => {
    if (!onReorder || from === to || to < 0 || to >= seq.length) return
    const next = [...seq]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onReorder(next)
  }
  const ring = selectedTone === 'danger' ? 'ring-red-500' : 'ring-brand-500'
  const badge = selectedTone === 'danger' ? 'bg-red-600' : 'bg-brand-600'

  return (
    <ul className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbWidth + 24}px, 1fr))` }} data-testid="page-grid">
      {seq.map((page, idx) => {
        const isSel = selected?.has(page)
        const rot = rotations[page] ?? 0
        const thumb = <PageThumb doc={doc} pageNumber={page} width={thumbWidth} rotation={rot} className="mx-auto" />
        return (
          <li
            key={page}
            draggable={!!onReorder}
            onDragStart={() => setDragFrom(idx)}
            onDragOver={(e) => {
              if (dragFrom !== null) {
                e.preventDefault()
                setDragOver(idx)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragFrom !== null) move(dragFrom, idx)
              setDragFrom(null)
              setDragOver(null)
            }}
            onDragEnd={() => {
              setDragFrom(null)
              setDragOver(null)
            }}
            data-page-item={page}
            className={`flex flex-col items-center gap-1 rounded-xl p-2 transition ${dragOver === idx && dragFrom !== idx ? 'bg-brand-50 outline-dashed outline-2 outline-brand-400 dark:bg-brand-900/30' : ''} ${dragFrom === idx ? 'opacity-40' : ''}`}
          >
            {onToggle ? (
              <button type="button" onClick={() => onToggle(page)} aria-pressed={!!isSel} aria-label={`Page ${page}`} className={`relative flex items-center justify-center rounded-md p-1 ${isSel ? `ring-2 ${ring}` : 'hover:ring-2 hover:ring-ink-300'}`} style={{ minHeight: thumbWidth * 1.2 }}>
                {thumb}
                {isSel && (
                  <span className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-white ${badge}`}>
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                )}
              </button>
            ) : (
              <div className="flex items-center justify-center p-1" style={{ minHeight: thumbWidth * 1.2 }} aria-label={`Page ${page}`}>
                {thumb}
              </div>
            )}
            <div className="flex items-center gap-1 text-xs text-ink-600 dark:text-ink-300">
              {onReorder && (
                <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => move(idx, idx - 1)} disabled={idx === 0} aria-label={`Move page ${page} earlier`}>
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
              <span className="min-w-6 text-center font-medium tabular-nums">{page}</span>
              {onReorder && (
                <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => move(idx, idx + 1)} disabled={idx === seq.length - 1} aria-label={`Move page ${page} later`}>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
              {renderActions?.(page)}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
