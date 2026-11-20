import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, Plus, Send, Square, User } from 'lucide-react'
import { Dropzone } from '@/components/Dropzone'
import { Notice } from '@/components/Notice'
import { PdfViewer, type PdfViewerHandle } from '@/components/PdfViewer'
import { ToolIcon } from '@/components/ToolIcon'
import { addBytes, addFile, removeFile } from '@/lib/fileStore'
import { useStoredFiles } from '@/hooks/useStoredFiles'
import { downloadDocumentBytes, friendlyMessage, type DocumentInfo } from '@/lib/apiClient'
import { streamSse } from '@/lib/sse'
import { useAuth } from '@/lib/auth'
import { TOOLS, type ToolMeta } from '@/lib/tools'
import type { ToolPage } from '@/tools/shared/types'
import type { CitationClick } from './Markdown'
import { AiKeyBanner, PrivacyNotice, SignInGate, toStreamError, useAiStatus } from './shared'
import { applyChatEvent, newAssistant, type AssistantMessage, type ChatMessage } from './chatState'
import { AssistantBubble } from './ChatPage'
import { FileRow } from './AiTools'

/** At most this many of YOUR files, so that the files the assistant creates still fit in the five the server accepts per request. */
const MAX_FILES = 3
const MAX_CONTEXT_DOCS = 5

/** One prompt per thing the assistant can do; each really runs the matching operation. */
const SUGGESTIONS: { icon: string; label: string; prompt: string; needs?: number }[] = [
  { icon: 'sparkles', label: 'Summarize', prompt: 'Summarize this entire document in a short overview with key points.' },
  { icon: 'lightbulb', label: 'Explain simply', prompt: 'Explain this document in simple English, and define the technical terms.' },
  { icon: 'chat', label: 'Key dates', prompt: 'Find all the important dates in this document and cite the pages.' },
  { icon: 'language', label: 'Translate', prompt: 'Translate this document into Hindi and give me a Word file.' },
  { icon: 'lightbulb', label: '20 questions', prompt: 'Generate 20 multiple-choice questions with answers from this document as a Word file.' },
  { icon: 'excel', label: 'Tables to Excel', prompt: 'Extract the tables in this document into an Excel file.' },
  { icon: 'compare', label: 'Compare', prompt: 'Compare these two documents and list what was added, removed and changed, with pages.', needs: 2 },
  { icon: 'chat', label: 'Explain a page', prompt: 'Explain page 1 in detail.' },
]

/** The AI features, as a menu (the AI PDF Assistant itself first). */
function AiMenu({ active }: { active: string }) {
  const items = useMemo(() => TOOLS.filter((t): t is ToolMeta => t.category === 'ai' && t.status === 'available'), [])
  return (
    <nav aria-label="AI features" className="card flex gap-1 overflow-x-auto p-2 lg:w-56 lg:shrink-0 lg:flex-col lg:self-start lg:overflow-visible" data-testid="ai-menu">
      <p className="hidden px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-500 lg:block">AI PDF</p>
      {items.map((t) => (
        <Link
          key={t.id}
          to={t.route}
          aria-current={t.id === active ? 'page' : undefined}
          className={`flex shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium transition ${
            t.id === active ? 'bg-brand-600 text-white dark:bg-brand-400 dark:text-ink-950' : 'text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800'
          }`}
        >
          <ToolIcon name={t.icon} className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap">{t.name}</span>
        </Link>
      ))}
    </nav>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="btn-ghost btn-sm !px-2 text-xs"
      data-testid="copy-response"
      aria-label="Copy this response"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        }, () => {})
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />} {done ? 'Copied' : 'Copy'}
    </button>
  )
}

/** The AI PDF Assistant: one workspace, one model. The assistant reads your request and runs the real operation (summary, translation, questions, tables, comparison, page edits). */
const AssistantPage: ToolPage = ({ tool }) => {
  const { token } = useAuth()
  const status = useAiStatus()
  const [fileIds, setFileIds] = useState<string[]>([])
  const files = useStoredFiles(fileIds)
  const [docs, setDocs] = useState<Record<string, DocumentInfo | null>>({})
  const [errs, setErrs] = useState<string[]>([])
  const [viewId, setViewId] = useState<string>()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const createdDocs = useRef<string[]>([])
  const ac = useRef<AbortController | null>(null)
  const viewer = useRef<PdfViewerHandle>(null)
  const pending = useRef<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  useEffect(() => () => ac.current?.abort(), [])
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages])

  const onDoc = useCallback((id: string, d: DocumentInfo | null) => setDocs((m) => (m[id] === d ? m : { ...m, [id]: d })), [])
  const ready = files.length > 0 && files.every((f) => docs[f.id])
  const uploaded = files.map((f) => docs[f.id]).filter((d): d is DocumentInfo => !!d)

  const add = async (list: File[]) => {
    const e: string[] = []
    const added: string[] = []
    for (const f of list) {
      if (fileIds.length + added.length >= MAX_FILES) {
        e.push(`At most ${MAX_FILES} files can be open at once.`)
        break
      }
      try {
        added.push((await addFile(f)).id)
      } catch (x) {
        e.push(friendlyMessage(x))
      }
    }
    setErrs(e)
    setFileIds((p) => [...p, ...added])
    if (added.length && !viewId) setViewId(added[0])
  }
  const remove = (id: string) => {
    removeFile(id)
    setFileIds((p) => p.filter((x) => x !== id))
    setViewId((v) => (v === id ? fileIds.find((x) => x !== id) : v))
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

  /** your files first (so D1, D2 are the files in the list), then the latest files the assistant made */
  const docIds = () => [...uploaded.map((d) => d.id), ...createdDocs.current.slice(-(MAX_CONTEXT_DOCS - uploaded.length))].slice(0, MAX_CONTEXT_DOCS)

  const send = (text: string) => {
    const t = text.trim()
    if (!t || busy || !ready) return
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

  const newConversation = () => {
    ac.current?.abort()
    setMessages([])
    setInput('')
    createdDocs.current = []
  }

  const previewDoc = useCallback(async (d: DocumentInfo) => {
    try {
      const bytes = await downloadDocumentBytes(d)
      setViewId(addBytes(d.filename, bytes).id)
    } catch {
      /* the download button still works */
    }
  }, [])

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
  const validPage = (c: CitationClick) => {
    const d = docs[files[c.label ? Number(c.label.slice(1)) - 1 : 0]?.id ?? '']
    return !d?.pages || (c.page >= 1 && c.page <= d.pages)
  }

  const viewFile = files.find((f) => f.id === viewId) ?? files[0]
  const suggestions = SUGGESTIONS.filter((s) => (s.needs ?? 1) <= uploaded.length)

  return (
    <div className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6">
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
        {errs.map((m) => <Notice key={m} kind="error">{m}</Notice>)}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <AiMenu active={tool.id} />

        <div className={`grid min-w-0 flex-1 gap-4 ${viewFile ? 'xl:grid-cols-2' : ''}`}>
          <section className="card flex h-[78vh] min-w-0 flex-col overflow-hidden" aria-label="Assistant">
            <div className="space-y-2 border-b border-ink-200 p-3 dark:border-ink-800" aria-label="Your documents">
              {files.length > 0 && (
                <ul className="space-y-2" data-testid="assistant-files">
                  {files.map((f, i) => <FileRow key={f.id} file={f} label={`D${i + 1}`} onDoc={onDoc} onRemove={() => remove(f.id)} onView={() => setViewId(f.id)} />)}
                </ul>
              )}
              {files.length < MAX_FILES && (
                <Dropzone compact={files.length > 0} multiple onFiles={add} accept="application/pdf,.pdf" title={files.length ? 'Add another PDF' : 'Choose your PDFs'} hint={`Up to ${MAX_FILES} files. Uploaded to the server.`} />
              )}
            </div>

            <div ref={scroller} className="flex-1 space-y-4 overflow-auto px-4 py-4" role="log" aria-live="polite" aria-label="Conversation">
              {messages.length === 0 && (
                <div className="space-y-3 text-sm text-ink-600 dark:text-ink-300">
                  <p>{ready ? 'Tell me what you need in your own words. I read your request and run the real operation: a summary, a translation, practice questions, an Excel file of the tables, a comparison, or page edits like merge and compress.' : 'Add a PDF above to begin.'}</p>
                  {ready && (
                    <div className="flex flex-wrap gap-2" data-testid="suggestions">
                      {suggestions.map((s) => (
                        <button key={s.label} type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => send(s.prompt)} title={s.prompt}>
                          <ToolIcon name={s.icon} className="h-3.5 w-3.5" /> {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end gap-3" data-testid="user-message">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2.5 text-sm text-white dark:bg-brand-400 dark:text-ink-950">{m.content}</p>
                    <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-200 dark:bg-ink-700"><User className="h-4 w-4" aria-hidden="true" /></span>
                  </div>
                ) : (
                  <div key={m.id}>
                    <AssistantBubble m={m} onCitation={onCitation} onConfirm={(a) => confirm(m.id, a)} onPreview={previewDoc} validPage={validPage} />
                    {!m.streaming && m.content.trim() && <div className="mt-1 pl-10"><CopyButton text={m.content} /></div>}
                  </div>
                ),
              )}
            </div>

            <form className="flex gap-2 border-t border-ink-200 p-3 dark:border-ink-800" onSubmit={(e: FormEvent) => { e.preventDefault(); send(input) }}>
              <button type="button" className="btn-ghost btn-sm shrink-0" onClick={newConversation} disabled={!messages.length && !busy} data-testid="new-conversation" title="Start a new conversation (your files stay)">
                <Plus className="h-4 w-4" aria-hidden="true" /> New
              </button>
              <label htmlFor="assistant-input" className="sr-only">Your message</label>
              <input id="assistant-input" data-testid="chat-input" className="input flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder={ready ? 'e.g. Translate this into Hindi, or find the financial figures…' : token ? 'Add a PDF first…' : 'Sign in to use the assistant…'} disabled={!ready} autoComplete="off" />
              {busy ? (
                <button type="button" className="btn-secondary" onClick={() => ac.current?.abort()} aria-label="Stop"><Square className="h-4 w-4" aria-hidden="true" /> Stop</button>
              ) : (
                <button type="submit" className="btn-primary" disabled={!ready || !input.trim()} data-testid="chat-send"><Send className="h-4 w-4" aria-hidden="true" /> Send</button>
              )}
            </form>
          </section>

          {viewFile && (
            <section aria-label="Document" className="min-w-0 xl:sticky xl:top-20 xl:self-start">
              <PdfViewer
                ref={viewer}
                key={viewFile.id}
                fileId={viewFile.id}
                height="78vh"
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
    </div>
  )
}
export default AssistantPage
