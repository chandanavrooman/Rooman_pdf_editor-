import { useMemo, useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { PagePositionGrid } from '@/components/PagePositionGrid'
import { StampPreview } from '@/components/StampPreview'
import { SelectField, TextField } from '@/components/forms'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { addPageNumbers, applyTokens, formatDate, type Position } from '@/lib/pdfOps'
import { usePageSelection } from './shared/pageSelection'
import { defaultStyleState, StyleFields, styleValid, toTextStyle, type StyleState } from './shared/StyleFields'
import { PDF_MIME, type ToolPage } from './shared/types'

const PageNumbersTool: ToolPage = ({ tool }) => {
  const [position, setPosition] = useState<Position>({ v: 'bottom', h: 'center' })
  const [fmt, setFmt] = useState('Page {page} of {pages}')
  const [custom, setCustom] = useState('{page}')
  const [start, setStart] = useState('1')
  const [rangeText, setRangeText] = useState('')
  const [style, setStyle] = useState<StyleState>(defaultStyleState)
  const [fileId, setFileId] = useState<string>()
  const [fileName, setFileName] = useState('file.pdf')
  const { numPages } = usePdfDoc(fileId)
  const sel = usePageSelection(rangeText, numPages)

  const format = fmt === 'custom' ? custom : fmt
  const startOk = /^\d+$/.test(start.trim())
  const startAt = startOk ? parseInt(start, 10) : 1
  const startError = startOk ? null : 'Start numbering at must be a whole number, 0 or more.'
  const formatError = format.trim() ? null : 'The number format cannot be empty.'
  const valid = startOk && !formatError && styleValid(style) && !sel.error

  const total = Math.max(numPages, 1)
  const lastNumber = startAt + total - 1
  const textFor = (p: number, f = format) => applyTokens(f, { page: startAt + p - 1, pages: lastNumber, date: formatDate(), filename: fileName })
  // the choices, each showing what it looks like on THIS document
  const FORMATS = [
    { value: '{page}', label: `${startAt}` },
    { value: 'Page {page}', label: `Page ${startAt}` },
    { value: 'Page {page} of {pages}', label: `Page ${startAt} of ${lastNumber}` },
    { value: '{page} / {pages}', label: `${startAt} / ${lastNumber}` },
    { value: '{page:2}', label: String(startAt).padStart(2, '0') },
    { value: 'custom', label: 'Custom…' },
  ]
  const numbered = sel.pages.length ? sel.pages : Array.from({ length: Math.min(total, 3) }, (_, i) => i + 1)
  const example = numbered.slice(0, 3).map((p) => textFor(p))

  const options = {
    position,
    format,
    startAt,
    pages: sel.pages.length ? sel.pages : undefined,
    style: toTextStyle(style),
  }
  const depsKey = useMemo(() => JSON.stringify([position, format, startAt, sel.pages, style, fileName]), [position, format, startAt, sel.pages, style, fileName])

  return (
    <ToolShell
      tool={tool}
      runLabel="Add page numbers"
      canRun={valid}
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setFileName(f[0]?.name ?? 'file.pdf')
        setRangeText('')
      }}
      options={() => (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <PagePositionGrid value={position} onChange={setPosition} legend="Where should the number go?" />

            <div className="space-y-3">
              <SelectField label="Number format" value={FORMATS.some((f) => f.value === fmt) ? fmt : 'custom'} onChange={setFmt} options={FORMATS} />
              {fmt === 'custom' && <TextField label="Custom format" value={custom} onChange={setCustom} error={formatError} hint="Write your own text. {page} is the page number, {pages} the last number, {page:2} adds a leading zero (01), {date} today's date, {filename} the file name." testId="pn-custom" />}
              <p className="text-sm text-ink-600 dark:text-ink-300" data-testid="pn-example">
                Example:{' '}
                {example.map((t, i) => (
                  <span key={i} className="mr-1.5 inline-block rounded bg-ink-100 px-2 py-0.5 font-mono text-xs dark:bg-ink-800">
                    {t || '…'}
                  </span>
                ))}
                {numbered.length > 3 || (!sel.pages.length && total > 3) ? '…' : ''}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Apply to specific pages" value={rangeText} onChange={setRangeText} error={sel.error} placeholder="e.g. 2-" hint={numPages ? `Leave this empty to number every page (all ${numPages}). Or type pages and ranges, like 2-, 1-3, 5, 8-10.` : 'Leave this empty to number every page. Or type pages and ranges, like 2-, 1-3, 5, 8-10.'} testId="pn-pages" />
              <TextField
                label="Start numbering at"
                type="number"
                min={0}
                value={start}
                onChange={setStart}
                error={startError}
                hint="The number given to the first page of this PDF. Use it when the file continues another document: starting at 5 numbers its pages 5, 6, 7 …"
                testId="pn-start"
              />
            </div>

            <StyleFields value={style} onChange={setStyle} />
          </div>

          {fileId && numPages > 0 && (
            <div className="lg:sticky lg:top-24 lg:self-start">
              <StampPreview
                fileId={fileId}
                pageCount={numPages}
                enabled={valid}
                depsKey={depsKey}
                jumpTo={sel.pages[0]}
                title="Preview of the result"
                build={(bytes, p) => addPageNumbers(bytes, fileName, { ...options, onlyPage: p })}
                caption={(p) =>
                  sel.pages.length && !sel.pages.includes(p) ? (
                    <>Page {p} is not in the pages you chose, so it gets no number.</>
                  ) : (
                    <>
                      Page {p} gets <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono dark:bg-ink-800">{textFor(p) || '…'}</span>
                    </>
                  )
                }
              />
            </div>
          )}
        </div>
      )}
      run={async ({ files, progress }) => ({
        name: `${baseName(files[0].name)}-numbered.pdf`,
        bytes: await addPageNumbers(getBytes(files[0].id), files[0].name, options, progress),
        mime: PDF_MIME,
      })}
    />
  )
}
export default PageNumbersTool
