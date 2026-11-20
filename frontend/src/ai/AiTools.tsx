import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Eye, FileText, Loader2, Pencil, Plus, Square, Trash2 } from 'lucide-react'
import { Dropzone } from '@/components/Dropzone'
import { Notice } from '@/components/Notice'
import { PdfViewer, type PdfViewerHandle } from '@/components/PdfViewer'
import { ProgressBar } from '@/components/ProgressBar'
import { ToolIcon } from '@/components/ToolIcon'
import { Checkbox, SelectField, TextField, Field } from '@/components/forms'
import { addBytes, addFile, formatBytes, removeFile, type StoredFileMeta } from '@/lib/fileStore'
import { useStoredFiles } from '@/hooks/useStoredFiles'
import { downloadDocumentBytes, friendlyMessage, type DocumentInfo } from '@/lib/apiClient'
import { downloadBytes } from '@/lib/download'
import { streamSse } from '@/lib/sse'
import { useAuth } from '@/lib/auth'
import { toolById, type ToolMeta } from '@/lib/tools'
import type { ToolPage } from '@/tools/shared/types'
import { Markdown, type CitationClick } from './Markdown'
import { AiKeyBanner, ErrorNotice, PrivacyNotice, SignInGate, toStreamError, useAiStatus, useServerDoc, type AiStatus } from './shared'
import { initialStream, reduceStream, type DiffPayload, type StreamState } from './streamState'

interface WorkspaceProps {
  tool: ToolMeta
  /** 1 = single document; >1 = several (ask) ; compare uses exactly 2 */
  maxFiles?: number
  minFiles?: number
  uploadTitle?: string
  path: string
  runLabel: string
  /** options UI below the files */
  options?: (ctx: { files: StoredFileMeta[]; status: AiStatus | null }) => React.ReactNode
  canRun?: boolean
  /** request body from the server documents (same order as the files) */
  buildBody: (docs: DocumentInfo[]) => Record<string, unknown>
  /** extra rendering under the streamed text (diff view, translated pages…) */
  renderExtra?: (s: StreamState, ctx: { onCitation: (c: CitationClick) => void }) => React.ReactNode
  /** hide the streamed text block (compare shows the diff first) */
  textTitle?: string
  downloadName?: string
  needsKey?: boolean | ((status: AiStatus | null) => boolean)
}

export function FileRow({ file, label, onDoc, onRemove, onView }: { file: StoredFileMeta; label?: string; onDoc: (id: string, d: DocumentInfo | null) => void; onRemove: () => void; onView: () => void }) {
  const { doc, progress, error } = useServerDoc(file.id)
  useEffect(() => {
    onDoc(file.id, doc)
  }, [doc, file.id, onDoc])
  return (
    <li className="rounded-xl border border-ink-200 p-2.5 dark:border-ink-800" data-testid="ai-file-row">
      <div className="flex items-center gap-3">
        <FileText className="h-5 w-5 shrink-0 text-ink-400" aria-hidden="true" />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onView}>
          <p className="truncate text-sm font-medium">{label && <span className="mr-2 rounded bg-ink-100 px-1.5 text-xs dark:bg-ink-800">{label}</span>}{file.name}</p>
          <p className="text-xs text-ink-500">{formatBytes(file.size)}{doc?.pages ? ` · ${doc.pages} pages` : ''}{doc ? ' · uploaded' : ''}</p>
        </button>
        <button type="button" className="btn-ghost btn-sm !px-2" onClick={onRemove} aria-label={`Remove ${file.name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      {!doc && !error && <div className="mt-2"><ProgressBar value={progress} label="Uploading to the server" /></div>}
      {error && <p className="mt-1 text-xs font-medium text-red-600" role="alert">{error}</p>}
    </li>
  )
}

function TextDownload({ text, name }: { text: string; name: string }) {
  return (
    <button type="button" className="btn-secondary" data-testid="download-text" onClick={() => downloadBytes(name, new TextEncoder().encode(text), 'text/plain;charset=utf-8')}>
      <Download className="h-4 w-4" aria-hidden="true" /> Download as .txt
    </button>
  )
}

function DocButton({ doc, onPreview }: { doc: DocumentInfo; onPreview?: (doc: DocumentInfo) => void }) {
  const [err, setErr] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-1.5">
      {onPreview && doc.mime === 'application/pdf' && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onPreview(doc)}
          title={`Preview ${doc.filename} in the viewer`}
        >
          <Eye className="h-4 w-4" aria-hidden="true" /> Preview
        </button>
      )}
      <button type="button" className="btn-primary" data-testid="download-document" onClick={() => downloadDocumentBytes(doc).then((b) => downloadBytes(doc.filename, b, doc.mime), (e) => setErr(friendlyMessage(e)))}>
        <Download className="h-4 w-4" aria-hidden="true" /> {doc.filename}
      </button>
      {err && <span className="ml-2 text-xs text-red-600">{err}</span>}
    </span>
  )
}

export function AiWorkspace({ tool, maxFiles = 1, minFiles = 1, uploadTitle, path, runLabel, options, canRun = true, buildBody, renderExtra, textTitle = 'Result', downloadName = 'result.txt', needsKey = true }: WorkspaceProps) {
  const { token } = useAuth()
  const status = useAiStatus()
  const [fileIds, setFileIds] = useState<string[]>([])
  const files = useStoredFiles(fileIds)
  const [docs, setDocs] = useState<Record<string, DocumentInfo | null>>({})
  const [errs, setErrs] = useState<string[]>([])
  const [stream, setStream] = useState<StreamState>(initialStream)
  const [viewId, setViewId] = useState<string>()
  const viewer = useRef<PdfViewerHandle>(null)
  const pending = useRef<number | null>(null)
  const ac = useRef<AbortController | null>(null)

  useEffect(() => () => ac.current?.abort(), [])
  const onDoc = useCallback((id: string, d: DocumentInfo | null) => setDocs((m) => (m[id] === d ? m : { ...m, [id]: d })), [])

  const add = async (list: File[]) => {
    const e: string[] = []
    const added: string[] = []
    for (const f of list) {
      if (fileIds.length + added.length >= maxFiles) {
        e.push(`At most ${maxFiles} file${maxFiles === 1 ? '' : 's'} can be used here.`)
        break
      }
      try {
        added.push((await addFile(f)).id)
      } catch (x) {
        e.push(friendlyMessage(x))
      }
    }
    setErrs(e)
    if (maxFiles === 1 && added.length) fileIds.forEach(removeFile)
    setFileIds((p) => (maxFiles === 1 ? added.slice(0, 1) : [...p, ...added]))
    if (added.length && !viewId) setViewId(added[0])
  }
  const remove = (id: string) => {
    removeFile(id)
    setFileIds((p) => p.filter((x) => x !== id))
    setViewId((v) => (v === id ? fileIds.find((x) => x !== id) : v))
  }

  const ready = files.length >= minFiles && files.every((f) => docs[f.id]) && canRun && !!token
  const keyNeeded = typeof needsKey === 'function' ? needsKey(status) : needsKey
  const blockedByKey = keyNeeded && status !== null && !status.configured

  const run = async () => {
    const ordered = files.map((f) => docs[f.id]!)
    const controller = new AbortController()
    ac.current = controller
    setStream({ ...initialStream, status: 'streaming' })
    try {
      await streamSse(path, buildBody(ordered), { signal: controller.signal, onEvent: (ev) => setStream((s) => reduceStream(s, ev)) })
      setStream((s) => (s.status === 'streaming' ? { ...s, status: 'done' } : s))
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setStream((s) => ({ ...s, status: 'done' }))
      else setStream((s) => ({ ...s, status: 'error', error: toStreamError(e) }))
    }
  }

  const previewDoc = async (d: DocumentInfo) => {
    try {
      const bytes = await downloadDocumentBytes(d)
      const meta = addBytes(d.filename, bytes)
      setViewId(meta.id)
    } catch {
      // ignore
    }
  }

  const onCitation = (c: CitationClick) => {
    const idx = c.label ? Number(c.label.slice(1)) - 1 : 0
    const target = files[idx]?.id ?? files[0]?.id
    if (!target) return
    if (target === viewId) viewer.current?.scrollToPage(c.page)
    else {
      pending.current = c.page
      setViewId(target)
    }
  }

  /** a citation is only clickable when that page exists in the cited document */
  const validPage = (c: CitationClick) => {
    const d = docs[files[c.label ? Number(c.label.slice(1)) - 1 : 0]?.id ?? '']
    return !d?.pages || (c.page >= 1 && c.page <= d.pages)
  }
  const related = useMemo(() => tool.related.map(toolById).filter((t): t is ToolMeta => !!t && t.status === 'available'), [tool])
  const busy = stream.status === 'streaming'
  const showResult = stream.status !== 'idle'
  const viewFile = files.find((f) => f.id === viewId) ?? files[0]

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200"><ToolIcon name={tool.icon} className="h-6 w-6" /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{tool.name}</h1>
          <p className="mt-1 text-ink-600 dark:text-ink-300">{tool.description}</p>
        </div>
      </div>
      <div className="mb-4 space-y-3">
        <PrivacyNotice textOnly={keyNeeded} />
        <SignInGate />
        {keyNeeded && <AiKeyBanner status={status} />}
        {errs.map((m) => <Notice key={m} kind="error">{m}</Notice>)}
      </div>

      <div className={`grid gap-4 ${viewFile ? 'lg:grid-cols-2' : ''}`}>
        <div className="space-y-4">
          <section className="card space-y-3 p-4" aria-label="Your files">
            {files.length > 0 && (
              <ul className="space-y-2">
                {files.map((f, i) => <FileRow key={f.id} file={f} label={maxFiles > 1 ? `D${i + 1}` : undefined} onDoc={onDoc} onRemove={() => remove(f.id)} onView={() => setViewId(f.id)} />)}
              </ul>
            )}
            {files.length < maxFiles && (
              <Dropzone compact={files.length > 0} multiple={maxFiles > 1} onFiles={add} accept="application/pdf,.pdf" title={uploadTitle ?? (files.length ? 'Add another PDF' : maxFiles > 1 ? 'Choose PDF files' : 'Choose a PDF')} hint="Drag and drop, or browse. Uploaded to the server." />
            )}
          </section>

          {files.length > 0 && (
            <section className="card space-y-4 p-4" aria-label="Options">
              {options?.({ files, status })}
              <div className="flex flex-wrap items-center justify-end gap-3">
                {blockedByKey && <p className="text-xs text-red-600">AI is not configured on the server.</p>}
                {busy ? (
                  <button type="button" className="btn-secondary" onClick={() => ac.current?.abort()}><Square className="h-4 w-4" aria-hidden="true" /> Stop</button>
                ) : (
                  <button type="button" className="btn-primary !px-6 !py-3 text-base" disabled={!ready || blockedByKey} onClick={() => void run()} data-testid="ai-run">{runLabel}</button>
                )}
              </div>
            </section>
          )}

          {showResult && (
            <section className="card space-y-4 p-4" aria-label={textTitle} data-testid="ai-result">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold">{textTitle}</h2>
                {busy && <span className="flex items-center gap-2 text-xs text-ink-500" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Working…</span>}
              </div>
              {stream.progress && busy && <ProgressBar value={stream.progress.total ? stream.progress.done / stream.progress.total : 0} label={`Reading sections ${stream.progress.done}/${stream.progress.total}`} />}
              {stream.notices.map((n) => <Notice key={n} kind="info">{n}</Notice>)}
              {renderExtra?.(stream, { onCitation })}
              {stream.text && (
                <div data-testid="ai-text">
                  <Markdown text={stream.text} onCitation={onCitation} validPage={validPage} />
                </div>
              )}
              <ErrorNotice error={stream.error} />
              {stream.status === 'done' && (
                <div className="flex flex-wrap items-center gap-3 border-t border-ink-200 pt-4 dark:border-ink-800">
                  {stream.documents.map((d) => <DocButton key={d.id} doc={d} onPreview={previewDoc} />)}
                  {stream.text && <TextDownload text={stream.text} name={downloadName} />}
                  <button type="button" className="btn-secondary" onClick={() => setStream(initialStream)} data-testid="edit-again"><Pencil className="h-4 w-4" aria-hidden="true" /> Edit again</button>
                  <button type="button" className="btn-ghost" onClick={() => { fileIds.forEach(removeFile); setFileIds([]); setStream(initialStream) }}><Plus className="h-4 w-4" aria-hidden="true" /> Start over</button>
                </div>
              )}
              {stream.status === 'done' && stream.citations.length > 0 && (
                <p className="text-xs text-ink-500" data-testid="citations">Pages used: {[...new Set(stream.citations.map((c) => `${c.label ? c.label + ' ' : ''}p. ${c.page}`))].join(', ')}</p>
              )}
            </section>
          )}

          {stream.status === 'done' && related.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">Related tools</h3>
              <ul className="grid gap-3 sm:grid-cols-2">
                {related.map((r) => (
                  <li key={r.id}>
                    <Link to={r.route} state={{ fileIds }} className="card flex items-center gap-3 p-3 hover:border-brand-400">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200"><ToolIcon name={r.icon} /></span>
                      <span className="text-sm font-semibold">{r.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {viewFile && (
          <section aria-label="Document" className="lg:sticky lg:top-20 lg:self-start">
            <PdfViewer
              ref={viewer}
              key={viewFile.id}
              fileId={viewFile.id}
              height="75vh"
              hideRotate
              showThumbnails={false}
              onDocument={() => {
                if (pending.current != null) {
                  const p = pending.current
                  pending.current = null
                  setTimeout(() => viewer.current?.scrollToPage(p), 200)
                }
              }}
            />
          </section>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────── Summarize
export const SummarizeTool: ToolPage = ({ tool }) => {
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium')
  const [language, setLanguage] = useState('')
  const [pages, setPages] = useState('')
  return (
    <AiWorkspace
      tool={tool}
      path="/ai/summarize"
      runLabel="Summarize"
      textTitle="Summary"
      downloadName="summary.txt"
      options={() => (
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="Length" value={length} onChange={setLength} options={[{ value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }, { value: 'long', label: 'Long' }]} />
          <TextField label="Language (optional)" value={language} onChange={setLanguage} placeholder="e.g. German" hint="Default: the document's language" />
          <TextField label="Pages (optional)" value={pages} onChange={setPages} hint="e.g. 1-5" />
        </div>
      )}
      canRun={/^[A-Za-z][A-Za-z \-()]{1,59}$|^$/.test(language.trim()) && /^[0-9,\-\s]*$/.test(pages)}
      buildBody={(d) => ({ document_id: d[0].id, length, pages: pages.trim() || undefined, language: language.trim() || undefined })}
    />
  )
}

// ───────────────────────────────────────────────────────────── Ask
export const AskTool: ToolPage = ({ tool }) => {
  const [question, setQuestion] = useState('')
  return (
    <AiWorkspace
      tool={tool}
      maxFiles={5}
      path="/ai/ask"
      runLabel="Ask"
      textTitle="Answer"
      downloadName="answer.txt"
      canRun={question.trim().length > 0}
      options={() => (
        <Field label="Your question">
          <textarea className="input min-h-20" value={question} onChange={(e) => setQuestion(e.target.value)} data-testid="ask-question" aria-label="Your question" placeholder="What does the contract say about termination?" />
        </Field>
      )}
      buildBody={(d) => ({ document_ids: d.map((x) => x.id), question: question.trim() })}
    />
  )
}

// ───────────────────────────────────────────────────────────── Explain
export const ExplainTool: ToolPage = ({ tool }) => {
  const [page, setPage] = useState('')
  const [selection, setSelection] = useState('')
  const [question, setQuestion] = useState('')
  const [language, setLanguage] = useState('')
  const pn = Number(page)
  const pageOk = page.trim() === '' || (Number.isInteger(pn) && pn >= 1)
  return (
    <AiWorkspace
      tool={tool}
      path="/ai/explain"
      runLabel="Explain"
      textTitle="Explanation"
      downloadName="explanation.txt"
      canRun={pageOk && (page.trim() !== '' || selection.trim() !== '')}
      options={() => (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Page to explain" type="number" min={1} value={page} onChange={setPage} error={pageOk ? null : 'Enter a page number'} testId="explain-page" />
            <TextField label="Language (optional)" value={language} onChange={setLanguage} placeholder="e.g. Spanish" />
          </div>
          <Field label="…or paste the passage you do not understand" hint="Use a page number, a passage, or both.">
            <textarea className="input min-h-20" value={selection} onChange={(e) => setSelection(e.target.value)} aria-label="Passage" data-testid="explain-selection" />
          </Field>
          <TextField label="Specific question (optional)" value={question} onChange={setQuestion} />
        </div>
      )}
      buildBody={(d) => ({ document_id: d[0].id, page: page.trim() ? pn : undefined, selection: selection.trim() || undefined, question: question.trim() || undefined, language: language.trim() || undefined })}
    />
  )
}

// ───────────────────────────────────────────────────────────── Translate
const LANGS = ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Hindi', 'Arabic', 'Chinese', 'Japanese', 'Korean', 'Russian', 'Turkish']

export const TranslateTool: ToolPage = ({ tool }) => {
  const [lang, setLang] = useState('Spanish')
  const [pages, setPages] = useState('')
  const [create, setCreate] = useState<'none' | 'docx' | 'txt'>('docx')
  const langOk = /^[A-Za-z][A-Za-z \-()]{1,59}$/.test(lang.trim())
  return (
    <AiWorkspace
      tool={tool}
      path="/ai/translate"
      runLabel="Translate"
      textTitle="Translation"
      downloadName="translation.txt"
      canRun={langOk && /^[0-9,\-\s]*$/.test(pages)}
      options={() => (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Translate into" error={langOk ? null : 'Enter a language name'}>
            <input className="input" list="langs" value={lang} onChange={(e) => setLang(e.target.value)} data-testid="translate-lang" aria-label="Translate into" />
            <datalist id="langs">{LANGS.map((l) => <option key={l} value={l} />)}</datalist>
          </Field>
          <TextField label="Pages (optional, max 100)" value={pages} onChange={setPages} hint="e.g. 1-5" />
          <SelectField label="Also create a file" value={create} onChange={setCreate} options={[{ value: 'docx', label: 'Word (.docx)' }, { value: 'txt', label: 'Text (.txt)' }, { value: 'none', label: 'No file' }]} />
        </div>
      )}
      buildBody={(d) => ({ document_id: d[0].id, target_language: lang.trim(), pages: pages.trim() || undefined, create_document: create })}
    />
  )
}

// ───────────────────────────────────────────────────────────── Generate questions
type QKind = 'mcq' | 'short' | 'long' | 'truefalse' | 'mixed'

export const GenerateQuestionsTool: ToolPage = ({ tool }) => {
  const [kind, setKind] = useState<QKind>('mcq')
  const [count, setCount] = useState('10')
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [withAnswers, setWithAnswers] = useState(true)
  const [pages, setPages] = useState('')
  const [language, setLanguage] = useState('')
  const [create, setCreate] = useState<'none' | 'docx' | 'txt'>('docx')
  const n = Number(count)
  const countOk = Number.isInteger(n) && n >= 1 && n <= 50
  return (
    <AiWorkspace
      tool={tool}
      path="/ai/questions"
      runLabel="Generate questions"
      textTitle="Questions"
      downloadName="questions.txt"
      canRun={countOk && /^[0-9,\-\s]*$/.test(pages) && /^[A-Za-z][A-Za-z \-()]{1,59}$|^$/.test(language.trim())}
      options={() => (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField label="Type of question" value={kind} onChange={setKind} options={[
              { value: 'mcq', label: 'Multiple choice' }, { value: 'short', label: 'Short answer' }, { value: 'long', label: 'Long answer' },
              { value: 'truefalse', label: 'True or false' }, { value: 'mixed', label: 'A mix' },
            ]} />
            <TextField label="How many (1 to 50)" type="number" min={1} max={50} value={count} onChange={setCount} error={countOk ? null : 'Enter a number from 1 to 50'} testId="questions-count" />
            <SelectField label="Difficulty" value={difficulty} onChange={setDifficulty} options={[{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="Pages (optional)" value={pages} onChange={setPages} hint="e.g. 1-5" />
            <TextField label="Language (optional)" value={language} onChange={setLanguage} placeholder="e.g. Hindi" hint="Default: the document's language" />
            <SelectField label="Also create a file" value={create} onChange={setCreate} options={[{ value: 'docx', label: 'Word (.docx)' }, { value: 'txt', label: 'Text (.txt)' }, { value: 'none', label: 'No file' }]} />
          </div>
          <Checkbox label="Include the answers" checked={withAnswers} onChange={setWithAnswers} hint="Turn this off for a practice sheet without answers." />
        </div>
      )}
      buildBody={(d) => ({ document_id: d[0].id, kind, count: n, difficulty, with_answers: withAnswers, pages: pages.trim() || undefined, language: language.trim() || undefined, create_document: create })}
    />
  )
}

// ───────────────────────────────────────────────────────────── Compare
function DiffView({ diff }: { diff: DiffPayload }) {
  const label = (p: number[]) => (p.length ? `p. ${p.length > 1 ? `${p[0]}–${p[p.length - 1]}` : p[0]}` : '—')
  return (
    <div className="space-y-3" data-testid="diff-view">
      <p className="text-sm" data-testid="diff-summary">
        {diff.identical ? (
          <strong>The two documents have identical text.</strong>
        ) : (
          <>
            <strong>{diff.summary.total_changes} change{diff.summary.total_changes === 1 ? '' : 's'}</strong> · {diff.summary.added_lines} added · {diff.summary.removed_lines} removed · {diff.summary.changed_blocks} changed · similarity {(diff.similarity * 100).toFixed(1)}% · {diff.pages_a} vs {diff.pages_b} pages
          </>
        )}
      </p>
      {diff.truncated && <Notice kind="info">Only the first changes are shown.</Notice>}
      <ul className="space-y-2">
        {diff.changes.map((c, i) => (
          <li key={i} className="overflow-hidden rounded-xl border border-ink-200 text-xs dark:border-ink-700" data-testid="diff-change" data-type={c.type}>
            <div className="flex justify-between bg-ink-50 px-3 py-1 font-semibold dark:bg-ink-800">
              <span className="capitalize">{c.type}</span>
              <span>A {label(c.a_pages)} · B {label(c.b_pages)}</span>
            </div>
            <div className="grid sm:grid-cols-2">
              <pre className={`whitespace-pre-wrap p-3 font-sans ${c.a_text ? 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100' : ''}`}>{c.a_text || ''}</pre>
              <pre className={`whitespace-pre-wrap p-3 font-sans ${c.b_text ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100' : ''}`}>{c.b_text || ''}</pre>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const CompareTool: ToolPage = ({ tool }) => {
  const [narrative, setNarrative] = useState(true)
  return (
    <AiWorkspace
      tool={tool}
      maxFiles={2}
      minFiles={2}
      uploadTitle="Choose two PDFs to compare"
      path="/ai/compare"
      runLabel="Compare documents"
      textTitle="Differences"
      downloadName="comparison.txt"
      needsKey={() => narrative}
      options={({ status }) => (
        <div className="space-y-2">
          <p className="text-sm text-ink-600 dark:text-ink-300">The first file is <strong>D1</strong> (before), the second is <strong>D2</strong> (after). The line-by-line comparison is computed on the server and needs no AI.</p>
          <Checkbox label="Also write a short summary of the differences with AI" checked={narrative} onChange={setNarrative} hint={status && !status.configured ? 'Turn this off: the server has no AI key, but the comparison itself works without it.' : 'Sends the changed text to the AI provider.'} />
        </div>
      )}
      buildBody={(d) => ({ document_id_a: d[0].id, document_id_b: d[1].id, narrative })}
      renderExtra={(s) => (s.diff ? <DiffView diff={s.diff} /> : null)}
    />
  )
}
