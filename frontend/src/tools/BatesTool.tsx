import { useMemo, useState } from 'react'
import { ToolShell } from '@/components/ToolShell'
import { PagePositionGrid } from '@/components/PagePositionGrid'
import { StampPreview } from '@/components/StampPreview'
import { Field } from '@/components/forms'
import { usePageCounts } from '@/hooks/usePageCounts'
import { getBytes, type StoredFileMeta } from '@/lib/fileStore'
import { batesNumber, batesPreviewPage, formatBates, type BatesOptions, type Position } from '@/lib/pdfOps'
import { defaultStyleState, StyleFields, styleValid, toTextStyle, type StyleState } from './shared/StyleFields'
import { PDF_MIME, type ToolPage } from './shared/types'

// the standard PDF fonts draw Latin letters, digits and common symbols only
const DRAWABLE = /^[ -~¡-ÿ]*$/

const BatesTool: ToolPage = ({ tool }) => {
  const [files, setFiles] = useState<StoredFileMeta[]>([])
  const [prefix, setPrefix] = useState('DOC-')
  const [suffix, setSuffix] = useState('')
  const [start, setStart] = useState('1')
  const [digits, setDigits] = useState('6')
  const [position, setPosition] = useState<Position>({ v: 'bottom', h: 'right' })
  const [style, setStyle] = useState<StyleState>(defaultStyleState)
  const [previewFile, setPreviewFile] = useState<string>()
  const counts = usePageCounts(files.map((f) => f.id))

  const errors = {
    prefix: DRAWABLE.test(prefix) ? null : 'Use letters, numbers and common symbols: the standard PDF fonts cannot draw other characters.',
    suffix: DRAWABLE.test(suffix) ? null : 'Use letters, numbers and common symbols: the standard PDF fonts cannot draw other characters.',
    start: /^\d+$/.test(start.trim()) ? null : 'Start number must be a whole number, 0 or more.',
    digits: /^\d+$/.test(digits.trim()) && Number(digits) >= 1 && Number(digits) <= 12 ? null : 'Digits must be a whole number from 1 to 12.',
  }
  const numbersOk = !errors.prefix && !errors.suffix && !errors.start && !errors.digits
  const valid = numbersOk && styleValid(style)
  const startAt = errors.start ? 1 : parseInt(start, 10)
  const d = errors.digits ? 6 : parseInt(digits, 10)
  const opts: BatesOptions = { prefix, suffix, startAt, digits: d, position, style: toTextStyle(style) }
  const fmt = (n: number) => formatBates(opts, n)

  // where each file's numbers begin: the pages of the files above it come first
  const plan = useMemo(() => {
    let before: number | null = 0
    return files.map((f) => {
      const n = counts[f.id]
      const row = { id: f.id, pages: n, before }
      before = before === null || typeof n !== 'number' ? null : before + n
      return row
    })
  }, [files, counts])
  const totalPages = plan.length && plan.every((r) => typeof r.pages === 'number') ? plan.reduce((a, r) => a + (r.pages as number), 0) : null

  const shown = plan.find((r) => r.id === previewFile) ?? plan[0]
  const shownFile = files.find((f) => f.id === shown?.id)
  const depsKey = JSON.stringify([position, prefix, suffix, startAt, d, style, shown?.before, shown?.id])

  return (
    <ToolShell
      tool={tool}
      multiple
      runLabel="Apply Bates numbers"
      canRun={valid}
      uploadTitle="Choose the PDF files to stamp"
      onFilesChange={setFiles}
      filesHint="Numbering continues from one file into the next, in the order listed here, and does not start again at 1. Drag a file, or use the arrows, to change the order."
      fileNote={(f, i) => {
        const row = plan[i]
        if (!row || plan[i].id !== f.id) return null
        if (row.pages === undefined) return 'Counting pages…'
        if (row.pages === null) return 'Page count unknown: this file cannot be read'
        if (row.before === null || !numbersOk) return null
        return (
          <>
            Numbers <span className="font-mono">{fmt(startAt + row.before)}</span>
            {row.pages > 1 && (
              <>
                {' '}to <span className="font-mono">{fmt(startAt + row.before + row.pages - 1)}</span>
              </>
            )}
          </>
        )
      }}
      options={() => (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <PagePositionGrid value={position} onChange={setPosition} legend="Where should the Bates number go?" what="the Bates number" />

            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Prefix" htmlFor="bates-prefix" error={errors.prefix} hint="Text before the number, like DOC- or CASE-2025-. Can be empty.">
                  <input id="bates-prefix" data-testid="bates-prefix" className={`input ${errors.prefix ? '!border-red-500' : ''}`} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="DOC-" autoComplete="off" spellCheck={false} aria-invalid={!!errors.prefix} />
                </Field>
                <Field label="Start number" htmlFor="bates-start" error={errors.start} hint="The first page gets this number. Every page after it counts up by one, across all your files.">
                  <input id="bates-start" data-testid="bates-start" className={`input ${errors.start ? '!border-red-500' : ''}`} type="number" min={0} value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!errors.start} />
                </Field>
                <Field label="Digits" htmlFor="bates-digits" error={errors.digits} hint="How many digits the number has. Short numbers get zeros in front: 6 digits gives 000001.">
                  <input id="bates-digits" data-testid="bates-digits" className={`input ${errors.digits ? '!border-red-500' : ''}`} type="number" min={1} max={12} value={digits} onChange={(e) => setDigits(e.target.value)} aria-invalid={!!errors.digits} />
                </Field>
                <Field label="Suffix" htmlFor="bates-suffix" error={errors.suffix} hint="Text after the number, like -CONF or -A. Can be empty.">
                  <input id="bates-suffix" data-testid="bates-suffix" className={`input ${errors.suffix ? '!border-red-500' : ''}`} value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="-CONF" autoComplete="off" spellCheck={false} aria-invalid={!!errors.suffix} />
                </Field>
              </div>

              <div className="rounded-xl border border-ink-200 bg-ink-50 p-3 text-sm dark:border-ink-700 dark:bg-ink-900/60" data-testid="bates-example" aria-live="polite">
                <p className="text-xs font-medium text-ink-600 dark:text-ink-300">Your Bates numbers will look like</p>
                {numbersOk ? (
                  <>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="rounded bg-white px-2 py-0.5 font-mono text-xs ring-1 ring-ink-200 dark:bg-ink-950 dark:ring-ink-700">
                          {fmt(startAt + i)}
                        </span>
                      ))}
                      <span className="text-ink-400">…</span>
                    </p>
                    {totalPages !== null && (
                      <p className="mt-1.5 text-xs text-ink-600 dark:text-ink-300" data-testid="bates-range">
                        {files.length} file{files.length === 1 ? '' : 's'}, {totalPages} page{totalPages === 1 ? '' : 's'}: from <span className="font-mono">{fmt(startAt)}</span> to <span className="font-mono">{fmt(startAt + totalPages - 1)}</span>.
                      </p>
                    )}
                    {Number(digits) < String(startAt + (totalPages ?? 1) - 1).length && <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">The last numbers have more than {digits} digits, so they will be longer than the others. Raise Digits to keep them the same length.</p>}
                  </>
                ) : (
                  <p className="mt-1 text-xs text-ink-500">Fix the fields above to see the numbers.</p>
                )}
              </div>
            </div>

            <StyleFields value={style} onChange={setStyle} />
          </div>

          {shownFile && typeof shown.pages === 'number' && shown.pages > 0 && (
            <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
              {files.length > 1 && (
                <label className="block text-xs font-medium text-ink-600 dark:text-ink-300">
                  Preview file
                  <select className="input mt-1 !py-1.5 text-sm" value={shown.id} onChange={(e) => setPreviewFile(e.target.value)} data-testid="bates-preview-file" aria-label="File to preview">
                    {files.map((f, i) => (
                      <option key={f.id} value={f.id}>
                        {i + 1}. {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <StampPreview
                key={shown.id}
                fileId={shown.id}
                pageCount={shown.pages}
                enabled={valid && shown.before !== null}
                depsKey={depsKey}
                title="Preview of the result"
                build={(bytes, p) => batesPreviewPage(bytes, opts, shown.before ?? 0, p)}
                caption={(p) => (
                  <>
                    Page {p} of {shownFile.name} gets <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono dark:bg-ink-800">{fmt(startAt + (shown.before ?? 0) + p - 1)}</span>
                  </>
                )}
              />
            </div>
          )}
        </div>
      )}
      run={async ({ files: input, progress }) => {
        const res = await batesNumber(input.map((f) => ({ name: f.name, bytes: getBytes(f.id) })), opts, progress)
        return {
          outputs: res.files.map((f) => ({ name: f.name.replace(/\.pdf$/i, '') + '-bates.pdf', bytes: f.bytes, mime: PDF_MIME })),
          notes: [`Numbered ${input.length} file${input.length === 1 ? '' : 's'} in one sequence, from ${res.first} to ${res.last}.`],
        }
      }}
    />
  )
}
export default BatesTool
