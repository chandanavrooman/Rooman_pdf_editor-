/**
 * Server-Sent Events over fetch (we POST with an Authorization header, so EventSource cannot be used).
 * `SseParser` is a pure incremental parser: feed it decoded text chunks split ANYWHERE (even inside a field or a UTF-8
 * character boundary handled by TextDecoder in streaming mode) and it returns the complete events.
 */
import { apiUrl } from './api'
import { getToken, logout, openAuthDialog } from './auth'
import { ApiError, errorFromResponse } from './apiClient'

export interface SseEvent {
  event: string
  data: unknown
  raw: string
}

export class SseParser {
  private buf = ''

  push(chunk: string): SseEvent[] {
    let work = this.buf + chunk
    // a chunk may end between "\r" and "\n": hold a trailing "\r" back until we know what follows
    let held = ''
    if (work.endsWith('\r')) {
      held = '\r'
      work = work.slice(0, -1)
    }
    work = work.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const out: SseEvent[] = []
    let idx: number
    while ((idx = work.indexOf('\n\n')) !== -1) {
      const frame = work.slice(0, idx)
      work = work.slice(idx + 2)
      const ev = parseFrame(frame)
      if (ev) out.push(ev)
    }
    this.buf = work + held
    return out
  }

  /** Flush a trailing frame that was not terminated by a blank line. */
  end(): SseEvent[] {
    const rest = this.buf.replace(/\r/g, '\n').trim()
    this.buf = ''
    if (!rest) return []
    const ev = parseFrame(rest)
    return ev ? [ev] : []
  }
}

function parseFrame(frame: string): SseEvent | null {
  let event = 'message'
  const data: string[] = []
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue // comment / keep-alive ping
    const c = line.indexOf(':')
    const field = c === -1 ? line : line.slice(0, c)
    let value = c === -1 ? '' : line.slice(c + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (!data.length) return null
  const raw = data.join('\n')
  let parsed: unknown = raw
  try {
    parsed = JSON.parse(raw)
  } catch {
    /* keep the raw string */
  }
  return { event, data: parsed, raw }
}

export interface StreamOptions {
  signal?: AbortSignal
  onEvent: (ev: SseEvent) => void
}

/**
 * POST JSON and stream the SSE response. Resolves when the stream ends. HTTP errors raised before the stream starts
 * (AI_KEY_MISSING 503, NOT_FOUND 404, …) throw ApiError; errors during the stream arrive as an `error` event.
 */
export async function streamSse(path: string, body: unknown, { signal, onEvent }: StreamOptions): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' })
  const t = getToken()
  if (t) headers.set('Authorization', `Bearer ${t}`)
  let res: Response
  try {
    res = await fetch(apiUrl(path), { method: 'POST', headers, body: JSON.stringify(body), signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Is the backend running?')
  }
  if (!res.ok) {
    const err = await errorFromResponse(res)
    if (res.status === 401) {
      if (t) logout()
      openAuthDialog(t ? 'Your session expired. Please sign in again.' : 'Sign in to use the AI assistant.')
    }
    throw err
  }
  if (!res.body) throw new ApiError(0, 'NO_STREAM', 'The server did not return a stream.')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = new SseParser()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    for (const ev of parser.push(decoder.decode(value, { stream: true }))) onEvent(ev)
  }
  for (const ev of parser.push(decoder.decode())) onEvent(ev)
  for (const ev of parser.end()) onEvent(ev)
}
