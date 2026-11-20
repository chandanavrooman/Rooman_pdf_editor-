import { useEffect, useState } from 'react'
import { LogIn } from 'lucide-react'
import { Notice } from '@/components/Notice'
import { apiJson, friendlyMessage, messageForCode, type DocumentInfo } from '@/lib/apiClient'
import { openAuthDialog, useAuth } from '@/lib/auth'
import { getMeta } from '@/lib/fileStore'
import { ensureServerDocument } from '@/lib/serverDocs'

export interface Citation {
  document_id?: string
  label?: string
  page: number
  snippet?: string
}

export interface AiStatus {
  configured: boolean
  model: string
  tools_available: boolean
  message: string
}

export interface StreamError {
  code: string
  message: string
}

export const streamEventError = (d: { code?: string; message?: string }): StreamError => ({
  code: d.code ?? 'AI_INTERNAL_ERROR',
  message: messageForCode(d.code ?? '', d.message ?? 'The AI request failed.'),
})

export const toStreamError = (e: unknown): StreamError => ({
  code: (e as { code?: string })?.code ?? 'ERROR',
  message: friendlyMessage(e),
})

export function useAiStatus(): AiStatus | null {
  const { token } = useAuth()
  const [status, setStatus] = useState<AiStatus | null>(null)
  useEffect(() => {
    if (!token) return
    let live = true
    apiJson<AiStatus>('/ai/status').then(
      (s) => live && setStatus(s),
      () => live && setStatus(null),
    )
    return () => {
      live = false
    }
  }, [token])
  return status
}

/** Uploads a FileStore file to the server (cached) as soon as the user is signed in. */
export function useServerDoc(fileId: string | undefined): { doc: DocumentInfo | null; progress: number; error: string | null } {
  const { token } = useAuth()
  const [state, setState] = useState<{ id?: string; doc: DocumentInfo | null; progress: number; error: string | null }>({ doc: null, progress: 0, error: null })
  useEffect(() => {
    if (!fileId || !token) return
    const meta = getMeta(fileId)
    if (!meta) return
    let live = true
    const ac = new AbortController()
    ensureServerDocument(meta, (p) => live && setState((s) => (s.id === fileId ? { ...s, progress: p } : s)), ac.signal).then(
      (doc) => live && setState({ id: fileId, doc, progress: 1, error: null }),
      (e) => live && setState({ id: fileId, doc: null, progress: 0, error: friendlyMessage(e) }),
    )
    setState({ id: fileId, doc: null, progress: 0, error: null })
    return () => {
      live = false
      ac.abort()
    }
  }, [fileId, token])
  if (state.id !== fileId) return { doc: null, progress: 0, error: null }
  return { doc: state.doc, progress: state.progress, error: state.error }
}

export function SignInGate({ what = 'the AI assistant' }: { what?: string }) {
  const { token } = useAuth()
  if (token) return null
  return (
    <Notice kind="info" title={`Sign in to use ${what}`}>
      <p>Your documents are stored privately under your account while the assistant works on them.</p>
      <button type="button" className="btn-primary btn-sm mt-2" onClick={() => openAuthDialog('Sign in to use the AI assistant.')} data-testid="gate-sign-in">
        <LogIn className="h-4 w-4" aria-hidden="true" /> Sign in / Create account
      </button>
    </Notice>
  )
}

export function PrivacyNotice({ textOnly = true }: { textOnly?: boolean }) {
  return (
    <Notice kind="warn" title="Your file is uploaded to the server">
      {textOnly ? 'The text extracted from your PDF is also sent to the AI provider configured on the server (AI_ENDPOINT) to produce the answer.' : 'The file is processed on the server.'} Uploaded files are deleted automatically after the server’s retention time.
    </Notice>
  )
}

export function AiKeyBanner({ status }: { status: AiStatus | null }) {
  if (!status || status.configured) return null
  return (
    <Notice kind="error" title="AI is not configured on this server">
      <span data-testid="ai-key-missing">{messageForCode('AI_KEY_MISSING', '')}</span>
    </Notice>
  )
}

export function ErrorNotice({ error }: { error: StreamError | null }) {
  if (!error) return null
  const title = error.code === 'AI_KEY_MISSING' ? 'AI is not configured on this server' : error.code === 'AI_KEY_INVALID' ? 'The server’s AI key was rejected' : 'Something went wrong'
  return (
    <Notice kind="error" title={title}>
      <span data-testid="ai-error" data-code={error.code}>
        {error.message}
      </span>
    </Notice>
  )
}
