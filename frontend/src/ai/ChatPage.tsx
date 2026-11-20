import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Bot, Check, Download, Eye, FileText, Loader2, Send, ShieldQuestion, Square, User, Wrench, X, AlertTriangle } from 'lucide-react'
import { Dropzone } from '@/components/Dropzone'
import { Notice } from '@/components/Notice'
import { PdfViewer, type PdfViewerHandle } from '@/components/PdfViewer'
import { ToolIcon } from '@/components/ToolIcon'
import { ProgressBar } from '@/components/ProgressBar'
import { addBytes, addFile, formatBytes, getMeta, removeFile } from '@/lib/fileStore'
import { downloadDocumentBytes, friendlyMessage, type DocumentInfo } from '@/lib/apiClient'
import { downloadBytes } from '@/lib/download'
import { streamSse } from '@/lib/sse'
import { useAuth } from '@/lib/auth'
import type { ToolPage } from '@/tools/shared/types'
import { Markdown, type CitationClick } from './Markdown'
import { AiKeyBanner, ErrorNotice, PrivacyNotice, SignInGate, toStreamError, useAiStatus, useServerDoc } from './shared'
import { applyChatEvent, newAssistant, type AssistantMessage, type ChatMessage, type ToolCard } from './chatState'

const SUGGESTIONS = ['Summarize this document in five bullet points.', 'What are the key dates and numbers? Cite the pages.', 'Extract pages 1-3, then compress it.']

function DocDownload({ doc, onPreview }: { doc: DocumentInfo; onPreview?: (doc: DocumentInfo) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-1.5">
      {onPreview && doc.mime === 'application/pdf' && (
        <button
          type="button"
          className="btn-ghost btn-sm border border-ink-200 dark:border-ink-700 flex items-center gap-1"
          title={`Preview ${doc.filename}`}
          onClick={() => onPreview(doc)}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Preview
        </button>
      )}
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={busy}
        data-testid="chat-download"
        onClick={async () => {
          setBusy(true)
          setErr(null)
          try {
            downloadBytes(doc.filename, await downloadDocumentBytes(doc), doc.mime)
          } catch (e) {
            setErr(friendlyMessage(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" /> {doc.filename} <span className="text-ink-500">({formatBytes(doc.size)}{doc.pages ? `, ${doc.pages} p.` : ''})</span>
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  )
}

function ToolCardView({ card, onPreview }: { card: ToolCard; onPreview?: (doc: DocumentInfo) => void }) {
  const tone =
    card.status === 'ok' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40' : card.status === 'running' ? 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40' : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${tone}`} data-testid="tool-card" data-tool={card.name} data-status={card.status}>
      <div className="flex items-center gap-2 font-semibold">
        {card.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : card.status === 'ok' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
        <Wrench className="h-3.5 w-3.5" aria-hidden="true" /> {card.name}
        <span className="font-normal text-ink-600 dark:text-ink-300">
          {card.status === 'running' ? 'running…' : card.status === 'ok' ? 'done' : card.status === 'declined' ? 'declined by you' : 'failed'}
        </span>
      </div>
      <p className="mt-1 break-all font-mono text-[11px] text-ink-600 dark:text-ink-300">{JSON.stringify(card.args)}</p>
      {card.message && card.status !== 'ok' && <p className="mt-1">{card.message}</p>}
      {card.notice && <p className="mt-1 text-amber-800 dark:text-amber-200">{card.notice}</p>}
      {card.checks.length > 0 && <p className="mt-1 text-ink-600 dark:text-ink-300">Verified: {card.checks.join(' · ')}</p>}
      {card.documents.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {card.documents.map((d) => <DocDownload key={d.id} doc={d} onPreview={onPreview} />)}
        </div>
      )}
    </div>
  )
}

export function AssistantBubble({ m, onCitation, onConfirm, onPreview, validPage }: { m: AssistantMessage; onCitation: (c: CitationClick) => void; onConfirm: (approve: boolean) => void; onPreview?: (doc: DocumentInfo) => void; validPage: (c: CitationClick) => boolean }) {
  const doneDocs = m.documents.filter((d) => !m.tools.some((t) => t.documents.some((x) => x.id === d.id)))
  return (
    <div className="flex gap-3" data-testid="assistant-message">
      <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white dark:bg-brand-400 dark:text-ink-950"><Bot className="h-4 w-4" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1 space-y-2">
        {m.tools.map((t) => <ToolCardView key={t.id} card={t} onPreview={onPreview} />)}
        {m.confirmation && (
          <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-600 dark:bg-amber-950/40" role="alertdialog" aria-label="Confirm action" data-testid="confirmation">
            <p className="flex items-center gap-2 font-semibold"><ShieldQuestion className="h-4 w-4" aria-hidden="true" /> Confirm this action</p>
            <p className="mt-1" data-testid="confirmation-message">{m.confirmation.message}</p>
            <p className="mt-1 break-all font-mono text-[11px] text-ink-600 dark:text-ink-300">{m.confirmation.tool}({JSON.stringify(m.confirmation.arguments)})</p>
            {m.confirmation.state === 'pending' ? (
              <div className="mt-2 flex gap-2">
                <button type="button" className="btn-primary btn-sm" onClick={() => onConfirm(true)} data-testid="confirm-approve"><Check className="h-4 w-4" aria-hidden="true" /> Confirm</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => onConfirm(false)} data-testid="confirm-decline"><X className="h-4 w-4" aria-hidden="true" /> Cancel</button>
              </div>
            ) : (
              <p className="mt-1 text-xs font-medium">{m.confirmation.state === 'approved' ? 'You confirmed this action.' : 'You cancelled this action.'}</p>
            )}
          </div>
        )}
        {m.content && (
          <div className="rounded-2xl rounded-tl-sm bg-ink-100 px-4 py-2.5 dark:bg-ink-800" data-testid="assistant-text">
            <Markdown text={m.content} onCitation={onCitation} validPage={validPage} />
          </div>
        )}
        {m.streaming && !m.content && !m.confirmation && <p className="flex items-center gap-2 text-xs text-ink-500" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Thinking…</p>}
        {m.notices.map((n) => <Notice key={n} kind="info">{n}</Notice>)}
        {m.toolsEnabled === false && m.toolsError && <Notice kind="info">PDF tools are unavailable right now, so I can only answer questions about the text. ({m.toolsError})</Notice>}
        {doneDocs.length > 0 && <div className="flex flex-wrap gap-2">{doneDocs.map((d) => <DocDownload key={d.id} doc={d} onPreview={onPreview} />)}</div>}
        {m.citations.length > 0 && !m.streaming && (
          <p className="text-xs text-ink-500 dark:text-ink-400" data-testid="citations">
            Sources:{' '}
            {m.citations.map((c, i) => (
              <button key={i} type="button" className="mx-0.5 rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-800 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-100" onClick={() => onCitation({ page: c.page, label: c.label })} title={c.snippet}>
                p. {c.page}
              </button>
            ))}
          </p>
        )}
        <ErrorNotice error={m.error} />
      </div>
    </div>
  )
}

const ChatPage: ToolPage = ({ tool }) => {
  const { token } = useAuth()
  const [fileId, setFileId] = useState<string>()
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const { doc, progress, error: serverErr } = useServerDoc(fileId)
  const status = useAiStatus()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const createdDocs = useRef<string[]>([])
  const ac = useRef<AbortController | null>(null)
  const viewer = useRef<PdfViewerHandle>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  useEffect(() => () => ac.current?.abort(), [])
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages])

  const onFiles = async (list: File[]) => {
    setUploadErr(null)
    try {
      const meta = await addFile(list[0])
      if (fileId) removeFile(fileId)
      setFileId(meta.id)
      setMessages([])
      createdDocs.current = []
    } catch (e) {
      setUploadErr(friendlyMessage(e))
    }
  }

  const patchAssistant = useCallback((id: string, fn: (m: AssistantMessage) => AssistantMessage) => {
    setMessages((ms) => ms.map((m) => (m.id === id && m.role === 'assistant' ? fn(m) : m)))
  }, [])

  const run = useCallback(
    async (body: Record<string, unknown>, assistantId: string) => {
      const controller = new AbortController()
      ac.current = controller
      setBusy(true)
      try {
        await streamSse('/ai/chat', body, {
          signal: controller.signal,
          onEvent: (ev) => {
            patchAssistant(assistantId, (m) => {
              const next = applyChatEvent(m, ev)
              if (ev.event === 'done') createdDocs.current = [...new Set([...createdDocs.current, ...next.documents.map((d) => d.id)])]
              return next
            })
          },
        })
        patchAssistant(assistantId, (m) => (m.streaming ? { ...m, streaming: false } : m))
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === 'AbortError'
        patchAssistant(assistantId, (m) => ({ ...m, streaming: false, error: aborted ? null : toStreamError(e) }))
      } finally {
        setBusy(false)
      }
    },
    [patchAssistant],
  )

  const docIds = () => (doc ? [doc.id, ...createdDocs.current.slice(-4)] : [])

  const send = (text: string) => {
    const t = text.trim()
    if (!t || busy || !doc) return
    const history = messages.filter((m) => m.content.trim()).map((m) => ({ role: m.role, content: m.content }))
    const uid = `u${++seq.current}`
    const aid = `a${++seq.current}`
    setMessages((ms) => [...ms, { id: uid, role: 'user', content: t }, newAssistant(aid)])
    setInput('')
    void run({ messages: [...history, { role: 'user', content: t }].slice(-40), document_ids: docIds(), use_tools: true }, aid)
  }

  const confirm = (assistantId: string, approve: boolean) => {
    const msg = messages.find((m): m is AssistantMessage => m.id === assistantId && m.role === 'assistant')
    if (!msg?.confirmation || busy) return
    const actionId = msg.confirmation.action_id
    patchAssistant(assistantId, (m) => ({ ...m, streaming: true, status: undefined, confirmation: m.confirmation ? { ...m.confirmation, state: approve ? 'approved' : 'declined' } : null }))
    void run({ confirm: { action_id: actionId, approve } }, assistantId)
  }

  const previewDoc = useCallback(async (d: DocumentInfo) => {
    try {
      const bytes = await downloadDocumentBytes(d)
      const meta = addBytes(d.filename, bytes)
      setFileId(meta.id)
    } catch {
      // ignore
    }
  }, [])

  const onCitation = (c: CitationClick) => viewer.current?.scrollToPage(c.page)
  const validPage = (c: CitationClick) => !doc?.pages || (c.page >= 1 && c.page <= doc.pages)
  const meta = fileId ? getMeta(fileId) : undefined
  const uploading = !!fileId && !!token && !doc && !serverErr

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
        <PrivacyNotice />
        <SignInGate />
        <AiKeyBanner status={status} />
        {uploadErr && <Notice kind="error">{uploadErr}</Notice>}
        {serverErr && <Notice kind="error" title="Upload to the server failed">{serverErr}</Notice>}
      </div>

      {!fileId || !meta ? (
        <Dropzone onFiles={onFiles} accept="application/pdf,.pdf" title="Choose a PDF to chat with" hint="Drag and drop, or browse. The file is uploaded to the server." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card flex h-[75vh] flex-col overflow-hidden" aria-label="Chat">
            <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-2 dark:border-ink-800">
              <p className="flex min-w-0 items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{meta.name}</span></p>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { ac.current?.abort(); removeFile(fileId); setFileId(undefined); setMessages([]); createdDocs.current = [] }}>Choose another</button>
            </div>
            {uploading && <div className="px-4 py-3"><ProgressBar value={progress} label="Uploading to the server" /></div>}
            <div ref={scroller} className="flex-1 space-y-4 overflow-auto px-4 py-4" role="log" aria-live="polite" aria-label="Conversation">
              {messages.length === 0 && (
                <div className="space-y-3 text-sm text-ink-600 dark:text-ink-300">
                  <p>Ask anything about this document, or tell me what to do with it (merge, split, compress, rotate, extract pages, convert…). Answers cite the pages they come from.</p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => <button key={s} type="button" className="btn-secondary btn-sm" disabled={!doc || busy} onClick={() => send(s)}>{s}</button>)}
                  </div>
                </div>
              )}
              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end gap-3" data-testid="user-message">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2.5 text-sm text-white dark:bg-brand-400 dark:text-ink-950">{m.content}</p>
                    <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-200 dark:bg-ink-700"><User className="h-4 w-4" aria-hidden="true" /></span>
                  </div>
                ) : (
                  <AssistantBubble key={m.id} m={m} onCitation={onCitation} onConfirm={(a) => confirm(m.id, a)} onPreview={previewDoc} validPage={validPage} />
                ),
              )}
            </div>
            <form className="flex gap-2 border-t border-ink-200 p-3 dark:border-ink-800" onSubmit={(e: FormEvent) => { e.preventDefault(); send(input) }}>
              <label htmlFor="chat-input" className="sr-only">Your message</label>
              <input id="chat-input" data-testid="chat-input" className="input flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder={doc ? 'Ask about this PDF…' : 'Waiting for the upload…'} disabled={!doc} autoComplete="off" />
              {busy ? (
                <button type="button" className="btn-secondary" onClick={() => ac.current?.abort()} aria-label="Stop"><Square className="h-4 w-4" aria-hidden="true" /> Stop</button>
              ) : (
                <button type="submit" className="btn-primary" disabled={!doc || !input.trim()} data-testid="chat-send"><Send className="h-4 w-4" aria-hidden="true" /> Send</button>
              )}
            </form>
          </section>
          <section aria-label="Document" className="lg:sticky lg:top-20 lg:self-start">
            <PdfViewer ref={viewer} key={fileId} fileId={fileId} height="75vh" hideRotate showThumbnails={false} />
          </section>
        </div>
      )}
    </div>
  )
}

export default ChatPage
