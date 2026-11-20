import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  FileText,
  Pencil,
  RotateCcw,
  Trash2,
  Loader2,
  X,
  Plus,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { ToolIcon } from './ToolIcon'
import { Dropzone } from './Dropzone'
import { Notice } from './Notice'
import { ProgressBar } from './ProgressBar'
import { PageThumb } from './PageThumb'
import { PdfViewer } from './PdfViewer'
import { usePdfDoc } from '@/hooks/usePdfDoc'
import { useStoredFiles } from '@/hooks/useStoredFiles'
import { addBytes, addFile, formatBytes, hasFile, removeFile, FileValidationError, type StoredFileMeta } from '@/lib/fileStore'
import { downloadBytes } from '@/lib/download'
import { toolById, type ToolMeta } from '@/lib/tools'
import { zipFiles } from '@/lib/pdfOps/zip'
import { friendlyMessage } from '@/lib/apiClient'
import { useCapabilities } from '@/hooks/useCapabilities'
import { useServerGate } from './ServerGate'
import type { ProgressFn } from '@/lib/pdfOps/common'

/**
 * ONE flow for every tool:  upload → options → processing → result.
 *
 * A tool page renders <ToolShell tool=… options={…} run={…} /> and keeps its own option state.
 * Server tools use the exact same shell; they only differ in `tool.runsIn === 'server'`, which makes the
 * shell show the "this file is uploaded to the server" notice.
 */
export interface ToolOutput {
  name: string
  bytes: Uint8Array
  mime: string
  id?: string
}

export interface RunResult {
  outputs: ToolOutput[]
  /** Optional messages shown on the result page (warnings, details). */
  notes?: string[]
  /** Neutral facts shown on the result page (e.g. "Before 6.6 MB → after 0.1 MB"). */
  infos?: string[]
}

export interface RunContext {
  /** Input files in the order shown to the user. Read bytes with getBytes(file.id) — always a fresh copy. */
  files: StoredFileMeta[]
  progress: ProgressFn
  signal: AbortSignal
}

export interface AcceptSpec {
  /** lowercase extensions without dot, e.g. ['docx','doc'] */
  extensions: string[]
  label: string
}

export interface ToolShellProps {
  tool: ToolMeta
  multiple?: boolean
  /** minimum number of files before the tool can run (default 1) */
  minFiles?: number
  /** 'pdf' (default; validated by %PDF magic bytes) or a custom extension list for non-PDF inputs */
  accept?: 'pdf' | AcceptSpec
  /** Options UI for step 2. */
  options?: (ctx: { files: StoredFileMeta[] }) => ReactNode
  /** Extra validity gate for the Run button (e.g. a valid range typed). */
  canRun?: boolean
  runLabel?: string
  run: (ctx: RunContext) => Promise<RunResult | ToolOutput | ToolOutput[]>
  /** Called whenever the set/order of input files changes — use it to reset option state. */
  onFilesChange?: (files: StoredFileMeta[]) => void
  /** Heading shown above the dropzone (default: "Choose a PDF"). */
  uploadTitle?: string
  /** Multi-file tools: a line under "Files (n)" when there are 2 or more files (e.g. why the order matters). */
  filesHint?: ReactNode
  /** Multi-file tools: extra text under each file's name and size (e.g. the numbers that file gets). */
  fileNote?: (file: StoredFileMeta, index: number) => ReactNode
}

type Phase = 'edit' | 'processing' | 'result'

interface ResultState {
  outputs: ToolOutput[]
  notes: string[]
  infos?: string[]
  resultIds: string[]
  inputSize: number
}

function normalize(r: RunResult | ToolOutput | ToolOutput[]): RunResult {
  if (Array.isArray(r)) return { outputs: r }
  if ('outputs' in r) return r
  return { outputs: [r] }
}

function FileRow({ file, index, count, multiple, onMove, onRemove, drag, previewing, onPreview, lockedOk = false, onBlocked, tooLarge = null, note }: {
  /** extra line supplied by the tool */
  note?: ReactNode
  /** true on tools whose job is to open locked files (Unlock PDF): no "unlock it first" warning there */
  lockedOk?: boolean
  /** reports whether this file can be used by the tool (false = locked or unreadable) */
  onBlocked: (id: string, blocked: boolean) => void
  /** message when the file is over the server's upload limit (server tools only) */
  tooLarge?: string | null
  previewing: boolean
  onPreview: () => void
  file: StoredFileMeta
  index: number
  count: number
  multiple: boolean
  onMove: (from: number, to: number) => void
  onRemove: () => void
  drag: { from: number | null; setFrom: (n: number | null) => void }
}) {
  const { doc, numPages, error: readError } = usePdfDoc(file.kind === 'pdf' ? file.id : undefined)
  const locked = !!readError && /password/i.test(readError)
  // only a password lock blocks the run: an unreadable file may still be recovered (Repair) or read by the server
  const blocked = locked && !lockedOk
  useEffect(() => {
    onBlocked(file.id, blocked)
  }, [file.id, blocked, onBlocked])
  return (
    <li
      draggable={multiple && count > 1}
      onDragStart={() => drag.setFrom(index)}
      onDragOver={(e) => drag.from !== null && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (drag.from !== null) onMove(drag.from, index)
        drag.setFrom(null)
      }}
      onDragEnd={() => drag.setFrom(null)}
      data-testid="file-row"
      className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white p-2.5 dark:border-ink-800 dark:bg-ink-900"
    >
      <div className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-ink-100 dark:bg-ink-800">
        {doc ? <PageThumb doc={doc} pageNumber={1} width={44} /> : <FileText className="h-6 w-6 text-ink-400" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={file.name}>
          {multiple && <span className="mr-2 text-ink-400">{index + 1}.</span>}
          {file.name}
        </p>
        <p className="text-xs text-ink-500 dark:text-ink-400">
          {formatBytes(file.size)}
          {file.kind === 'pdf' && numPages > 0 && ` · ${numPages} page${numPages === 1 ? '' : 's'}`}
          {locked && lockedOk && ' · password-protected'}
        </p>
        {note && (
          <p className="mt-0.5 text-xs text-brand-700 dark:text-brand-300" data-testid="file-note">
            {note}
          </p>
        )}
        {tooLarge && (
          <p className="mt-0.5 text-xs font-medium text-red-700 dark:text-red-300" role="alert" data-testid="file-too-large">
            {tooLarge}
          </p>
        )}
        {readError && !(locked && lockedOk) && (
          <p className="mt-0.5 text-xs font-medium text-red-700 dark:text-red-300" role="alert" data-testid="file-read-error">
            {locked ? 'This PDF is password-protected. Unlock it first with the Unlock PDF tool.' : `This PDF could not be read (${readError}). Try the Repair PDF tool.`}
          </p>
        )}
      </div>
      {multiple && count > 1 && (
        <div className="flex">
          <button type="button" className="btn-ghost btn-sm !px-2" onClick={() => onMove(index, index - 1)} disabled={index === 0} aria-label={`Move ${file.name} up`}>
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className="btn-ghost btn-sm !px-2" onClick={() => onMove(index, index + 1)} disabled={index === count - 1} aria-label={`Move ${file.name} down`}>
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {file.kind === 'pdf' && (
        <button type="button" className="btn-ghost btn-sm" onClick={onPreview} aria-pressed={previewing} aria-label={`${previewing ? 'Hide preview of' : 'Preview'} ${file.name}`}>
          <Eye className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">{previewing ? 'Hide' : 'Preview'}</span>
        </button>
      )}
      <button type="button" className="btn-ghost btn-sm !px-2" onClick={onRemove} aria-label={`Remove ${file.name}`}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  )
}

const STEPS = ['Upload', 'Options', 'Process', 'Preview & Download']

export function ToolShell({ tool, multiple = false, minFiles = 1, accept = 'pdf', options, canRun = true, runLabel, run, onFilesChange, uploadTitle, filesHint, fileNote }: ToolShellProps) {
  const location = useLocation()
  const [fileIds, setFileIds] = useState<string[]>(() => {
    const ids = ((location.state as { fileIds?: string[] } | null)?.fileIds ?? []).filter(hasFile)
    return multiple ? ids : ids.slice(0, 1)
  })
  const files = useStoredFiles(fileIds)
  const [phase, setPhase] = useState<Phase>('edit')
  const [progress, setProgress] = useState({ value: 0, label: 'Starting' })
  const [error, setError] = useState<string | null>(null)
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [result, setResult] = useState<ResultState | null>(null)
  const abort = useRef<AbortController | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [busyAdding, setBusyAdding] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [blockedIds, setBlockedIds] = useState<ReadonlySet<string>>(new Set())
  const onBlocked = useCallback((id: string, blocked: boolean) => {
    setBlockedIds((prev) => {
      if (prev.has(id) === blocked) return prev
      const next = new Set(prev)
      if (blocked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  // notify the tool when files change (not on every render)
  const key = files.map((f) => f.id).join('|')
  const lastKey = useRef<string | null>(null)
  useEffect(() => {
    if (lastKey.current === key) return
    lastKey.current = key
    onFilesChange?.(files)
  })

  const acceptAttr = accept === 'pdf' ? 'application/pdf,.pdf' : accept.extensions.map((e) => `.${e}`).join(',')
  const acceptLabel = accept === 'pdf' ? 'PDF' : accept.label

  const handleFiles = useCallback(
    async (list: File[]) => {
      setBusyAdding(true)
      const errs: string[] = []
      const added: string[] = []
      for (const f of multiple ? list : list.slice(0, 1)) {
        try {
          if (accept === 'pdf') {
            added.push((await addFile(f)).id)
          } else {
            const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
            if (!accept.extensions.includes(ext)) throw new FileValidationError(`"${f.name}" is not a supported ${accept.label} file.`)
            added.push((await addFile(f, { pdf: false })).id)
          }
        } catch (e) {
          errs.push(e instanceof Error ? e.message : String(e))
        }
      }
      setUploadErrors(errs)
      if (added.length) {
        setFileIds((prev) => {
          if (!multiple) {
            prev.forEach(removeFile)
            return added.slice(0, 1)
          }
          return [...prev, ...added]
        })
        setError(null)
      }
      setBusyAdding(false)
    },
    [accept, multiple],
  )

  const moveFile = (from: number, to: number) => {
    setFileIds((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev
      const next = [...prev]
      const [x] = next.splice(from, 1)
      next.splice(to, 0, x)
      return next
    })
  }

  const clearResult = useCallback((r: typeof result) => {
    r?.resultIds.forEach(removeFile)
  }, [])

  const reset = () => {
    clearResult(result)
    setResult(null)
    setError(null)
    setPhase('edit')
  }

  const start = async () => {
    setError(null)
    clearResult(result)
    setResult(null)
    setProgress({ value: 0, label: 'Starting' })
    setPhase('processing')
    const ac = new AbortController()
    abort.current = ac
    const t0 = performance.now()
    try {
      const res = normalize(
        await run({
          files,
          signal: ac.signal,
          progress: (value, label) => !ac.signal.aborted && setProgress((p) => ({ value, label: label ?? p.label })),
        }),
      )
      if (ac.signal.aborted) return
      if (!res.outputs.length) throw new Error('The tool did not produce any output.')
      // keep a min visible processing state so the progress UI is perceivable
      const wait = 350 - (performance.now() - t0)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      if (ac.signal.aborted) return
      setProgress({ value: 1, label: 'Done' })
      const resultIds: string[] = []
      const outputsWithIds: ToolOutput[] = res.outputs.map((o) => {
        if (o.mime === 'application/pdf') {
          const meta = addBytes(o.name, o.bytes)
          resultIds.push(meta.id)
          return { ...o, id: meta.id }
        }
        return o
      })
      setResult({ outputs: outputsWithIds, notes: res.notes ?? [], infos: res.infos ?? [], resultIds, inputSize: files.reduce((a, f) => a + f.size, 0) })
      setPhase('result')
    } catch (e) {
      if (ac.signal.aborted) return
      setError(friendlyMessage(e))
      setPhase('edit')
    }
  }

  const cancel = () => {
    abort.current?.abort()
    setPhase('edit')
  }

  useEffect(() => () => abort.current?.abort(), [])

  const stepIndex = phase === 'result' ? 3 : phase === 'processing' ? 2 : files.length > 0 ? 1 : 0
  const gate = useServerGate(tool)
  const { caps } = useCapabilities(tool.runsIn === 'server')
  // a password-protected file blocks the run (except on Unlock PDF); its row says why
  const unreadable = files.some((f) => blockedIds.has(f.id))
  // server tools: files over the server's upload limit are flagged before anything is sent
  const { caps: serverCaps } = useCapabilities(tool.runsIn === 'server')
  const tooLargeMessage = (f: StoredFileMeta): string | null => {
    const mb = tool.runsIn === 'server' ? serverCaps?.limits.max_upload_mb : undefined
    if (!mb || f.size <= mb * 1024 * 1024) return null
    return `This file is ${(f.size / 1024 / 1024).toFixed(1)} MB — larger than the server's ${mb} MB upload limit. Split it into smaller parts first (Split PDF runs in your browser).`
  }
  const oversize = files.some((f) => tooLargeMessage(f) !== null)
  const ready = files.length >= minFiles && canRun && !gate.blocked && !unreadable && !oversize
  const serverNotice = useMemo(
    () =>
      tool.runsIn === 'server' ? (
        <Notice kind="warn" title="This tool uploads your file to our server">
          The file is sent over the network to be processed on the Rooman PDF server and is deleted automatically
          {caps ? ` after ${caps.limits.file_ttl_minutes} minutes at the latest` : ' after a limited time'} (results are removed as soon as you have downloaded them). Use a browser-side tool if you need the file to stay on your device.
        </Notice>
      ) : (
        <Notice kind="privacy" title="Your files stay on this device">
          This tool runs entirely in your browser. Nothing is uploaded.
        </Notice>
      ),
    [tool.runsIn, caps],
  )

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
          <ToolIcon name={tool.icon} className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{tool.name}</h1>
          <p className="mt-1 text-ink-600 dark:text-ink-300">{tool.description}</p>
        </div>
      </div>

      <ol className="mb-6 flex flex-wrap gap-x-2 gap-y-1 text-xs font-medium" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === stepIndex ? 'step' : undefined} className={`flex items-center gap-2 rounded-full px-3 py-1 ${i === stepIndex ? 'bg-brand-600 text-white dark:bg-brand-400 dark:text-ink-950' : i < stepIndex ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400'}`}>
            <span className="tabular-nums">{i + 1}</span> {s}
          </li>
        ))}
      </ol>

      {phase === 'processing' && (
        <section className="card mx-auto max-w-xl p-8" aria-label="Processing">
          <div className="mb-5 flex items-center justify-center gap-2 text-lg font-semibold">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Processing…
          </div>
          <ProgressBar value={progress.value} label={progress.label} />
          <div className="mt-6 text-center">
            <button type="button" className="btn-secondary" onClick={cancel}>
              <X className="h-4 w-4" aria-hidden="true" /> Cancel
            </button>
          </div>
        </section>
      )}

      {phase === 'result' && result && <ResultPanel tool={tool} result={result} onEditAgain={reset} onStartOver={() => { reset(); setFileIds([]) }} />}

      {phase === 'edit' && (
        <div className="space-y-5">
          {serverNotice}
          {gate.node}
          {error && (
            <Notice kind="error" title="Something went wrong">
              <span data-testid="tool-error">{error}</span>
            </Notice>
          )}
          {uploadErrors.map((m) => (
            <Notice kind="error" key={m}>
              {m}
            </Notice>
          ))}

          {files.length === 0 ? (
            <Dropzone onFiles={handleFiles} multiple={multiple} accept={acceptAttr} disabled={busyAdding} title={uploadTitle ?? `Choose ${multiple ? `${acceptLabel} files` : `a ${acceptLabel} file`}`} hint={`Drag and drop, or browse. ${acceptLabel} files only.`} />
          ) : (
            <>
              <section aria-label="Your files" className="card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{multiple ? `Files (${files.length})` : 'File'}</h2>
                  {!multiple && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => { files.forEach((f) => removeFile(f.id)); setFileIds([]) }}>
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Choose another file
                    </button>
                  )}
                </div>
                {multiple && files.length > 1 && filesHint && (
                  <p className="-mt-1 mb-3 text-xs text-ink-600 dark:text-ink-300" data-testid="files-hint">
                    {filesHint}
                  </p>
                )}
                <ul className="space-y-2">
                  {files.map((f, i) => (
                    <FileRow key={f.id} file={f} index={i} count={files.length} multiple={multiple} onMove={moveFile} onRemove={() => { removeFile(f.id); setFileIds((p) => p.filter((x) => x !== f.id)) }} drag={{ from: dragFrom, setFrom: setDragFrom }} previewing={previewId === f.id} onPreview={() => setPreviewId((p) => (p === f.id ? null : f.id))} lockedOk={tool.id === 'unlock-pdf'} onBlocked={onBlocked} tooLarge={tooLargeMessage(f)} note={fileNote?.(f, i)} />
                  ))}
                </ul>
                {previewId && files.some((f) => f.id === previewId) && (
                  <div className="mt-3" data-testid="preview-panel">
                    <PdfViewer key={previewId} fileId={previewId} height="60vh" />
                  </div>
                )}
                {multiple && (
                  <div className="mt-3">
                    <Dropzone compact multiple accept={acceptAttr} onFiles={handleFiles} title={`Add more ${acceptLabel} files`} hint="or drop them here" disabled={busyAdding} />
                  </div>
                )}
                {multiple && files.length < minFiles && <p className="hint">Add at least {minFiles} files to continue.</p>}
              </section>

              {options && <section aria-label="Options" className="card p-5">{options({ files })}</section>}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button type="button" className="btn-primary !px-6 !py-3 text-base flex items-center gap-2" onClick={start} disabled={!ready} data-testid="run-button">
                  <Eye className="h-5 w-5" aria-hidden="true" />
                  {runLabel ?? tool.name}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ImagePreview({ output }: { output: ToolOutput }) {
  const [url, setUrl] = useState<string>('')
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const blob = new Blob([output.bytes.slice(0) as BlobPart], { type: output.mime })
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [output])

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-ink-200 bg-ink-50 p-4 dark:border-ink-800 dark:bg-ink-950">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setScale((s) => Math.max(0.25, s - 0.25))}
          aria-label="Zoom out image"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="font-mono text-xs text-ink-600 dark:text-ink-400">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setScale((s) => Math.min(3, s + 0.25))}
          aria-label="Zoom in image"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setScale(1)}>
          Reset
        </button>
      </div>
      <div className="max-h-[65vh] w-full overflow-auto rounded-lg border border-ink-200 bg-white p-2 shadow-sm dark:border-ink-800 dark:bg-ink-900">
        <img
          src={url}
          alt={output.name}
          style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
          className="mx-auto block max-w-full transition-transform duration-100"
        />
      </div>
    </div>
  )
}

function TextPreview({ output }: { output: ToolOutput }) {
  const [copied, setCopied] = useState(false)
  const text = useMemo(() => new TextDecoder().decode(output.bytes), [output.bytes])
  const lines = useMemo(() => text.split('\n'), [text])
  const wordCount = useMemo(() => (text.trim() ? text.trim().split(/\s+/).length : 0), [text])

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-950">
        <span>{lines.length} lines · {wordCount} words · {text.length} characters</span>
        <button type="button" className="btn-ghost btn-sm flex items-center gap-1.5" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied!' : 'Copy text'}
        </button>
      </div>
      <div className="max-h-[65vh] select-text overflow-auto p-4 font-mono text-xs leading-relaxed text-ink-800 dark:text-ink-200 whitespace-pre-wrap">
        {text || <span className="italic text-ink-400">No text content found.</span>}
      </div>
    </div>
  )
}

function OfficePreview({ output }: { output: ToolOutput }) {
  const isDocx = output.name.endsWith('.docx')
  const isXlsx = output.name.endsWith('.xlsx')
  const isPptx = output.name.endsWith('.pptx')
  const typeLabel = isDocx ? 'Microsoft Word document (.docx)' : isXlsx ? 'Microsoft Excel workbook (.xlsx)' : isPptx ? 'Microsoft PowerPoint presentation (.pptx)' : 'Converted document'

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-8 text-center shadow-sm dark:border-ink-800 dark:bg-ink-900">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
        <FileText className="h-8 w-8" />
      </div>
      <h3 className="mt-4 text-base font-bold">{output.name}</h3>
      <p className="mt-1 text-xs text-ink-500">{typeLabel} · {formatBytes(output.bytes.byteLength)}</p>
      <p className="mx-auto mt-3 max-w-md text-sm text-ink-600 dark:text-ink-300">
        Your converted document is ready for download. Open it in Microsoft Office, LibreOffice, or Google Workspace to view and edit tables, text, and layout.
      </p>
    </div>
  )
}

export function ResultPanel({ tool, result, onEditAgain, onStartOver }: { tool: ToolMeta; result: ResultState; onEditAgain: () => void; onStartOver: () => void }) {
  const { outputs, notes, resultIds, inputSize } = result
  const outSize = outputs.reduce((a, o) => a + o.bytes.byteLength, 0)
  const single = outputs.length === 1
  const related = tool.related.map(toolById).filter((t): t is ToolMeta => !!t && t.status === 'available')
  const carry = single && resultIds.length === 1 ? { fileIds: resultIds } : undefined
  const [downloadNote, setDownloadNote] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [selectedOutputIndex, setSelectedOutputIndex] = useState(0)

  const activeOutput = outputs[selectedOutputIndex] ?? outputs[0]

  const handleDownload = (name: string, bytes: Uint8Array, mime: string) => {
    try {
      downloadBytes(name, bytes, mime)
      setDownloadNote({ type: 'success', message: `Downloaded "${name}" successfully.` })
    } catch (e) {
      setDownloadNote({ type: 'error', message: `Download failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const downloadAll = () => {
    try {
      if (single) {
        handleDownload(outputs[0].name, outputs[0].bytes, outputs[0].mime)
      } else {
        const zipName = `${tool.id}-results.zip`
        const zipBytes = zipFiles(outputs.map((o) => ({ name: o.name, bytes: o.bytes })))
        handleDownload(zipName, zipBytes, 'application/zip')
      }
    } catch (e) {
      setDownloadNote({ type: 'error', message: `Download failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return (
    <section aria-label="Result" className="space-y-6" data-testid="result-panel">
      <div className="card p-6 sm:p-8">
        <h2 className="text-xl font-bold" data-testid="result-title">
          {single ? 'Your file is ready' : `${outputs.length} files are ready`}
        </h2>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-300" data-testid="result-summary">
          {single ? (
            <>
              {outputs[0].name} · {formatBytes(outSize)}
              {inputSize > 0 && <> (original {formatBytes(inputSize)})</>}
            </>
          ) : (
            <>
              {formatBytes(outSize)} in total
            </>
          )}
        </p>

        {downloadNote && (
          <div
            className={`mt-4 flex items-center justify-between rounded-xl border p-3 text-sm ${
              downloadNote.type === 'success'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
            }`}
            role="status"
            data-testid="download-notification"
          >
            <span className="flex items-center gap-2">
              {downloadNote.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
              )}
              {downloadNote.message}
            </span>
            <button
              type="button"
              className="btn-ghost btn-sm !p-1 text-ink-500 hover:text-ink-800 dark:hover:text-ink-100"
              onClick={() => setDownloadNote(null)}
              aria-label="Dismiss notice"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {result.infos?.map((n) => (
          <div key={n} className="mt-3" data-testid="result-info">
            <Notice kind="info">{n}</Notice>
          </div>
        ))}
        {notes.map((n) => (
          <div key={n} className="mt-3" data-testid="result-notice">
            <Notice kind="warn">{n}</Notice>
          </div>
        ))}

        {!single && (
          <ul className="mt-4 max-h-64 divide-y divide-ink-100 overflow-auto rounded-xl border border-ink-200 dark:divide-ink-800 dark:border-ink-800">
            {outputs.map((o) => (
              <li key={o.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate">{o.name}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-ink-500">{formatBytes(o.bytes.byteLength)}</span>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => handleDownload(o.name, o.bytes, o.mime)} aria-label={`Download ${o.name}`}>
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className="btn-primary !px-6 !py-3 text-base" onClick={downloadAll} data-testid="download-button">
            <Download className="h-5 w-5" aria-hidden="true" /> {single ? 'Download' : 'Download all (.zip)'}
          </button>
          <button type="button" className="btn-secondary !py-3" onClick={onEditAgain} data-testid="edit-again">
            <Pencil className="h-4 w-4" aria-hidden="true" /> Edit again
          </button>
          <button type="button" className="btn-ghost !py-3" onClick={onStartOver}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Start over
          </button>
        </div>
      </div>

      {/* Rendered Live Preview */}
      <div className="card p-5 sm:p-6 space-y-4" data-testid="result-preview">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-ink-200 pb-3 dark:border-ink-800">
          <div>
            <h3 className="text-base font-bold flex items-center gap-2">
              <Eye className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden="true" />
              Document Preview
            </h3>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              Page-by-page rendered output. Review all formatting and edits before downloading.
            </p>
          </div>
          {!single && (
            <div className="flex items-center gap-2">
              <label htmlFor="preview-select" className="text-xs font-medium text-ink-600 dark:text-ink-300 whitespace-nowrap">
                Previewing file:
              </label>
              <select
                id="preview-select"
                className="input !py-1 !text-xs !w-auto"
                value={selectedOutputIndex}
                onChange={(e) => setSelectedOutputIndex(Number(e.target.value))}
                aria-label="Select file to preview"
              >
                {outputs.map((o, idx) => (
                  <option key={o.name} value={idx}>
                    {idx + 1}. {o.name} ({formatBytes(o.bytes.byteLength)})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {activeOutput && (
          <div className="mt-2" data-testid="preview-content">
            {activeOutput.mime === 'application/pdf' && activeOutput.id ? (
              <div data-testid="result-pdf-viewer">
                <PdfViewer key={activeOutput.id} fileId={activeOutput.id} height="70vh" />
              </div>
            ) : activeOutput.mime.startsWith('image/') ? (
              <ImagePreview output={activeOutput} />
            ) : activeOutput.mime === 'text/plain' || activeOutput.name.endsWith('.txt') ? (
              <TextPreview output={activeOutput} />
            ) : (
              <OfficePreview output={activeOutput} />
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-ink-200 dark:border-ink-800">
          <p className="text-xs text-ink-500 dark:text-ink-400">
            Satisfied with the result? Download the file above or click <strong>Edit again</strong> to make changes.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={onEditAgain}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit again
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={downloadAll}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> {single ? 'Download file' : 'Download all'}
            </button>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
            {carry ? 'Continue with this file' : 'Related tools'}
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((r) => (
              <li key={r.id}>
                <Link to={r.route} state={carry} className="card flex h-full items-center gap-3 p-3 transition hover:border-brand-400 hover:shadow-md">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
                    <ToolIcon name={r.icon} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{r.name}</span>
                    <span className="block text-xs text-ink-500">{r.runsIn === 'server' ? 'Uploads to server' : 'In your browser'}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
