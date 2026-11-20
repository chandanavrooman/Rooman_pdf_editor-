import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Eye, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { PDFDocument } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Dropzone } from '@/components/Dropzone'
import { Notice } from '@/components/Notice'
import { ProgressBar } from '@/components/ProgressBar'
import { ResultPanel, type ToolOutput } from '@/components/ToolShell'
import { ToolIcon } from '@/components/ToolIcon'
import { PdfViewer, type OverlayInfo } from '@/components/PdfViewer'
import { useStoredFiles } from '@/hooks/useStoredFiles'
import { addBytes, addFile, getBytes, hasFile, removeFile, FileValidationError } from '@/lib/fileStore'
import { baseName } from '@/lib/download'
import type { ToolMeta } from '@/lib/tools'
import { EditorContext, type EditorCtx, type PendingAsset, type ToolId } from './EditorContext'
import { PageOverlay } from './PageOverlay'
import { PropertyBar } from './PropertyBar'
import { SignatureDialog, type SignatureResult } from './SignatureDialog'
import { Toolbar } from './Toolbar'
import { inspectForm, type DetectedField, type FormInfo } from './forms'
import { FillFormPanel } from './FillFormPanel'
import { moveObject } from './geometry'
import { DEFAULTS, cloneObjects, makeImage, type ToolDefaults } from './objects'
import { canRedo, canUndo, initialState, newId, reducer } from './state'
import { exportInBrowser } from './exportBrowser'
import { ExportError } from './export'
import { imageFileToAsset } from './signature'
import { liftImage, pageImageRects, type ImageRect } from './imageSnap'
import { pageTextBoxes, wordBoxes, type SnapItem } from './textSnap'
import { fontInfo } from './fontCatalog'
import { isCoverBox, overlappedText, overlapWarning } from './overlap'
import { normalizeUrl } from './urlNormalize'
import type { Asset, EditorObject } from './types'

export type EditorMode = 'edit' | 'fill' | 'sign'

const SUFFIX: Record<EditorMode, string> = { edit: 'edited', fill: 'filled', sign: 'signed' }
/** pdf.js AnnotationMode.ENABLE_FORMS: draw annotations but leave form widgets to our inputs */
const ENABLE_FORMS = 2

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

type Phase = 'upload' | 'edit' | 'exporting' | 'result'

export function EditorPage({ tool: meta, mode }: { tool: ToolMeta; mode: EditorMode }) {
  const location = useLocation()
  const [fileId, setFileId] = useState<string | null>(() => ((location.state as { fileIds?: string[] } | null)?.fileIds ?? []).find(hasFile) ?? null)
  const [phase, setPhase] = useState<Phase>(fileId ? 'edit' : 'upload')
  const files = useStoredFiles(fileId ? [fileId] : [])
  const file = files[0]
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const [tool, setToolRaw] = useState<ToolId>('text')
  const [defaults, setDefaultsState] = useState<ToolDefaults>(DEFAULTS)
  const [pendingAsset, setPendingAsset] = useState<PendingAsset | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sigOpen, setSigOpen] = useState(false)
  const [fields, setFields] = useState<DetectedField[]>([])
  const noForm: FormInfo = { fields: [], unsupported: [], xfa: false }
  const [formInfo, setFormInfo] = useState<FormInfo>(noForm)
  const [creating, setCreating] = useState(false) // the user chose "Create Fillable Form"
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ value: 0, label: 'Starting' })
  const [flatten, setFlatten] = useState(false)
  const [isScanned, setIsScanned] = useState(false)
  const [result, setResult] = useState<{ outputs: ToolOutput[]; notes: string[]; resultIds: string[]; inputSize: number } | null>(null)
  const assets = useRef<Record<string, Asset>>({})
  const urls = useRef<Record<string, string>>({})
  const pdfDoc = useRef<PDFDocumentProxy | null>(null)
  const currentPage = useRef(1) // the page being looked at (1-based); new images land on it
  const snapCache = useRef(new Map<number, Promise<SnapItem[]>>())
  const rawCache = useRef(new Map<number, Promise<SnapItem[]>>())
  const [debug, setDebug] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const clipboard = useRef<{ objs: EditorObject[]; n: number } | null>(null)
  const savedRevision = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const dirty = state.past.length > 0 && state.revision !== savedRevision.current
  const loaded = fileId && file

  const notify = useCallback((msg: string) => {
    setMessage(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setMessage(null), 6000)
  }, [])

  const warn = useCallback((msg: string) => setWarning(msg), [])

  const setTool = useCallback((t: ToolId) => {
    setToolRaw(t)
    setEditingId(null)
  }, [])
  const setDefaults = useCallback((fn: (d: ToolDefaults) => ToolDefaults) => setDefaultsState(fn), [])

  const addAsset = useCallback((bytes: Uint8Array, mime: Asset['mime']) => {
    const id = newId('a')
    assets.current[id] = { bytes: bytes.slice(0), mime }
    urls.current[id] = URL.createObjectURL(new Blob([bytes.slice(0)], { type: mime }))
    return id
  }, [])
  const assetUrl = useCallback((id: string) => urls.current[id], [])

  useEffect(() => {
    const u = urls.current
    return () => {
      Object.values(u).forEach((x) => URL.revokeObjectURL(x))
      clearTimeout(toastTimer.current)
    }
  }, [])

  // detect the PDF's existing form fields (own copy of the bytes)
  useEffect(() => {
    if (!fileId || !hasFile(fileId)) return
    let cancelled = false
    ;(async () => {
      try {
        const d = await PDFDocument.load(getBytes(fileId), { updateMetadata: false, throwOnInvalidObject: false })
        const info = inspectForm(d)
        if (!cancelled) {
          setFields(info.fields)
          setFormInfo(info)
        }
      } catch {
        if (!cancelled) {
          setFields([])
    setFormInfo({ fields: [], unsupported: [], xfa: false })
    setCreating(false)
          setFormInfo({ fields: [], unsupported: [], xfa: false })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fileId])

  // sign mode opens the signature dialog right after a file is chosen
  const sigAsked = useRef<string | null>(null)
  useEffect(() => {
    if (mode === 'sign' && fileId && phase === 'edit' && sigAsked.current !== fileId) {
      sigAsked.current = fileId
      setSigOpen(true)
    }
  }, [mode, fileId, phase])

  const onDocument = useCallback((d: PDFDocumentProxy) => {
    pdfDoc.current = d
    snapCache.current.clear()
    rawCache.current.clear()
    d.getPage(1)
      .then((p) => p.getTextContent())
      .then((tc) => {
        setIsScanned(tc.items.length === 0)
      })
      .catch(() => {})
  }, [])
  const snap = useCallback((pageIndex: number) => {
    let p = snapCache.current.get(pageIndex)
    if (!p) {
      p = pdfDoc.current ? pageTextBoxes(pdfDoc.current, pageIndex).catch(() => []) : Promise.resolve([])
      snapCache.current.set(pageIndex, p)
    }
    return p
  }, [])

  const tableCache = useRef(new Map<number, Promise<SnapItem[]>>())
  const tableItems = useCallback((pageIndex: number) => {
    let p = tableCache.current.get(pageIndex)
    if (!p) {
      p = pdfDoc.current ? pageTextBoxes(pdfDoc.current, pageIndex, { tables: true }).catch(() => []) : Promise.resolve([])
      tableCache.current.set(pageIndex, p)
    }
    return p
  }, [])

  const imageCache = useRef(new Map<number, Promise<ImageRect[]>>())
  const images = useCallback((pageIndex: number) => {
    let p = imageCache.current.get(pageIndex)
    if (!p) {
      p = pdfDoc.current ? pageImageRects(pdfDoc.current, pageIndex).catch(() => []) : Promise.resolve([])
      imageCache.current.set(pageIndex, p)
    }
    return p
  }, [])
  const liftPicture = useCallback(
    async (pageIndex: number, r: ImageRect, opts?: { backgroundOnly?: boolean }) => {
      if (!pdfDoc.current) return null
      const got = await liftImage(pdfDoc.current, pageIndex, r, opts).catch(() => null)
      if (!got) return null
      return { assetId: opts?.backgroundOnly ? '' : addAsset(got.bytes, 'image/png'), bg: got.bg }
    },
    [addAsset]
  )

  const rawItems = useCallback((pageIndex: number) => {
    let p = rawCache.current.get(pageIndex)
    if (!p) {
      p = pdfDoc.current ? pageTextBoxes(pdfDoc.current, pageIndex, { includeEmpty: true }).catch(() => []) : Promise.resolve([])
      rawCache.current.set(pageIndex, p)
    }
    return p
  }, [])

  /** development only: copy every extracted text item (PDF points, origin top-left) as JSON */
  const copyItemsAsJson = useCallback(async () => {
    const n = pdfDoc.current?.numPages ?? 0
    const items: unknown[] = []
    for (let i = 0; i < n; i++) {
      for (const it of await rawItems(i)) {
        const desc = fontInfo(it.fontId ?? 'liberation-sans').desc
        items.push({
          page: i + 1,
          str: it.str,
          x: it.origin?.x ?? it.box.x,
          top_box: it.box.y,
          top_pdfplumber_style: it.origin && it.fontSize ? it.origin.baseline - it.fontSize * (1 - desc) : undefined,
          baseline: it.origin?.baseline,
          width: it.origin?.w ?? it.box.w,
          height: it.box.h,
          fontName: it.rawFont,
          matchedFont: it.fontId,
          size: it.fontSize,
          bold: it.bold,
          italic: it.italic,
          color: it.color,
          colorSource: it.colorSource,
          bg: it.bg,
          blank: it.blank,
          words: wordBoxes(it),
        })
      }
    }
    const text = JSON.stringify({ units: 'PDF points, origin top-left, viewport scale 1', file: file?.name, items }, null, 2)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    notify(`Copied ${items.length} text items as JSON`)
  }, [rawItems, file, notify])

  // ───────── unsaved changes guard
  useEffect(() => {
    if (!dirty || phase !== 'edit') return
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const click = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.origin !== window.location.origin) return
      if (!window.confirm('You have unsaved edits. Leave the editor and lose them?')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', before)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', before)
      document.removeEventListener('click', click, true)
    }
  }, [dirty, phase])

  // ───────── keyboard
  useEffect(() => {
    if (phase !== 'edit') return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || sigOpen) return
      const mod = e.ctrlKey || e.metaKey
      const sel = state.present.objects.filter((o) => state.selection.includes(o.id))
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
        e.preventDefault()
        dispatch({ type: 'remove', ids: sel.map((o) => o.id) })
      } else if (e.key.startsWith('Arrow') && sel.length) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        dispatch({ type: 'update', ids: sel.map((o) => o.id), patch: (o) => moveObject(o, dx, dy), txn: `nudge:${sel.map((o) => o.id).join(',')}` })
      } else if (mod && e.key.toLowerCase() === 'a' && (tool === 'select' || tool === 'text') && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        dispatch({ type: 'select', ids: state.present.objects.map((o) => o.id) }) // select everything: then the Align buttons line the objects up
      } else if (mod && e.key.toLowerCase() === 'd' && sel.length) {
        e.preventDefault()
        dispatch({ type: 'add', objects: cloneObjects(sel, state.present.objects, 12, 12, fields.map((x) => x.name)) })
      } else if (mod && e.key.toLowerCase() === 'c' && sel.length) {
        clipboard.current = { objs: sel, n: 0 }
      } else if (mod && e.key.toLowerCase() === 'v' && clipboard.current) {
        e.preventDefault()
        const c = clipboard.current
        c.n += 1
        dispatch({ type: 'add', objects: cloneObjects(c.objs, state.present.objects, 12 * c.n, 12 * c.n, fields.map((x) => x.name)) })
      } else if (e.key === 'Escape') {
        if (tool !== 'select') setTool('select')
        else dispatch({ type: 'select', ids: [] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, state.present.objects, state.selection, sigOpen, tool, setTool, fields])

  const onImageFile = async (f: File) => {
    try {
      const a = await imageFileToAsset(f)
      const id = addAsset(a.bytes, a.mime)
      // place it straight away, centred on the page being looked at: selected, so it can be moved, resized, rotated or deleted at once
      const pageNo = Math.min(Math.max(1, currentPage.current), pdfDoc.current?.numPages ?? 1)
      const vp = (await pdfDoc.current?.getPage(pageNo))?.getViewport({ scale: 1 })
      const pw = vp?.width ?? 595
      const ph = vp?.height ?? 842
      const aspect = a.width / a.height
      let w = Math.min(Math.max(a.width * 0.75, 40), pw * 0.5)
      let h = w / aspect
      if (h > ph * 0.5) {
        h = ph * 0.5
        w = h * aspect
      }
      dispatch({ type: 'add', objects: [makeImage('image', pageNo - 1, { x: (pw - w) / 2, y: (ph - h) / 2, w, h }, id)] })
      setTool('select')
      notify('Image added. Drag to move it, the corners to resize, the round handle to rotate; opacity is in the bar above.')
    } catch {
      notify('That image could not be read. Use a PNG, JPG, SVG or WebP file.')
    }
  }

  const onSignature = (r: SignatureResult) => {
    const id = addAsset(r.bytes, r.mime)
    setPendingAsset({ id, kind: 'signature', aspect: r.width / r.height, width: 150 })
    setSigOpen(false)
    setTool('signature')
    notify('Click on the page where the signature should go.')
  }

  const chooseFile = async (list: File[]) => {
    setUploadError(null)
    try {
      const meta = await addFile(list[0])
      setFileId(meta.id)
      setPhase('edit')
    } catch (e) {
      setUploadError(e instanceof FileValidationError ? e.message : e instanceof Error ? e.message : String(e))
    }
  }

  const resetAll = () => {
    if (fileId) removeFile(fileId)
    result?.resultIds.forEach(removeFile)
    setResult(null)
    setFileId(null)
    setFields([])
    setIsScanned(false)
    dispatch({ type: 'reset' })
    savedRevision.current = 0
    setPhase('upload')
  }

  const chooseAnother = () => {
    if (dirty && !window.confirm('You have unsaved edits. Choose another file and lose them?')) return
    resetAll()
  }

  const fieldObjCount = state.present.objects.filter((o) => o.type === 'field').length

  /** Step to the next / previous fillable field (page order, then top to bottom), scroll it into view and put the cursor in it. */
  // remember the form field the cursor was last in (clicking the Next / Previous button moves the focus to the button itself)
  const lastField = useRef<string | null>(null)
  useEffect(() => {
    const on = (e: FocusEvent) => {
      const n = (e.target as HTMLElement | null)?.closest?.('[data-field]')?.getAttribute('data-field')
      if (n) lastField.current = n
    }
    document.addEventListener('focusin', on)
    return () => document.removeEventListener('focusin', on)
  }, [])
  const jumpToField = (delta: 1 | -1) => {
    const order = [...fields]
      .filter((f) => !f.readOnly)
      .sort((a, b) => (a.widgets[0]?.page ?? 0) - (b.widgets[0]?.page ?? 0) || (a.widgets[0]?.rect.y ?? 0) - (b.widgets[0]?.rect.y ?? 0) || (a.widgets[0]?.rect.x ?? 0) - (b.widgets[0]?.rect.x ?? 0))
    if (!order.length) return
    const at = lastField.current ? order.findIndex((f) => f.name === lastField.current) : -1
    const next = order[at < 0 ? (delta === 1 ? 0 : order.length - 1) : (at + delta + order.length) % order.length]
    const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(next.name)}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el?.focus({ preventScroll: true })
  }

  const doExport = async () => {
    if (!fileId) return
    setError(null)
    for (const o of state.present.objects) {
      if (o.type !== 'link' || o.target.kind !== 'url') continue
      const chk = normalizeUrl(o.target.url)
      if (!chk.ok) {
        dispatch({ type: 'select', ids: [o.id] })
        setError(`A link on page ${o.page + 1} cannot be exported: ${chk.error} Select the link and fix its address.`)
        return
      }
    }
    setEditingId(null)
    setPhase('exporting')
    setProgress({ value: 0, label: 'Starting' })
    try {
      const stats = { skippedDuplicateObjects: 0, removedDuplicateAnnotations: 0 }
      const bytes = await exportInBrowser(
        getBytes(fileId),
        { objects: state.present.objects, formValues: state.present.formValues, assets: assets.current },
        { flattenForm: flatten, stats, onProgress: (value, label) => setProgress({ value, label }) },
      )
      const name = `${baseName(file?.name ?? 'document')}-${SUFFIX[mode]}.pdf`
      const resultIds = [addBytes(name, bytes).id]
      const notes: string[] = []
      for (const o of state.present.objects) {
        if (!isCoverBox(o)) continue
        const hits = overlappedText({ x: o.x, y: o.y, w: o.w, h: o.h }, await snap(o.page))
        const w = overlapWarning(o, hits)
        if (w) notes.push(`Page ${o.page + 1}: ${w.replace(' Move or resize it, or click Undo.', '')}`)
      }
      if (stats.skippedDuplicateObjects || stats.removedDuplicateAnnotations) notes.push(`Duplicate annotations were left out: ${stats.skippedDuplicateObjects + stats.removedDuplicateAnnotations}.`)
      if (fieldObjCount > 0 || fields.length > 0) {
        const added = fieldObjCount ? `${fieldObjCount} field${fieldObjCount === 1 ? '' : 's'} you added ${fieldObjCount === 1 ? 'is' : 'are'} real form field${fieldObjCount === 1 ? '' : 's'}` : ''
        notes.push(
          flatten
            ? 'The form was flattened: everything typed in is now fixed text and the fields can no longer be edited.'
            : `This is still an interactive form${added ? ` (${added})` : ''}: open it in Acrobat, Chrome or Edge to fill it in. Tick "Flatten" before exporting for a non-editable copy.`,
        )
      }
      savedRevision.current = state.revision
      setResult({ outputs: [{ name, bytes, mime: 'application/pdf', id: resultIds[0] }], notes, resultIds, inputSize: file?.size ?? 0 })
      setPhase('result')
    } catch (e) {
      setError(e instanceof ExportError ? e.message : `Export failed: ${e instanceof Error ? e.message : String(e)}`)
      setPhase('edit')
    }
  }

  const ctx: EditorCtx = useMemo(
    () => ({ state, dispatch, tool, setTool, defaults, setDefaults, assetUrl, pendingAsset, setPendingAsset, fields, snap, tableItems, debug, rawItems, images, liftImage: liftPicture, addAsset, editingId, setEditingId, numPages: pdfDoc.current?.numPages ?? 0, notify, warn }),
    [state, tool, setTool, defaults, setDefaults, assetUrl, pendingAsset, fields, snap, tableItems, debug, rawItems, images, liftPicture, addAsset, editingId, notify, warn],
  )

  const renderOverlay = useCallback((info: OverlayInfo) => <PageOverlay info={info} />, [])

  const title = (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
        <ToolIcon name={meta.icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{meta.name}</h1>
        <p className="truncate text-sm text-ink-600 dark:text-ink-300">{loaded ? file.name : meta.description}</p>
      </div>
    </div>
  )

  if (phase === 'upload' || !loaded) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {title}
        <div className="space-y-5">
          <Notice kind="privacy" title="Your files stay on this device">
            The editor runs entirely in your browser. Nothing is uploaded.
          </Notice>
          {uploadError && <Notice kind="error">{uploadError}</Notice>}
          <Dropzone onFiles={chooseFile} title={mode === 'sign' ? 'Choose the PDF to sign' : mode === 'fill' ? 'Choose the form to fill' : 'Choose a PDF to edit'} hint="Drag and drop, or browse. PDF files only." />
        </div>
      </div>
    )
  }

  if (phase === 'exporting') {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {title}
        <section className="card mx-auto max-w-xl p-8" aria-label="Processing">
          <div className="mb-5 flex items-center justify-center gap-2 text-lg font-semibold">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Applying your edits…
          </div>
          <ProgressBar value={progress.value} label={progress.label} />
        </section>
      </div>
    )
  }

  if (phase === 'result' && result) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {title}
        <ResultPanel
          tool={meta}
          result={result}
          onEditAgain={() => {
            result.resultIds.forEach(removeFile)
            setResult(null)
            setPhase('edit')
          }}
          onStartOver={resetAll}
        />
      </div>
    )
  }

  return (
    <EditorContext.Provider value={ctx}>
      <div className="mx-auto max-w-[1700px] px-2 py-3 sm:px-4" data-testid="editor-root">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
            <ToolIcon name={meta.icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight tracking-tight">{meta.name}</h1>
            <p className="flex items-center gap-1.5 truncate text-xs text-ink-600 dark:text-ink-300">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
              <span className="truncate">{file.name} · stays on this device</span>
            </p>
          </div>
          {(fields.length > 0 || fieldObjCount > 0) && (
            <label className="flex items-center gap-1.5 text-xs text-ink-700 dark:text-ink-200" title="Turn the form into a normal, non-editable document: what is typed in becomes fixed text. Leave this off to keep an interactive, fillable PDF.">
              <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} data-testid="flatten-form" /> Flatten (make non-editable)
            </label>
          )}
          {import.meta.env.DEV && (
            <>
              <label className="flex items-center gap-1.5 text-xs text-ink-700 dark:text-ink-200" title="Development only: outline every text item pdf.js returns">
                <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} data-testid="debug-toggle" /> Debug text layer
              </label>
              {debug && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => void copyItemsAsJson()} data-testid="debug-copy">
                  Copy extracted items as JSON
                </button>
              )}
            </>
          )}
          <button type="button" className="btn-ghost btn-sm" onClick={chooseAnother}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Choose another file
          </button>
          <button
            type="button"
            className="btn-secondary flex items-center gap-1.5"
            onClick={() => void doExport()}
            data-testid="preview-button"
            title="Preview the rendered final document before downloading"
          >
            <Eye className="h-4 w-4" aria-hidden="true" /> Preview
          </button>
          <button type="button" className="btn-primary" onClick={() => void doExport()} data-testid="export-button">
            {mode === 'sign' ? 'Apply & download' : 'Export PDF'}
          </button>
        </div>

        {isScanned && (
          <div className="mb-3">
            <Notice kind="info" title="Scanned PDF detected">
              <span>
                This document does not contain an embedded text layer. You can freely add text, drawings, form fields, and signatures, or use the{' '}
                <a href="/ocr-pdf" className="font-semibold underline hover:text-brand-700 dark:hover:text-brand-300">
                  OCR (searchable PDF)
                </a>{' '}
                tool to make existing scanned text searchable and selectable.
              </span>
            </Notice>
          </div>
        )}

        {error && (
          <div className="mb-3">
            <Notice kind="error" title="Could not export">
              <span data-testid="editor-error">{error}</span>
            </Notice>
          </div>
        )}
        {mode === 'fill' && (
          <FillFormPanel
            info={formInfo}
            fields={fields}
            values={state.present.formValues}
            creating={creating}
            fieldCount={fieldObjCount}
            onCreate={() => {
              setCreating(true)
              setTool('field-text')
              notify('Drag on the page where the text field should go.')
            }}
            onChooseAnother={chooseAnother}
            onJump={jumpToField}
          />
        )}

        <div className="overflow-clip rounded-2xl border border-ink-200 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900">
          {/* tools + options stay pinned to the top of the window while the page scrolls (overflow-clip, unlike overflow-hidden, lets sticky work) */}
          <div className="sticky top-16 z-20 bg-white shadow-sm dark:bg-ink-900" data-testid="editor-sticky-bar">
          <Toolbar tool={tool} onTool={setTool} onImageFile={onImageFile} onSign={() => setSigOpen(true)} canUndo={canUndo(state)} canRedo={canRedo(state)} onUndo={() => dispatch({ type: 'undo' })} onRedo={() => dispatch({ type: 'redo' })} />
          <PropertyBar />
          {warning && (
            <div role="alert" data-testid="overlap-warning" className="flex flex-wrap items-center gap-2 border-b border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100">
              <span className="font-semibold">Warning:</span>
              <span className="min-w-0 flex-1">{warning}</span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { dispatch({ type: 'undo' }); setWarning(null) }}>
                Undo
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setWarning(null)} data-testid="overlap-warning-dismiss">
                Keep it
              </button>
            </div>
          )}
          </div>
          {/* the notification floats over the top of the page area: it must never push the page down (a double-click would then land on the wrong spot) */}
          <div aria-live="polite" className="pointer-events-none relative z-30 h-0">
            {message && (
              <p className="absolute inset-x-0 top-0 border-b border-amber-200 bg-amber-50/95 px-3 py-1.5 text-xs text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/90 dark:text-amber-100" data-testid="editor-message">
                {message}
              </p>
            )}
          </div>
          <PdfViewer key={fileId} fileId={fileId} minFitScale={1.4} height="max(480px, calc(100vh - 20rem))" className="!rounded-none !border-0 !shadow-none" renderOverlay={renderOverlay} annotationMode={ENABLE_FORMS} hideRotate onDocument={onDocument} onPageChange={(n) => (currentPage.current = n)} />
          {/* as in Sejda: once something was changed, a button floats at the bottom to finish */}
          {dirty && (
            <div className="pointer-events-none sticky bottom-4 z-30 flex justify-center">
              <button type="button" className="btn-primary pointer-events-auto !px-6 !py-3 text-base shadow-lg" onClick={() => void doExport()} data-testid="apply-changes">
                Apply changes <span aria-hidden="true">›</span>
              </button>
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
          Click any text to edit it right where it is. Your original layout and fonts are kept; press Apply changes when you are done.
        </p>
      </div>
      {sigOpen && <SignatureDialog onCancel={() => setSigOpen(false)} onDone={onSignature} />}
    </EditorContext.Provider>
  )
}
