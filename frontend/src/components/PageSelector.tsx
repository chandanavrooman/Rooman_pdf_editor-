import { useId } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { formatPageList } from '@/lib/ranges'
import { PageGrid } from './PageGrid'

/** Range text box + clickable thumbnails, kept in sync. */
export function PageSelector({ doc, numPages, text, onText, pages, error, tone = 'brand', label = 'Pages', placeholder = 'e.g. 1-3, 5, 8-' }: {
  doc: PDFDocumentProxy | null
  numPages: number
  text: string
  onText: (t: string) => void
  pages: number[]
  error: string | null
  tone?: 'brand' | 'danger'
  label?: string
  placeholder?: string
}) {
  const id = useId()
  const set = new Set(pages)
  const toggle = (p: number) => {
    const next = new Set(set)
    if (next.has(p)) next.delete(p)
    else next.add(p)
    onText(formatPageList([...next]))
  }
  const all = Array.from({ length: numPages }, (_, i) => i + 1)
  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor={id}>
          {label}
        </label>
        <input id={id} data-testid="page-range" className={`input ${error ? '!border-red-500' : ''}`} value={text} onChange={(e) => onText(e.target.value)} placeholder={placeholder} aria-invalid={!!error} aria-describedby={`${id}-hint`} />
        {error ? (
          <p role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : (
          <p id={`${id}-hint`} className="hint">
            {numPages ? `${pages.length} of ${numPages} pages selected. ` : ''}Use ranges like 1-3,5,8- (an open end means "to the last page"), or click pages below.
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => onText(formatPageList(all))}>
            Select all
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => onText('')}>
            Clear
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => onText(formatPageList(all.filter((p) => p % 2 === 1)))}>
            Odd pages
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => onText(formatPageList(all.filter((p) => p % 2 === 0)))}>
            Even pages
          </button>
        </div>
      </div>
      {doc ? (
        <PageGrid doc={doc} numPages={numPages} selected={set} onToggle={toggle} selectedTone={tone} thumbWidth={110} />
      ) : (
        <p className="text-sm text-ink-500">Loading pages…</p>
      )}
    </div>
  )
}
