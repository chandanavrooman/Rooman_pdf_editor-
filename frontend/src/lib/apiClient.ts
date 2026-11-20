/**
 * Backend client. Every request carries the Bearer token; error bodies are {detail, code, ...} and become ApiError.
 * No secrets live here: only the user's own login token (see auth.ts).
 */
import { apiUrl } from './api'
import { getToken, logout, openAuthDialog, setSession, type AuthUser } from './auth'

export interface DocumentInfo {
  id: string
  filename: string
  kind: string
  mime: string
  size: number
  pages: number | null
  download_url: string
  created_at?: string
  expires_at?: string
}

export interface ToolResult {
  documents: DocumentInfo[]
  notice: string | null
  details: Record<string, unknown>
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly extra: Record<string, unknown>
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.extra = extra
  }
}

/** Turn a failed fetch Response into an ApiError (works for JSON bodies and for proxies that return plain text). */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> | null = null
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    /* not JSON */
  }
  return errorFromBody(res.status, body)
}

export function errorFromBody(status: number, body: Record<string, unknown> | null): ApiError {
  const { detail, code, ...extra } = body ?? {}
  const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? 'The request was not valid.' : defaultMessage(status)
  return new ApiError(status, typeof code === 'string' ? code : `HTTP_${status}`, message, extra)
}

function defaultMessage(status: number): string {
  if (status === 0) return 'Could not reach the server. Is the backend running?'
  if (status === 401) return 'You need to sign in.'
  if (status === 413) return 'The file is too large for the server.'
  if (status === 429) return 'Too many requests. Please wait a moment and try again.'
  if (status >= 500) return `The server had a problem (HTTP ${status}).`
  return `The request failed (HTTP ${status}).`
}

/** Message for a backend error code (also used for `error` events inside SSE streams). */
export function messageForCode(code: string, message: string): string {
  switch (code) {
    case 'EXTERNAL_TOOL_TIMEOUT':
      return `${message} The file may be too large or complex; try a smaller one.`
    case 'RATE_LIMITED':
      return 'Too many requests — please wait a few seconds and try again.'
    case 'NOT_FOUND':
      return 'The server no longer has this file (it is deleted automatically after a while). Please run the tool again.'
    case 'AI_KEY_MISSING':
      return 'The server has no AI key configured: set AI_API_KEY in .env and restart the backend.'
    case 'AI_KEY_INVALID':
      return "The server's AI key was rejected by the provider. Ask the administrator to check AI_API_KEY."
    case 'AI_RATE_LIMITED':
      return 'The AI provider is rate-limiting requests. Wait a moment and try again.'
    case 'AI_MODEL_NOT_FOUND':
      return 'The AI provider does not know the configured model. Set AI_MODEL in .env to a model your provider offers.'
    case 'AI_UPSTREAM_ERROR':
      return `The AI provider could not be reached or failed: ${message}`
    case 'NO_TEXT_LAYER':
      return 'This PDF has no text layer (it looks scanned). Run OCR first, then try again.'
    default:
      return message // EXTERNAL_TOOL_MISSING and most others already carry an actionable backend message
  }
}

/** Message safe to show the user. Adds actionable hints for the well-known error codes. */
export function friendlyMessage(e: unknown): string {
  if (e instanceof ApiError) return messageForCode(e.code, e.message)
  if (e instanceof DOMException && e.name === 'AbortError') return 'Cancelled.'
  if (e instanceof TypeError) return 'Could not reach the server. Is the backend running?'
  return e instanceof Error ? e.message : String(e)
}

let localTestMode = false
let localInflight: Promise<boolean> | null = null

/**
 * LOCAL_TEST_MODE (backend, ENV=development only): get a session for the fixed local test user without signing in.
 * Resolves to false when the backend does not offer it.
 */
export function startLocalSession(): Promise<boolean> {
  localTestMode = true
  localInflight ??= apiJson<{ access_token: string; expires_in: number; user: AuthUser }>('/auth/local-session', {})
    .then((r) => {
      setSession(r.access_token, r.user, r.expires_in, { localTest: true })
      return true
    })
    .catch(() => {
      localTestMode = false
      return false
    })
    .finally(() => {
      localInflight = null
    })
  return localInflight
}

function handleUnauthorized(path: string) {
  if (path.startsWith('/auth/')) return
  if (localTestMode) {
    // local test session expired (e.g. backend restarted with a new JWT_SECRET): silently get a new one
    logout()
    void startLocalSession()
    return
  }
  if (getToken()) {
    logout()
    openAuthDialog('Your session expired. Please sign in again.')
  } else openAuthDialog('Sign in to use server tools.')
}

function authHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra)
  const t = getToken()
  if (t) h.set('Authorization', `Bearer ${t}`)
  return h
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(apiUrl(path), { ...init, headers: authHeaders(init.headers) })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'NETWORK_ERROR', defaultMessage(0))
  }
  if (!res.ok) {
    const err = await errorFromResponse(res)
    if (res.status === 401) handleUnauthorized(path)
    throw err
  }
  return res
}

export async function apiJson<T>(path: string, body?: unknown, opts: { method?: string; signal?: AbortSignal } = {}): Promise<T> {
  const res = await apiFetch(path, {
    method: opts.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: opts.signal,
  })
  return (await res.json()) as T
}

/** Upload one file as a server document. Uses XHR because fetch cannot report upload progress. */
export function uploadDocument(file: Blob, filename: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<DocumentInfo> {
  const tooLarge = uploadTooLarge(file.size, filename)
  if (tooLarge) return Promise.reject(tooLarge)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', apiUrl('/documents'))
    const t = getToken()
    if (t) xhr.setRequestHeader('Authorization', `Bearer ${t}`)
    xhr.upload.onprogress = (ev) => ev.lengthComputable && onProgress?.(ev.loaded / ev.total)
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', defaultMessage(0)))
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    xhr.onload = () => {
      let body: Record<string, unknown> | null = null
      try {
        body = JSON.parse(xhr.responseText) as Record<string, unknown>
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) return resolve(body as unknown as DocumentInfo)
      if (xhr.status === 401) handleUnauthorized('/documents')
      reject(errorFromBody(xhr.status, body))
    }
    if (signal) {
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    const fd = new FormData()
    fd.append('file', file, filename)
    xhr.send(fd)
  })
}

/** Authenticated download: fetch → bytes (the bearer header cannot be sent by a plain <a href>). */
export async function downloadDocumentBytes(doc: Pick<DocumentInfo, 'id'> & Partial<DocumentInfo>, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await apiFetch(`/documents/${doc.id}/download`, { signal })
  return new Uint8Array(await res.arrayBuffer())
}

export async function deleteDocument(id: string): Promise<void> {
  try {
    await apiFetch(`/documents/${id}`, { method: 'DELETE' })
  } catch {
    /* best effort: the server deletes it after its TTL anyway */
  }
}

export interface Capabilities {
  programs: Record<string, { available: boolean; install: string; label: string }>
  tools: Record<string, boolean>
  ocr_languages: string[]
  limits: { max_upload_mb: number; file_ttl_minutes: number }
  ai_configured: boolean
  /** backend LOCAL_TEST_MODE: sign-in is skipped (development only) */
  local_test_mode?: boolean
}

let lastCapabilities: Capabilities | null = null
export const getCapabilities = async (signal?: AbortSignal) => (lastCapabilities = await apiJson<Capabilities>('/system/capabilities', undefined, { signal }))

/** The server's upload limit in bytes, once capabilities were fetched (null = unknown). */
export function uploadLimitBytes(): number | null {
  const mb = lastCapabilities?.limits.max_upload_mb
  return mb ? mb * 1024 * 1024 : null
}

/** A clear error when a file is over the server's upload limit (checked before uploading, so nothing is sent). */
export function uploadTooLarge(size: number, filename: string): ApiError | null {
  const limit = uploadLimitBytes()
  if (limit === null || size <= limit) return null
  const mb = (size / 1024 / 1024).toFixed(1)
  return new ApiError(413, 'FILE_TOO_LARGE', `"${filename}" is ${mb} MB — larger than the server's ${lastCapabilities!.limits.max_upload_mb} MB upload limit. Split it into smaller parts first (Split PDF runs in your browser).`)
}
