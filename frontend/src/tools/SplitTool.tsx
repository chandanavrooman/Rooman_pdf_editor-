import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bookmark as BookmarkIcon, HardDrive, ListOrdered, Loader2, Scissors, Type } from 'lucide-react'
import { ToolShell } from '@/components/ToolShell'
import { Notice } from '@/components/Notice'
import { Field, SelectField } from '@/components/forms'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { formatBytes, getBytes } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import { getTopLevelBookmarks } from '@/lib/outline'
import { planBySize, splitByBookmarks, splitByRanges, splitBySize, splitEveryN, type Bookmark } from '@/lib/pdfOps'
import { parseRanges } from '@/lib/ranges'
import { estimateSizeParts, pagesLabel, parseSizeLimit, partPages, planBookmarks, planEvery, planRanges, planText, sizePlanToParts, type Plan, type SizeUnit } from '@/lib/splitPlan'
import { PDF_MIME, type ToolPage } from './shared/types'

type Mode = 'ranges' | 'every' | 'bookmarks' | 'size' | 'text'

/** Files up to this size get the exact size plan worked out while you type; bigger ones get an estimate until you press Split PDF. */
const LIVE_PLAN_MAX_BYTES = 30 * 1024 * 1024

const METHODS: { value: Mode; title: string; description: string; example: string; icon: ReactNode }[] = [
  { value: 'ranges', title: 'By page ranges', description: 'Split your PDF using specific page numbers or ranges.', example: '1-3, 4-6, 7-10', icon: <ListOrdered className="h-5 w-5" /> },
  { value: 'every', title: 'Every X pages', description: 'Automatically divide your PDF into equal-sized groups.', example: '3 pages each', icon: <Scissors className="h-5 w-5" /> },
  { value: 'bookmarks', title: 'By bookmarks', description: 'Split your PDF into separate documents using its bookmarks.', example: 'One PDF per chapter', icon: <BookmarkIcon className="h-5 w-5" /> },
  { value: 'text', title: 'By text', description: 'Start a new PDF at every page that contains the words you type.', example: 'Invoice no.', icon: <Type className="h-5 w-5" /> },
  { value: 'size', title: 'By file size', description: 'Divide your PDF into smaller files with a maximum size.', example: 'No file above 2 MB', icon: <HardDrive className="h-5 w-5" /> },
]

function MethodPicker({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <fieldset>
      <legend className="label">How do you want to split it?</legend>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="split-methods">
        {METHODS.map((m) => (
          <label
            key={m.value}
            className={`relative flex cursor-pointer gap-3 rounded-2xl border p-4 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500 ${
              value === m.value ? 'border-brand-500 bg-brand-50 shadow-sm dark:border-brand-400 dark:bg-brand-900/30' : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800/60'
            }`}
          >
            <input type="radio" name="split-method" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" checked={value === m.value} onChange={() => onChange(m.value)} data-testid={`method-${m.value}`} />
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${value === m.value ? 'bg-brand-600 text-white dark:bg-brand-400 dark:text-ink-950' : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300'}`}>{m.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{m.title}</span>
              <span className="mt-0.5 block text-xs text-ink-600 dark:text-ink-300">{m.description}</span>
              <span className="mt-1.5 inline-block rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-700 dark:bg-ink-800 dark:text-ink-200">{m.example}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** "What you will get": updates with every change, before anything is processed. */
function Summary({ plan, total, headline, busy, extra }: { plan: Plan | null; total: number; headline?: string; busy?: boolean; extra?: ReactNode }) {
  if (!plan || !plan.ok) return null
  const n = plan.parts.length
  return (
    <div className="rounded-2xl border border-ink-200 bg-ink-50 p-4 dark:border-ink-700 dark:bg-ink-900/60" data-testid="split-summary" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">What you will get</p>
        <p className="text-sm text-ink-600 dark:text-ink-300">
          {headline ?? `${total} page${total === 1 ? '' : 's'}`} → <strong data-testid="split-count" className="text-ink-900 dark:text-ink-50">{n} PDF{n === 1 ? '' : 's'}</strong>
        </p>
      </div>
      <ul className="mt-3 max-h-56 space-y-1 overflow-auto pr-1 text-sm" data-testid="split-parts">
        {plan.parts.map((p, i) => (
          <li key={i} className="flex items-baseline gap-2 rounded-lg bg-white px-3 py-1.5 dark:bg-ink-950/60">
            <span className="shrink-0 text-xs font-semibold text-brand-700 dark:text-brand-300">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate" title={p.label}>
              {p.label}
              {p.note && <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">{p.note}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-ink-600 dark:text-ink-300">
              {pagesLabel(p.start, p.end)} <span className="text-ink-400">· {partPages(p)}</span>
            </span>
          </li>
        ))}
      </ul>
      {busy && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-500" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Working out the exact split…
        </p>
      )}
      {plan.notes.map((t) => (
        <p key={t} className="mt-2 text-xs text-ink-600 dark:text-ink-300">
          {t}
        </p>
      ))}
      {extra}
    </div>
  )
}

const SplitTool: ToolPage = ({ tool }) => {
  const [mode, setMode] = useState<Mode>('ranges')
  const [ranges, setRanges] = useState('')
  const [every, setEvery] = useState('3')
  const [size, setSize] = useState('2')
  const [unit, setUnit] = useState<SizeUnit>('MB')
  const [fileId, setFileId] = useState<string>()
  const [fileSize, setFileSize] = useState(0)
  const { doc, numPages } = usePdfDoc(fileId)
  const [marks, setMarks] = useState<Bookmark[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [exact, setExact] = useState<{ key: string; plan: Plan } | null>(null)
  const [exactError, setExactError] = useState<string | null>(null)
  const [needle, setNeedle] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [pageTexts, setPageTexts] = useState<string[] | null>(null)

  // "By text" needs the words on every page; read them once when that method is chosen
  useEffect(() => {
    if (mode !== 'text' || !doc || pageTexts) return
    let cancelled = false
    ;(async () => {
      const out: string[] = []
      for (let n = 1; n <= doc.numPages; n++) {
        const tc = await (await doc.getPage(n)).getTextContent()
        out.push(tc.items.map((i) => ('str' in i ? i.str : '')).join(' ').replace(/\s+/g, ' '))
      }
      if (!cancelled) setPageTexts(out)
    })().catch(() => !cancelled && setPageTexts([]))
    return () => {
      cancelled = true
    }
  }, [mode, doc, pageTexts])

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    getTopLevelBookmarks(doc).then(
      (m) => {
        if (cancelled) return
        setMarks(m)
        setPicked(new Set(m.map((_, i) => i))) // every bookmark ticked to begin with
      },
      () => !cancelled && setMarks([]),
    )
    return () => {
      cancelled = true
    }
  }, [doc])

  const limit = useMemo(() => parseSizeLimit(size, unit), [size, unit])
  const sizeKey = limit.ok && fileId ? `${fileId}|${limit.bytes}` : ''

  // small files: work out the REAL size split while the user types (same code as the Split button)
  useEffect(() => {
    if (mode !== 'size' || !limit.ok || !fileId || !numPages || fileSize > LIVE_PLAN_MAX_BYTES) return
    let cancelled = false
    const timer = setTimeout(() => {
      planBySize(getBytes(fileId), limit.bytes, undefined, () => cancelled).then(
        (p) => {
          if (cancelled) return
          setExactError(null)
          setExact({ key: sizeKey, plan: sizePlanToParts(p.ranges, p.oversizePages) })
        },
        (e) => !cancelled && setExactError(e instanceof Error ? e.message : String(e)),
      )
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sizeKey, numPages, fileSize])

  const plan: Plan | null = useMemo(() => {
    if (!numPages) return null
    if (mode === 'ranges') return planRanges(ranges, numPages)
    if (mode === 'every') return planEvery(every, numPages)
    if (mode === 'text') return planText(needle, matchCase, pageTexts, numPages)
    if (mode === 'bookmarks') return marks && marks.length ? planBookmarks(marks, picked, numPages) : null
    if (!limit.ok) return { ok: false, error: limit.error }
    if (exact && exact.key === sizeKey) return exact.plan
    return null
  }, [mode, ranges, every, marks, picked, numPages, limit, exact, sizeKey, needle, matchCase, pageTexts])

  const sizeBusy = mode === 'size' && limit.ok && fileSize <= LIVE_PLAN_MAX_BYTES && !!numPages && !(exact && exact.key === sizeKey) && !exactError
  const bigFileEstimate = mode === 'size' && limit.ok && fileSize > LIVE_PLAN_MAX_BYTES && numPages ? estimateSizeParts(fileSize, limit.bytes, numPages) : 0
  const ranksOk = plan?.ok === true
  const canRun = numPages > 0 && (mode === 'size' ? limit.ok : ranksOk)

  const fieldError = plan && !plan.ok && (mode === 'ranges' ? ranges.trim() !== '' : true) ? plan.error : null
  const exampleRanges = numPages >= 2 ? (numPages >= 6 ? `1-${Math.floor(numPages / 3)}, ${Math.floor(numPages / 3) + 1}-${Math.floor((2 * numPages) / 3)}, ${Math.floor((2 * numPages) / 3) + 1}-${numPages}` : `1, 2-${numPages}`) : ''

  const toggle = (i: number) =>
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  return (
    <ToolShell
      tool={tool}
      runLabel="Split PDF"
      onFilesChange={(f) => {
        setFileId(f[0]?.id)
        setFileSize(f[0]?.size ?? 0)
        setMarks(null)
        setPicked(new Set())
        setRanges('')
        setExact(null)
        setPageTexts(null)
      }}
      canRun={canRun}
      options={() => (
        <div className="space-y-6">
          <MethodPicker value={mode} onChange={setMode} />

          {mode === 'ranges' && (
            <div className="space-y-2">
              <Field label="Pages for each PDF" htmlFor="split-ranges" error={fieldError} hint={`Type the pages for each PDF, separated by commas. Each range becomes its own PDF.${numPages ? ` Your document has ${numPages} pages.` : ''}`}>
                <input id="split-ranges" data-testid="split-ranges" className={`input ${fieldError ? '!border-red-500' : ''}`} value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="1-3, 4-6, 7-10" aria-invalid={!!fieldError} autoComplete="off" spellCheck={false} />
              </Field>
              {exampleRanges && !ranges.trim() && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => setRanges(exampleRanges)} data-testid="split-example">
                  Use an example for {numPages} pages: <span className="font-mono">{exampleRanges}</span>
                </button>
              )}
            </div>
          )}

          {mode === 'every' && (
            <div className="space-y-2">
              <div className="w-48">
                <Field label="Pages per PDF" htmlFor="split-every" error={fieldError} hint="For example, 3 turns a 12-page PDF into 4 PDFs.">
                  <input id="split-every" data-testid="split-every" className={`input ${fieldError ? '!border-red-500' : ''}`} type="number" min={1} step={1} inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} aria-invalid={!!fieldError} />
                </Field>
              </div>
            </div>
          )}

          {mode === 'text' && (
            <div className="space-y-3">
              <Field label="Start a new PDF at pages that contain" htmlFor="split-text" error={plan && !plan.ok && needle.trim() ? plan.error : null} hint="Every page with this text begins a new PDF; the pages after it, up to the next match, go in the same PDF. Scanned pages without real text cannot be searched.">
                <input id="split-text" data-testid="split-text" className="input" value={needle} onChange={(e) => setNeedle(e.target.value)} placeholder="Invoice no." autoComplete="off" spellCheck={false} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" data-testid="split-text-case" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match upper and lower case
              </label>
              {pageTexts === null && (
                <p className="flex items-center gap-2 text-sm text-ink-500" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading the text of every page…
                </p>
              )}
            </div>
          )}

          {mode === 'bookmarks' &&
            (marks === null ? (
              <p className="flex items-center gap-2 text-sm text-ink-500" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Looking for bookmarks…
              </p>
            ) : marks.length === 0 ? (
              <Notice kind="warn" title="This PDF has no bookmarks">
                Bookmarks (also called an outline) are the chapter list some PDFs show in a side panel. This one has none, so there is nothing to split at. Try “By page ranges” or “Every X pages” instead.
              </Notice>
            ) : (
              <div data-testid="split-bookmarks">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="label !mb-0">
                    Split at these bookmarks <span className="font-normal text-ink-500">({picked.size} of {marks.length} ticked)</span>
                  </p>
                  <span className="flex gap-1">
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setPicked(new Set(marks.map((_, i) => i)))} data-testid="marks-all">
                      Select all
                    </button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setPicked(new Set())} data-testid="marks-none">
                      Clear
                    </button>
                  </span>
                </div>
                <ul className="max-h-60 divide-y divide-ink-100 overflow-auto rounded-xl border border-ink-200 dark:divide-ink-800 dark:border-ink-700">
                  {marks.map((m, i) => (
                    <li key={i}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-ink-50 dark:hover:bg-ink-800/60">
                        <input type="checkbox" className="accent-brand-600" checked={picked.has(i)} onChange={() => toggle(i)} data-testid={`mark-${i}`} />
                        <span className="min-w-0 flex-1 truncate" title={m.title}>
                          {m.title}
                        </span>
                        <span className="shrink-0 tabular-nums text-xs text-ink-500">page {m.pageIndex + 1}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="hint">Only top-level bookmarks are listed. A chapter&apos;s own sub-bookmarks stay inside its PDF.</p>
                {plan && !plan.ok && (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                    {plan.error}
                  </p>
                )}
              </div>
            ))}

          {mode === 'size' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-start gap-3">
                <div className="w-44">
                  <Field label="Largest file size" htmlFor="split-size" error={!limit.ok ? limit.error : null}>
                    <input id="split-size" data-testid="split-size" className={`input ${!limit.ok ? '!border-red-500' : ''}`} type="number" min={0} step={0.1} inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} aria-invalid={!limit.ok} />
                  </Field>
                </div>
                <div className="w-28">
                  <SelectField label="Unit" value={unit} onChange={setUnit} options={[{ value: 'KB', label: 'KB' }, { value: 'MB', label: 'MB' }]} />
                </div>
              </div>
              <p className="hint">A page is never cut in half. Pages are packed into each file until the next page would push it over the limit, and every file&apos;s real size is checked. If one page is bigger than the limit on its own, it gets its own file and you are told.</p>
            </div>
          )}

          {mode === 'size' && limit.ok && bigFileEstimate > 0 && (
            <div className="rounded-2xl border border-ink-200 bg-ink-50 p-4 text-sm dark:border-ink-700 dark:bg-ink-900/60" data-testid="split-summary">
              <p className="font-semibold">What you will get</p>
              <p className="mt-1 text-ink-600 dark:text-ink-300">
                {formatBytes(fileSize)} file, limit {size} {unit} → about <strong data-testid="split-count">{bigFileEstimate}</strong> PDF{bigFileEstimate === 1 ? '' : 's'} (an estimate; this file is large, so the exact split is worked out when you press Split PDF).
              </p>
            </div>
          )}
          {mode === 'size' && exactError && <Notice kind="warn">{exactError}</Notice>}

          <Summary
            plan={plan}
            total={numPages}
            headline={mode === 'every' && plan?.ok ? `${numPages} pages, ${Number(every)} per PDF` : mode === 'size' && limit.ok ? `${numPages} pages, max ${size} ${unit} each` : undefined}
            busy={sizeBusy}
          />
          {mode === 'size' && sizeBusy && !plan && (
            <p className="flex items-center gap-1.5 text-xs text-ink-500" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Working out the exact split…
            </p>
          )}
        </div>
      )}
      run={async ({ files, progress }) => {
        const name = baseName(files[0].name)
        const bytes = getBytes(files[0].id)
        let parts
        const notes: string[] = []
        if (mode === 'ranges') parts = await splitByRanges(bytes, name, parseRanges(ranges, numPages), progress)
        else if (mode === 'text') {
          const tp = planText(needle, matchCase, pageTexts, numPages)
          if (!tp.ok) throw new Error(tp.error)
          parts = await splitByRanges(bytes, name, tp.parts.map((p) => ({ start: p.start, end: p.end })), progress)
        }
        else if (mode === 'every') parts = await splitEveryN(bytes, name, Number(every), progress)
        else if (mode === 'bookmarks') parts = await splitByBookmarks(bytes, name, (marks ?? []).filter((_, i) => picked.has(i)), progress)
        else {
          const r = await splitBySize(bytes, name, limit.ok ? limit.bytes : 0, progress)
          parts = r.files
          const biggest = Math.max(...parts.map((p) => p.bytes.byteLength))
          notes.push(`${parts.length} file${parts.length === 1 ? '' : 's'}; the largest is ${formatBytes(biggest)}.`)
          if (r.oversize.length) notes.push(`${r.oversize.join(', ')} ${r.oversize.length === 1 ? 'is' : 'are'} larger than the ${size} ${unit} limit on ${r.oversize.length === 1 ? 'its' : 'their'} own, so ${r.oversize.length === 1 ? 'it was' : 'they were'} kept as ${r.oversize.length === 1 ? 'its own file' : 'their own files'} and ${r.oversize.length === 1 ? 'is' : 'are'} over the limit.`)
        }
        return { outputs: parts.map((p) => ({ name: p.name, bytes: p.bytes, mime: PDF_MIME })), notes }
      }}
    />
  )
}
export default SplitTool
